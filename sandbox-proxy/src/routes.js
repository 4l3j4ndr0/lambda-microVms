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

// Firma del archivo para detectar cambios: mtime + inode + tamaño. Combinar los
// tres es robusto tanto si provision.js reescribe in-place (mismo inode) como si
// hace rename atómico (inode nuevo), y aunque el mtime tenga baja resolución.
function fileSig() {
  try {
    const s = statSync(ROUTES_FILE);
    return `${s.mtimeMs}:${s.ino}:${s.size}`;
  } catch (e) {
    if (e.code === "ENOENT") return "absent";
    log("poll_stat_error", { error: String(e) });
    return null; // error transitorio: no cambiar lastSig
  }
}

let lastSig = fileSig();
loadSync("initial");

// Polling: relee cuando la firma del archivo cambia. Confiable sobre bind mounts
// de Docker (fs.watch no dispara con reescrituras desde otro contenedor) y ante
// el rename atómico que usa provision.js.
const pollTimer = setInterval(() => {
  const sig = fileSig();
  if (sig === null) return; // error transitorio
  if (sig !== lastSig) {
    lastSig = sig;
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
