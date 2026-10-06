// routes.js
// Carga el mapa label -> { microvmId, endpoint, email } desde routes.json y lo
// recarga en caliente cuando el archivo cambia (el provisioner lo reescribe al
// crear/terminar sandboxes, sin reiniciar el proxy).

import { readFile, watch } from "node:fs";
import { readFileSync } from "node:fs";
import path from "node:path";

const ROUTES_FILE = process.env.ROUTES_FILE
  ? path.resolve(process.env.ROUTES_FILE)
  : path.resolve(process.cwd(), "routes.json");

let routes = {};

function log(event, extra = {}) {
  console.log(JSON.stringify({ ts: Date.now(), src: "routes", event, ...extra }));
}

function loadSync() {
  try {
    const raw = readFileSync(ROUTES_FILE, "utf8");
    routes = JSON.parse(raw || "{}");
    log("loaded", { count: Object.keys(routes).length, file: ROUTES_FILE });
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
loadSync();

// Recarga en caliente ante cambios del archivo (debounced).
let reloadTimer = null;
try {
  watch(ROUTES_FILE, () => {
    if (reloadTimer) clearTimeout(reloadTimer);
    reloadTimer = setTimeout(() => {
      readFile(ROUTES_FILE, "utf8", (err, raw) => {
        if (err) return log("reload_error", { error: String(err) });
        try {
          routes = JSON.parse(raw || "{}");
          log("reloaded", { count: Object.keys(routes).length });
        } catch (e) {
          log("reload_parse_error", { error: String(e) });
        }
      });
    }, 300);
  });
} catch (e) {
  // watch puede fallar si el archivo aún no existe; no es fatal.
  log("watch_unavailable", { error: String(e) });
}

/** Devuelve la ruta para un label de subdominio, o null. */
export function resolveLabel(label) {
  if (!label) return null;
  return routes[label] || null;
}

export function allLabels() {
  return Object.keys(routes);
}
