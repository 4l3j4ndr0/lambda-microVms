// routes.js
// Carga el mapa label -> { microvmId, endpoint, email } desde routes.json y lo
// recarga en caliente cuando el archivo cambia (el provisioner lo reescribe al
// crear/terminar sandboxes, sin reiniciar el proxy).

import { readFileSync, statSync } from "node:fs";
import path from "node:path";

const ROUTES_FILE = process.env.ROUTES_FILE
  ? path.resolve(process.env.ROUTES_FILE)
  : path.resolve(process.cwd(), "routes.json");

// Intervalo de polling del archivo (ms). Robusto con bind mounts de Docker,
// donde fs.watch no detecta cambios de forma confiable.
const POLL_INTERVAL_MS = Number(process.env.ROUTES_POLL_MS || 3000);

let routes = {};
let lastMtimeMs = 0;

function log(event, extra = {}) {
  console.log(JSON.stringify({ ts: Date.now(), src: "routes", event, ...extra }));
}

function loadSync(reason = "initial") {
  try {
    const raw = readFileSync(ROUTES_FILE, "utf8");
    routes = JSON.parse(raw || "{}");
    log(reason === "initial" ? "loaded" : "reloaded", {
      count: Object.keys(routes).length,
      file: ROUTES_FILE,
    });
  } catch (e) {
    if (e.code === "ENOENT") {
      routes = {};
      log("file_missing_empty", { file: ROUTES_FILE });
    } else {
      log("load_error", { error: String(e) });
    }
  }
}

// Carga inicial
try {
  lastMtimeMs = statSync(ROUTES_FILE).mtimeMs;
} catch {
  lastMtimeMs = 0;
}
loadSync("initial");

// Polling: relee solo si el mtime cambió. Confiable sobre bind mounts de Docker
// (fs.watch no dispara con reescrituras desde otro contenedor).
const pollTimer = setInterval(() => {
  let mtime;
  try {
    mtime = statSync(ROUTES_FILE).mtimeMs;
  } catch (e) {
    if (e.code !== "ENOENT") log("poll_stat_error", { error: String(e) });
    return;
  }
  if (mtime !== lastMtimeMs) {
    lastMtimeMs = mtime;
    loadSync("poll");
  }
}, POLL_INTERVAL_MS);
if (pollTimer.unref) pollTimer.unref();

/** Devuelve la ruta para un label de subdominio, o null. */
export function resolveLabel(label) {
  if (!label) return null;
  return routes[label] || null;
}

export function allLabels() {
  return Object.keys(routes);
}
