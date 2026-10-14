// registration.js
// Alta self-service para el día del evento: el participante escanea el QR, abre
// el formulario y envía { name, email }. Este módulo:
//   1. Valida la entrada.
//   2. Responde al INSTANTE (no provisiona en caliente) encolando el trabajo.
//   3. Un worker en memoria procesa de a CONCURRENCY a la vez, llamando a
//      fleet.ensureSandbox() (idempotencia + cap incluidos).
//
// Cola simple EN MEMORIA (decisión explícita para un evento de un día en un solo
// EC2): si el proceso se reinicia, se pierde lo encolado pendiente, pero los
// sandboxes ya creados persisten en routes.json y la idempotencia por email deja
// que el participante reintente sin crear duplicados.
//
// NO hay rate limit por IP: en el evento todos los participantes comparten el
// WiFi (misma IP pública tras NAT), así que limitar por IP daría falsos positivos
// tratando a personas distintas como un solo cliente. El abuso real ya está
// contenido por: (1) idempotencia por email -> un email = un solo sandbox, y
// (2) cap global de sandboxes -> techo duro de VMs totales.

import { ensureSandbox, findByEmail, getConfig, countSandboxes } from "./fleet.js";

const CONCURRENCY = Number(process.env.PROVISION_CONCURRENCY || 2);

function log(event, extra = {}) {
  console.log(JSON.stringify({ ts: Date.now(), src: "registration", event, ...extra }));
}

// --- Cola en memoria ---------------------------------------------------------

const queue = [];
let active = 0;

function pump() {
  while (active < CONCURRENCY && queue.length > 0) {
    const job = queue.shift();
    active++;
    ensureSandbox({ name: job.name, email: job.email, sendMail: true })
      .then((r) => log("job_done", { email: job.email, status: r.status, label: r.label }))
      .catch((e) =>
        log("job_failed", { email: job.email, code: e.code || "ERR", error: String(e) })
      )
      .finally(() => {
        active--;
        pump();
      });
  }
}

/** Encola un alta. Devuelve la posición aproximada en cola. */
function enqueue(job) {
  queue.push(job);
  const position = queue.length + active;
  pump();
  return position;
}

// --- Rate limit por IP: eliminado a propósito (ver nota de cabecera). En el
// evento todos comparten IP tras NAT, así que no se puede distinguir personas.

// --- Helpers HTTP ------------------------------------------------------------

function send(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(body);
}

function readBody(req, maxBytes = 16 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (c) => {
      size += c.length;
      if (size > maxBytes) {
        reject(new Error("payload demasiado grande"));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

// --- Handler público ---------------------------------------------------------

/**
 * Maneja POST /api/register. Devuelve true si consumió la request (para que el
 * server.js sepa que no debe seguir con el proxy). Response siempre JSON.
 */
export async function handleRegister(req, res) {
  let data;
  try {
    const raw = await readBody(req);
    data = JSON.parse(raw || "{}");
  } catch {
    send(res, 400, { ok: false, error: "JSON inválido" });
    return true;
  }

  const name = typeof data.name === "string" ? data.name.trim().slice(0, 120) : "";
  const email = typeof data.email === "string" ? data.email.trim().slice(0, 254) : "";

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    send(res, 400, { ok: false, error: "Email inválido" });
    return true;
  }

  // Idempotencia inmediata: si ya tiene sandbox, respondemos al toque y
  // reencolamos solo el reenvío de correo (barato, sin crear VM). Esto funciona
  // incluso con el registro cerrado: alguien que YA tiene entorno siempre puede
  // recuperar su enlace.
  const existing = findByEmail(email);
  if (existing) {
    log("register_existing", { email, label: existing.label });
    enqueue({ name, email }); // ensureSandbox detecta que existe y reenvía el correo
    send(res, 200, {
      ok: true,
      status: "exists",
      message: "Ya tenés un entorno. Te reenviamos el correo con tu enlace.",
    });
    return true;
  }

  const { maxSandboxes, registrationEnabled } = getConfig();

  // Interruptor de registro (modificable en caliente desde el MCP). Bloquea solo
  // creaciones NUEVAS; el reenvío a existentes de arriba ya pasó.
  if (!registrationEnabled) {
    log("register_disabled", { email });
    send(res, 403, {
      ok: false,
      status: "disabled",
      error: "El registro está cerrado por el momento.",
    });
    return true;
  }

  // Cap global (chequeo temprano para no encolar lo que vamos a rechazar).
  if (countSandboxes() + active + queue.length >= maxSandboxes) {
    log("register_cap_reached", { email, maxSandboxes });
    send(res, 503, {
      ok: false,
      status: "full",
      error: "Cupos agotados por ahora. Acercate al equipo del evento.",
    });
    return true;
  }

  const position = enqueue({ name, email });
  log("register_enqueued", { email, position });
  send(res, 202, {
    ok: true,
    status: "queued",
    message: "¡Listo! En menos de un minuto te llega un correo con tu entorno.",
    position,
  });
  return true;
}

/** Estado de la cola (para healthcheck / MCP). */
export function queueStatus() {
  return { active, pending: queue.length, concurrency: CONCURRENCY };
}

/**
 * Maneja GET /api/status: el formulario lo consulta al cargar para saber si el
 * registro está abierto y si hay cupo, y adaptar la UI. Público, solo lectura.
 */
export function handleStatus(req, res) {
  const { maxSandboxes, registrationEnabled } = getConfig();
  const used = countSandboxes() + active + queue.length;
  const full = used >= maxSandboxes;
  send(res, 200, {
    ok: true,
    registrationEnabled,
    full,
    // No exponemos conteos exactos al público; solo si está abierto y si hay cupo.
    open: registrationEnabled && !full,
  });
  return true;
}
