// fleet.js
// Núcleo compartido de operaciones sobre la flota de sandboxes. Lo usan tanto el
// endpoint self-service (/api/register, el día del evento) como —en el futuro—
// el MCP de operación. Toda la lógica que consulta/modifica el estado de la
// flota vive aquí UNA sola vez, para que el evento y el MCP se comporten igual.
//
// Dos archivos de estado en data/ (ambos con escritura atómica + recarga en
// caliente, igual que routes.json):
//   - routes.json  -> mapa label -> { microvmId, endpoint, email, name, createdAt }
//   - config.json  -> { maxSandboxes }  (MAX modificable en runtime, SIN reinicio)
//
// Reutiliza la lógica de AWS que ya vive en provision/provision.js (runMicrovm,
// waitRunning, saveRoutes, sendEmail, etc.) en vez de duplicarla.

import { readFileSync, writeFileSync, renameSync, existsSync } from "node:fs";
import path from "node:path";

import {
  TerminateMicrovmCommand,
  GetMicrovmCommand,
} from "@aws-sdk/client-lambda-microvms";

import {
  loadRoutes,
  saveRoutes,
  runMicrovm,
  waitRunning,
  sendEmail,
  randomLabel,
  generatePassword,
  mvm,
  BASE_DOMAIN,
  PASSWORD,
  PLATFORM_MAX_DURATION_SECONDS,
} from "../provision/provision.js";

const DATA_DIR = process.env.ROUTES_FILE
  ? path.dirname(path.resolve(process.env.ROUTES_FILE))
  : process.cwd();
const CONFIG_FILE = process.env.CONFIG_FILE
  ? path.resolve(process.env.CONFIG_FILE)
  : path.join(DATA_DIR, "config.json");

// Defaults de seguridad si config.json no existe o es inválido.
const DEFAULT_MAX = Number(process.env.MAX_SANDBOXES || 60);
// Registro habilitado por defecto salvo que se diga lo contrario por env.
const DEFAULT_REGISTRATION_ENABLED =
  process.env.REGISTRATION_ENABLED === "0" ? false : true;
// Versión de imagen por defecto: la del .env, o la que usa provision.js.
const DEFAULT_IMAGE_VERSION = process.env.IMAGE_VERSION || "7.0";
// Vida máxima (TTL duro) por defecto de cada sandbox, en segundos. Al alcanzarla
// la plataforma TERMINA la MicroVM. Default 4 h; tope de la plataforma 8 h.
const DEFAULT_MAX_DURATION = Number(
  process.env.SANDBOX_MAX_DURATION_SECONDS || 14400
);

function log(event, extra = {}) {
  console.log(JSON.stringify({ ts: Date.now(), src: "fleet", event, ...extra }));
}

/** Clampa la vida máxima al rango válido de la plataforma [60, 28800]. */
function clampMaxDuration(n) {
  const v = Number(n);
  if (!Number.isFinite(v) || v <= 0) return DEFAULT_MAX_DURATION;
  return Math.min(Math.max(Math.floor(v), 60), PLATFORM_MAX_DURATION_SECONDS);
}

// --- Config (MAX + flag de registro + versión de imagen, en caliente) --------

/** Lee config.json. Si falta o está corrupto, devuelve defaults seguros. */
export function getConfig() {
  if (!existsSync(CONFIG_FILE)) {
    return {
      maxSandboxes: DEFAULT_MAX,
      registrationEnabled: DEFAULT_REGISTRATION_ENABLED,
      imageVersion: DEFAULT_IMAGE_VERSION,
      sandboxMaxDurationSeconds: clampMaxDuration(DEFAULT_MAX_DURATION),
    };
  }
  try {
    const cfg = JSON.parse(readFileSync(CONFIG_FILE, "utf8") || "{}");
    const max = Number(cfg.maxSandboxes);
    const ver =
      typeof cfg.imageVersion === "string" && cfg.imageVersion.trim()
        ? cfg.imageVersion.trim()
        : DEFAULT_IMAGE_VERSION;
    return {
      maxSandboxes: Number.isFinite(max) && max >= 0 ? max : DEFAULT_MAX,
      // Solo false si está explícitamente en false; cualquier otra cosa -> default.
      registrationEnabled:
        typeof cfg.registrationEnabled === "boolean"
          ? cfg.registrationEnabled
          : DEFAULT_REGISTRATION_ENABLED,
      imageVersion: ver,
      sandboxMaxDurationSeconds: clampMaxDuration(
        cfg.sandboxMaxDurationSeconds != null
          ? cfg.sandboxMaxDurationSeconds
          : DEFAULT_MAX_DURATION
      ),
    };
  } catch (e) {
    log("config_read_error", { error: String(e) });
    return {
      maxSandboxes: DEFAULT_MAX,
      registrationEnabled: DEFAULT_REGISTRATION_ENABLED,
      imageVersion: DEFAULT_IMAGE_VERSION,
      sandboxMaxDurationSeconds: clampMaxDuration(DEFAULT_MAX_DURATION),
    };
  }
}

