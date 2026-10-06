// tokenManager.js
// Genera y mantiene vigentes los tokens de auth (X-aws-proxy-auth) de cada MicroVM.
//
// Los tokens de Lambda MicroVMs expiran en máximo 60 min. En vez de generar uno
// por request (costoso y rate-limited), mantenemos un token por microvmId en
// memoria y lo renovamos en background antes de que expire.
//
// Convención del steering: TTL mínimo necesario. Usamos 60 min de vida y
// renovamos a los ~50 (REFRESH_MARGIN_MS antes de expirar).

import {
  LambdaMicrovmsClient,
  CreateMicrovmAuthTokenCommand,
} from "@aws-sdk/client-lambda-microvms";

const REGION = process.env.AWS_REGION || "us-east-1";
// Steering: TTL mínimo necesario, nunca 60 min por defecto. 30 min basta y el
// background refresh (REFRESH_MARGIN_MS antes de expirar) mantiene continuidad.
const TOKEN_TTL_MIN = Number(process.env.TOKEN_TTL_MIN || 30);
const REFRESH_MARGIN_MS = Number(process.env.REFRESH_MARGIN_MS || 10 * 60 * 1000); // renovar 10 min antes
const ALLOWED_PORT = Number(process.env.SANDBOX_PORT || 8080); // code-server

const client = new LambdaMicrovmsClient({ region: REGION });

// microvmId -> { token, expiresAt (ms epoch), timer }
const cache = new Map();

function log(event, extra = {}) {
  console.log(JSON.stringify({ ts: Date.now(), src: "tokenManager", event, ...extra }));
}

async function fetchToken(microvmId) {
  const res = await client.send(
    new CreateMicrovmAuthTokenCommand({
      microvmIdentifier: microvmId,
      expirationInMinutes: TOKEN_TTL_MIN,
      allowedPorts: [{ port: ALLOWED_PORT }], // least-privilege: solo code-server
    })
  );
  // La forma exacta de la respuesta: authToken["X-aws-proxy-auth"]
  const token =
    res?.authToken?.["X-aws-proxy-auth"] ||
    res?.authToken?.["x-aws-proxy-auth"];
  if (!token) {
    throw new Error("respuesta sin X-aws-proxy-auth: " + JSON.stringify(res?.authToken || {}));
  }
  return token;
}

/**
 * Asegura que haya un token vigente para microvmId y programa su renovación.
 * Devuelve el token actual.
 */
export async function ensureToken(microvmId) {
  const entry = cache.get(microvmId);
  const now = Date.now();
  if (entry && entry.token && entry.expiresAt - now > REFRESH_MARGIN_MS) {
    return entry.token;
  }
  return refreshToken(microvmId);
}

async function refreshToken(microvmId) {
  const token = await fetchToken(microvmId);
  const expiresAt = Date.now() + TOKEN_TTL_MIN * 60 * 1000;

  const prev = cache.get(microvmId);
  if (prev?.timer) clearTimeout(prev.timer);

  // Programa la renovación antes de expirar.
  const delay = Math.max(TOKEN_TTL_MIN * 60 * 1000 - REFRESH_MARGIN_MS, 60 * 1000);
  const timer = setTimeout(() => {
    refreshToken(microvmId).catch((e) =>
      log("refresh_failed", { microvmId, error: String(e) })
    );
  }, delay);
  if (timer.unref) timer.unref();

  cache.set(microvmId, { token, expiresAt, timer });
  log("token_refreshed", { microvmId, expiresInMin: TOKEN_TTL_MIN });
  return token;
}

/** Devuelve el token cacheado (sin await) o null si no existe aún. */
export function getCachedToken(microvmId) {
  return cache.get(microvmId)?.token || null;
}

/** Elimina un microvm del cache (p.ej. al terminar la sesión). */
export function forget(microvmId) {
  const entry = cache.get(microvmId);
  if (entry?.timer) clearTimeout(entry.timer);
  cache.delete(microvmId);
}
