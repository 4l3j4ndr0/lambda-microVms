// aws.js
// Cliente compartido de AWS Lambda MicroVMs + helpers genéricos.
//
// Credenciales: cadena estándar del SDK (AWS_PROFILE / env / rol). Corriendo
// local, usás tu perfil SSO (ej. AWS_PROFILE=sso-personal). El MCP NO gestiona
// auth propia: la identidad y los permisos son los de quien lo lanza.
//
// Agnóstico: nada de este archivo sabe del Kiro Day. Solo mapea la API.

import { LambdaMicrovmsClient } from "@aws-sdk/client-lambda-microvms";

export const REGION = process.env.AWS_REGION || "us-east-1";

export const mvm = new LambdaMicrovmsClient({ region: REGION });

/**
 * Envuelve una respuesta de tool en el formato que espera MCP: contenido de
 * texto con JSON legible. `data` se serializa; `summary` (opcional) va primero
 * como línea humana.
 */
export function toolResult(data, summary) {
  const text =
    (summary ? summary + "\n\n" : "") + JSON.stringify(data, null, 2);
  return { content: [{ type: "text", text }] };
}

/** Envuelve un error en el formato de tool MCP (isError: true). */
export function toolError(err) {
  const msg = err instanceof Error ? err.message : String(err);
  return {
    isError: true,
    content: [{ type: "text", text: `Error: ${msg}` }],
  };
}

/** Ejecuta un comando del SDK y normaliza el resultado/errores a formato MCP. */
export async function run(command, summaryFn) {
  try {
    const res = await mvm.send(command);
    // Quitamos metadata HTTP ruidosa de la respuesta.
    const { $metadata, ...clean } = res;
    const summary = typeof summaryFn === "function" ? summaryFn(clean) : summaryFn;
    return toolResult(clean, summary);
  } catch (e) {
    return toolError(e);
  }
}
