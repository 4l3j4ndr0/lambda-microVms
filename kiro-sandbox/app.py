from flask import Flask, request
import subprocess, os, time, json

# Password de ARRANQUE (placeholder). code-server arranca con esto en el boot
# (antes del snapshot). El password REAL, único por participante, llega en el
# hook /run vía runHookPayload y reinicia code-server con él. Si por alguna razón
# /run no trae password, este placeholder queda vigente (fallback seguro: distinto
# por boot no es necesario porque /run siempre lo pisa en el flujo normal).
PASSWORD = os.environ.get("PASSWORD", "microvm2026")

# Handle del proceso code-server para poder reiniciarlo con el password real.
_code_server = None


def log(event, **kwargs):
    """Structured JSON logging with a stable event name (steering convention)."""
    print(json.dumps({"ts": time.time(), "event": event, **kwargs}), flush=True)


def _extract_password(payload):
    """Extrae el password del body de /run.

    Formato OFICIAL del body (confirmado con el hook.py de ejemplo de AWS,
    anysphere/aws-lambda-workers): la plataforma envía
        {"microvmId": "...", "runHookPayload": "<tu-blob-como-STRING>"}
    es decir, el blob opaco que pasaste a RunMicrovm llega bajo la clave
    "runHookPayload" y como STRING, hay que json.loads() de nuevo. Nosotros
    pusimos ahí '{"password":"..."}'.

    Se mantiene tolerancia a otras formas (raíz directa, payload/body/data) por
    robustez ante cambios de la plataforma. Devuelve el password o None."""
    if payload is None:
        return None
    if isinstance(payload, str):
        try:
            payload = json.loads(payload)
        except Exception:  # noqa: BLE001
            return None
    if not isinstance(payload, dict):
        return None
    # Camino oficial + alternativas: el blob puede estar anidado como string.
    for key in ("runHookPayload", "payload", "body", "data"):
        inner = payload.get(key)
        if inner is None:
            continue
        if isinstance(inner, str):
            try:
                inner = json.loads(inner)
            except Exception:  # noqa: BLE001
                continue
        if isinstance(inner, dict) and isinstance(inner.get("password"), str):
            return inner["password"]
    # Fallback: password directo en la raíz del body.
    if isinstance(payload.get("password"), str):
        return payload["password"]
    return None


# Write bashrc so all terminals (incl. code-server integrated terminals) get
# Kiro CLI on PATH, and show the welcome banner on interactive shells.
# NOTE: this file is rewritten on every boot, so the welcome hook must live here
# (not baked only via Dockerfile, which this would overwrite).
with open("/root/.bashrc", "w") as f:
    f.write(
        "export PATH=/root/.local/bin:/usr/local/bin:$PATH\n"
        "# Mensaje de bienvenida Kiro Day (solo shells interactivos)\n"
        "if [[ $- == *i* ]] && [ -f /root/.welcome-terminal.sh ]; then\n"
        "  . /root/.welcome-terminal.sh\n"
        "fi\n"
    )

# Start code-server immediately (available at boot, before snapshot).
# Opens the kiro-day workspace folder by default.
def start_code_server(password):
    """(Re)arranca code-server con el password dado. Si ya hay uno corriendo, lo
    termina primero. Devuelve el Popen. code-server lee el password de la env var
    PASSWORD al arrancar, así que para cambiarlo hay que reiniciar el proceso."""
    global _code_server
    if _code_server is not None and _code_server.poll() is None:
        try:
            _code_server.terminate()
            _code_server.wait(timeout=5)
        except Exception:  # noqa: BLE001 - best effort
            try:
                _code_server.kill()
            except Exception:  # noqa: BLE001
                pass
    env = {
        **os.environ,
        "HOME": "/root",
        "PATH": "/root/.local/bin:/usr/local/bin:" + os.environ.get("PATH", ""),
        "PASSWORD": password,
    }
    _code_server = subprocess.Popen(
        [
            "code-server",
            "--bind-addr", "0.0.0.0:8080",
            "--auth", "password",
            "--disable-telemetry",
            "/root/project/kiro-day",
        ],
        env=env,
    )
    return _code_server


start_code_server(PASSWORD)


def reseed_entropy():
    """Reseed the kernel CSPRNG after resume. Snapshots share memory state across
    all MicroVMs run from the same image version, so seed with per-instance data
    (steering: 'Reseed CSPRNGs en el hook /resume')."""
    try:
        with open("/dev/urandom", "rb") as rnd:
            seed = rnd.read(32)
        seed += os.urandom(32) + str(time.time_ns()).encode() + str(os.getpid()).encode()
        with open("/dev/urandom", "wb") as w:
            w.write(seed)
        log("entropy_reseeded")
    except Exception as e:  # noqa: BLE001 - best effort, never block resume
        log("entropy_reseed_failed", error=str(e))


# Lifecycle hooks on port 9000 (steering convention)
hooks = Flask("hooks")
P = "/aws/lambda-microvms/runtime/v1"


@hooks.post(f"{P}/ready")
def ready():
    log("hook_ready")
    return "", 200


@hooks.post(f"{P}/validate")
def validate():
    log("hook_validate")
    return "", 200


@hooks.post(f"{P}/run")
def run():
    """Fires once post-resume. La plataforma entrega el runHookPayload en el body
    del POST (y además inyecta microvmId). El blob puede venir como JSON crudo en
    la raíz, o anidado/serializado según cómo lo envuelva la plataforma, así que
    buscamos el password de forma defensiva. Reinicia code-server con él."""
    password = None
    raw = request.get_data(as_text=True) or ""
    try:
        payload = request.get_json(force=True, silent=True)
        if payload is None and raw:
            payload = json.loads(raw)
        password = _extract_password(payload)
    except Exception as e:  # noqa: BLE001
        log("hook_run_payload_error", error=str(e))

    # Log de diagnóstico SIN exponer el password: solo las claves y el tipo.
    try:
        if isinstance(payload, dict):
            log("hook_run_payload_shape", keys=sorted(payload.keys()), type="dict")
        else:
            log("hook_run_payload_shape", type=type(payload).__name__, raw_len=len(raw))
    except Exception:  # noqa: BLE001
        pass

    if password:
        try:
            start_code_server(password)
            log("hook_run", password_applied=True)
        except Exception as e:  # noqa: BLE001
            log("hook_run_restart_failed", error=str(e))
            return "", 500
    else:
        log("hook_run", password_applied=False)
    return "", 200


@hooks.post(f"{P}/resume")
def resume():
    log("hook_resume")
    reseed_entropy()
    return "", 200


@hooks.post(f"{P}/suspend")
def suspend():
    log("hook_suspend")
    return "", 200


@hooks.post(f"{P}/terminate")
def terminate():
    log("hook_terminate")
    return "", 200


if __name__ == "__main__":
    log("boot", msg="kiro-sandbox hook server starting on :9000")
    hooks.run(host="0.0.0.0", port=9000)
