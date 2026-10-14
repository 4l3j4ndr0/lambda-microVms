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

import { TerminateMicrovmCommand } from "@aws-sdk/client-lambda-microvms";

import {
  loadRoutes,
  saveRoutes,
  runMicrovm,
  waitRunning,
  sendEmail,
  randomLabel,
  mvm,
  BASE_DOMAIN,
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

function log(event, extra = {}) {
  console.log(JSON.stringify({ ts: Date.now(), src: "fleet", event, ...extra }));
}

// --- Config (MAX + flag de registro + versión de imagen, en caliente) --------

/** Lee config.json. Si falta o está corrupto, devuelve defaults seguros. */
export function getConfig() {
  if (!existsSync(CONFIG_FILE)) {
    return {
      maxSandboxes: DEFAULT_MAX,
      registrationEnabled: DEFAULT_REGISTRATION_ENABLED,
      imageVersion: DEFAULT_IMAGE_VERSION,
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
    };
  } catch (e) {
    log("config_read_error", { error: String(e) });
    return {
      maxSandboxes: DEFAULT_MAX,
      registrationEnabled: DEFAULT_REGISTRATION_ENABLED,
      imageVersion: DEFAULT_IMAGE_VERSION,
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
  // gasta otra VM.
  const existing = findByEmail(cleanEmail);
  if (existing) {
    log("sandbox_exists", { email: cleanEmail, label: existing.label });
    if (sendMail) {
      try {
        await sendEmail({ name, email: cleanEmail, url: existing.url });
        log("email_resent", { email: cleanEmail, label: existing.label });
      } catch (e) {
        log("email_resend_failed", { email: cleanEmail, error: String(e) });
      }
    }
    return { status: "exists", label: existing.label, url: existing.url };
  }

  // Cap global: cinturón de seguridad contra costos/abuso. Modificable en caliente.
  const { maxSandboxes, imageVersion } = getConfig();
  const current = countSandboxes();
  if (current >= maxSandboxes) {
    log("cap_reached", { current, maxSandboxes, email: cleanEmail });
    const err = new Error(`Cupo lleno (${current}/${maxSandboxes})`);
    err.code = "CAP_REACHED";
    throw err;
  }

  // Crear la VM + ruta. Reusa la lógica de provision.js. La versión de imagen
  // sale de config.json (modificable en caliente desde el MCP), no del .env.
  const { microvmId, endpoint } = await runMicrovm({ imageVersion });
  log("microvm_created", { microvmId, endpoint, email: cleanEmail, imageVersion });
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
    createdAt: Date.now(),
  };
  saveRoutes(routes);
  log("route_written", { label, url, email: cleanEmail });

  if (sendMail) {
    await sendEmail({ name, email: cleanEmail, url });
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

// --- Utilidades --------------------------------------------------------------

function isValidEmail(email) {
  // Validación pragmática (no RFC completa): algo@algo.tld.
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}