/** Escritura atómica de config.json (temp + rename en el mismo directorio). */
function saveConfig(cfg) {
  const tmp = CONFIG_FILE + ".tmp";
  writeFileSync(tmp, JSON.stringify(cfg, null, 2) + "\n");
  renameSync(tmp, CONFIG_FILE);
}

/**
 * Cambia el máximo de sandboxes permitidos en caliente (sin reiniciar). Lo usará
 * el MCP. Devuelve la config resultante.
 */
export function setMaxSandboxes(n) {
  const max = Number(n);
  if (!Number.isFinite(max) || max < 0) {
    throw new Error(`maxSandboxes inválido: ${n}`);
  }
  const cfg = { ...getConfig(), maxSandboxes: Math.floor(max) };
  saveConfig(cfg);
  log("max_sandboxes_set", { maxSandboxes: cfg.maxSandboxes });
  return cfg;
}

/**
 * Abre o cierra el formulario de registro en caliente (sin reiniciar). Lo usará
 * el MCP para habilitar el alta al arrancar el evento y cerrarla al terminar.
 * Devuelve la config resultante.
 */
export function setRegistrationEnabled(enabled) {
  const flag = Boolean(enabled);
  const cfg = { ...getConfig(), registrationEnabled: flag };
  saveConfig(cfg);
  log("registration_enabled_set", { registrationEnabled: flag });
  return cfg;
}

/**
 * Cambia la versión de imagen desde la que se lanzan las nuevas MicroVMs, en
 * caliente (sin reiniciar). Lo usará el MCP tras construir una nueva versión.
 * No valida contra AWS aquí (eso lo hace el MCP/quien llame); solo persiste.
 * Devuelve la config resultante.
 */
export function setImageVersion(version) {
  const v = String(version || "").trim();
  if (!/^\d+\.\d+$/.test(v)) {
    throw new Error(`imageVersion inválida (esperado major.minor): ${version}`);
  }
  const cfg = { ...getConfig(), imageVersion: v };
  saveConfig(cfg);
  log("image_version_set", { imageVersion: v });
  return cfg;
}

/**
 * Cambia la vida máxima (TTL duro) de los NUEVOS sandboxes, en segundos, en
 * caliente (sin reiniciar). Lo usará el MCP. Afecta solo a las MicroVMs que se
 * creen DESPUÉS del cambio; las ya corriendo conservan el TTL con el que se
 * lanzaron (es un parámetro de RunMicrovm, no se puede re-aplicar en vivo).
 * Se clampa al rango válido de la plataforma [60, 28800]. Devuelve la config.
 */
export function setSandboxMaxDuration(seconds) {
  const n = Number(seconds);
  if (!Number.isFinite(n) || n <= 0) {
    throw new Error(`sandboxMaxDurationSeconds inválido: ${seconds}`);
  }
  const clamped = clampMaxDuration(n);
  const cfg = { ...getConfig(), sandboxMaxDurationSeconds: clamped };
  saveConfig(cfg);
  log("sandbox_max_duration_set", { sandboxMaxDurationSeconds: clamped });
  return cfg;
}

// --- Estado de la flota ------------------------------------------------------

/** Lista los sandboxes como array [{ label, ...route }]. */
export function listSandboxes() {
  const routes = loadRoutes();
  return Object.entries(routes).map(([label, r]) => ({ label, ...r }));
}

/** Cuántos sandboxes hay registrados en routes.json. */
export function countSandboxes() {
  return Object.keys(loadRoutes()).length;
}

/** Normaliza un email para comparación (trim + lowercase). */
function normEmail(email) {
  return String(email || "").trim().toLowerCase();
}

