from flask import Flask
import subprocess, os, time, json

# TODO: hacer el password parametrizable por participante (vía runHookPayload en
# el hook /run). Por ahora queda fijo para validar que la imagen arranca end-to-end.
PASSWORD = "microvm2026"


def log(event, **kwargs):
    """Structured JSON logging with a stable event name (steering convention)."""
    print(json.dumps({"ts": time.time(), "event": event, **kwargs}), flush=True)


# Write bashrc so all terminals (incl. code-server integrated terminals) get
# Kiro CLI on PATH.
with open("/root/.bashrc", "w") as f:
    f.write("export PATH=/root/.local/bin:/usr/local/bin:$PATH\n")

# Start code-server immediately (available at boot, before snapshot).
env = {
    **os.environ,
    "HOME": "/root",
    "PATH": "/root/.local/bin:/usr/local/bin:" + os.environ.get("PATH", ""),
    "PASSWORD": PASSWORD,
}
subprocess.Popen(
    ["code-server", "--bind-addr", "0.0.0.0:8080", "--auth", "password", "--disable-telemetry"],
    env=env,
)


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
    log("hook_run")
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