/**
 * Busca un sandbox existente por email (idempotencia). Devuelve
 * { label, url, ...route } o null. Resuelve el "escaneé el QR dos veces".
 */
export function findByEmail(email) {
  const target = normEmail(email);
  if (!target) return null;
  for (const [label, r] of Object.entries(loadRoutes())) {
    if (normEmail(r.email) === target) {
      return { label, url: `https://${label}.${BASE_DOMAIN}`, ...r };
    }
  }
  return null;
}

// --- Provisión (con idempotencia + cap) --------------------------------------

/**
 * Resultado posible de ensureSandbox:
 *   { status: "exists",  label, url }  -> ya tenía uno (idempotencia)
 *   { status: "created", label, url }  -> se creó uno nuevo
 *   lanza Error con .code = "CAP_REACHED" si se alcanzó el máximo
 *   lanza Error con .code = "INVALID_EMAIL" si el email no es válido
 */
export async function ensureSandbox({ name, email, sendMail = true }) {
  const cleanEmail = normEmail(email);
  if (!isValidEmail(cleanEmail)) {
    const err = new Error("Email inválido");
    err.code = "INVALID_EMAIL";
    throw err;
  }

  // Idempotencia: si ya existe, reenvía su URL (opcionalmente el correo) y no
  // gasta otra VM. Reenvía el MISMO password que se guardó al crearlo.
  const existing = findByEmail(cleanEmail);
  if (existing) {
    log("sandbox_exists", { email: cleanEmail, label: existing.label });
    if (sendMail) {
      try {
        await sendEmail({
          name,
          email: cleanEmail,
          url: existing.url,
          password: existing.password,
        });
        log("email_resent", { email: cleanEmail, label: existing.label });
      } catch (e) {
        log("email_resend_failed", { email: cleanEmail, error: String(e) });
      }
    }
    return { status: "exists", label: existing.label, url: existing.url };
  }

  // Cap global: cinturón de seguridad contra costos/abuso. Modificable en caliente.
  const { maxSandboxes, imageVersion, sandboxMaxDurationSeconds } = getConfig();
  const current = countSandboxes();
  if (current >= maxSandboxes) {
    log("cap_reached", { current, maxSandboxes, email: cleanEmail });
    const err = new Error(`Cupo lleno (${current}/${maxSandboxes})`);
    err.code = "CAP_REACHED";
    throw err;
  }

  // Crear la VM + ruta. Reusa la lógica de provision.js. La versión de imagen y
  // la vida máxima (TTL duro) salen de config.json (modificables en caliente
  // desde el MCP), no del .env. El password es único por sandbox (CSPRNG) y se
  // entrega a la VM por runHookPayload; el mismo valor va al email.
  const password = generatePassword();
  const { microvmId, endpoint, passwordApplied } = await runMicrovm({
    imageVersion,
    maxDurationSeconds: sandboxMaxDurationSeconds,
    password,
  });
  // Password efectivo del sandbox: si la imagen tiene hook /run, se aplicó el
  // aleatorio; si no, la VM quedó con el placeholder fijo de la imagen. El email
  // y routes.json deben reflejar el que REALMENTE funciona.
  const effectivePassword = passwordApplied ? password : PASSWORD;
  log("microvm_created", {
    microvmId,
    endpoint,
    email: cleanEmail,
    imageVersion,
    sandboxMaxDurationSeconds,
    passwordApplied,
  });
  await waitRunning(microvmId);
  log("microvm_running", { microvmId });

  const label = randomLabel();
  const url = `https://${label}.${BASE_DOMAIN}`;

  // Re-chequeo de idempotencia DESPUÉS del await: si dos requests del mismo
  // email entraron casi a la vez, el segundo encuentra la ruta ya escrita y
  // descarta su VM recién creada para no dejar una huérfana.
  const routes = loadRoutes();
  const racer = Object.entries(routes).find(
    ([, r]) => normEmail(r.email) === cleanEmail
  );
  if (racer) {
    log("race_detected_discarding", { microvmId, email: cleanEmail });
    try {
      await mvm.send(new TerminateMicrovmCommand({ microvmIdentifier: microvmId }));
    } catch (e) {
      log("race_terminate_failed", { microvmId, error: String(e) });
    }
    const [existingLabel] = racer;
    return {
      status: "exists",
      label: existingLabel,
      url: `https://${existingLabel}.${BASE_DOMAIN}`,
    };
  }

  routes[label] = {
    microvmId,
    endpoint,
    email: cleanEmail,
    name: name || null,
    password: effectivePassword,
    createdAt: Date.now(),
  };
  saveRoutes(routes);
  log("route_written", { label, url, email: cleanEmail });

  if (sendMail) {
    await sendEmail({ name, email: cleanEmail, url, password: effectivePassword });
    log("email_sent", { email: cleanEmail, label });
  }

  return { status: "created", label, url, microvmId };
}

// --- Teardown (termina VM + limpia ruta, atómico) ----------------------------

/**
 * Elimina un sandbox por label: termina la MicroVM y borra su entrada de
 * routes.json en un solo paso. Resuelve el teardown manual de 2 pasos.
 * Devuelve { label, microvmId, terminated } o lanza si el label no existe.
 */
export async function teardown(label) {
  const routes = loadRoutes();
  const route = routes[label];
  if (!route) {
    const err = new Error(`Sandbox no encontrado: ${label}`);
    err.code = "NOT_FOUND";
    throw err;
  }

  let terminated = false;
  try {
    await mvm.send(
      new TerminateMicrovmCommand({ microvmIdentifier: route.microvmId })
    );
    terminated = true;
    log("microvm_terminated", { label, microvmId: route.microvmId });
  } catch (e) {
    // Si la VM ya no existe, seguimos para limpiar la ruta igualmente.
    log("terminate_failed", { label, microvmId: route.microvmId, error: String(e) });
  }

  delete routes[label];
  saveRoutes(routes);
  log("route_removed", { label });

  return { label, microvmId: route.microvmId, terminated };
}

/** Teardown por email (envoltura de conveniencia para el MCP). */
export async function teardownByEmail(email) {
  const found = findByEmail(email);
  if (!found) {
    const err = new Error(`Sin sandbox para: ${email}`);
    err.code = "NOT_FOUND";
    throw err;
  }
  return teardown(found.label);
}

// --- Reconciliación (limpia rutas huérfanas) ---------------------------------

/**
 * Reconcilia routes.json contra el estado real en AWS: borra las entradas cuya
 * MicroVM ya no está viva (TERMINATED/TERMINATING, o ya no existe). Cubre el caso
 * que teardown() NO cubre: sandboxes que la plataforma termina por su cuenta al
 * vencer el TTL duro (maximumDurationInSeconds) o la idle policy. Sin esto, esas
 * entradas quedan huérfanas en routes.json y el proxy devuelve 404/errores al
 * resolverlas.
 *
 * Pensada para dispararse periódicamente (EventBridge Scheduler -> POST
 * /__reconcile). Idempotente y segura ante altas concurrentes: recarga el archivo
 * justo antes de escribir y solo borra los labels confirmados como muertos.
 *
 * Devuelve { checked, removed: [labels] }.
 */
export async function reconcileRoutes() {
  const entries = Object.entries(loadRoutes());
  const removed = [];

  for (const [label, route] of entries) {
    try {
      const res = await mvm.send(
        new GetMicrovmCommand({ microvmIdentifier: route.microvmId })
      );
      if (res.state === "TERMINATED" || res.state === "TERMINATING") {
        removed.push(label);
      }
    } catch (e) {
      // Si la VM ya no existe, la entrada es huérfana: también se limpia.
      if (e.name === "ResourceNotFoundException") {
        removed.push(label);
      } else {
        // Error transitorio (throttling, red): no borrar, reintentar al próximo ciclo.
        log("reconcile_get_failed", {
          label,
          microvmId: route.microvmId,
          error: String(e),
        });
      }
    }
  }

  if (removed.length) {
    // Recargar JUSTO antes de escribir para no pisar sandboxes creados mientras
    // iterábamos (el ensureSandbox corre en paralelo con este barrido).
    const fresh = loadRoutes();
    for (const label of removed) delete fresh[label];
    saveRoutes(fresh);
    log("routes_reconciled", { removed });
  }

  return { checked: entries.length, removed };
}

// --- Utilidades --------------------------------------------------------------

function isValidEmail(email) {
  // Validación pragmática (no RFC completa): algo@algo.tld.
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}
