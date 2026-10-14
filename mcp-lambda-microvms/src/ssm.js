// ssm.js
// Acceso al estado del evento (config.json / routes.json) que vive en el EC2,
// vía AWS SSM RunShellScript. El MCP corre LOCAL con tu perfil SSO, que ya tiene
// permiso SSM, así que no se expone ninguna superficie nueva.
//
// Esto es lo ÚNICO que acopla el MCP al Kiro Day. Las tools genéricas no lo usan.

import {
  SSMClient,
  SendCommandCommand,
  GetCommandInvocationCommand,
} from "@aws-sdk/client-ssm";

import { REGION } from "./aws.js";

const INSTANCE_ID = process.env.KIRODAY_INSTANCE_ID || "i-02df93e0743fa1e9a";
// Ruta en el server donde está montado data/ del proxy.
const APP_DIR =
  process.env.KIRODAY_APP_DIR || "/root/sandbox-proxy/source/sandbox-proxy";

const ssm = new SSMClient({ region: REGION });

/** Ejecuta un comando shell en el EC2 por SSM y devuelve stdout (o lanza). */
export async function ssmRun(command, { timeoutSeconds = 60 } = {}) {
  const sent = await ssm.send(
    new SendCommandCommand({
      InstanceIds: [INSTANCE_ID],
      DocumentName: "AWS-RunShellScript",
      TimeoutSeconds: timeoutSeconds,
      Parameters: { commands: [command] },
    })
  );
  const commandId = sent.Command?.CommandId;
  if (!commandId) throw new Error("SSM no devolvió CommandId");

  // Poll hasta estado terminal.
  const deadline = Date.now() + timeoutSeconds * 1000 + 10000;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 1500));
    let inv;
    try {
      inv = await ssm.send(
        new GetCommandInvocationCommand({
          CommandId: commandId,
          InstanceId: INSTANCE_ID,
        })
      );
    } catch (e) {
      // InvocationDoesNotExist justo tras enviar: reintentar.
      if (e.name === "InvocationDoesNotExist") continue;
      throw e;
    }
    const status = inv.Status;
    if (status === "Success") return inv.StandardOutputContent || "";
    if (["Failed", "Cancelled", "TimedOut"].includes(status)) {
      throw new Error(
        `SSM ${status}: ${inv.StandardErrorContent || inv.StandardOutputContent || ""}`
      );
    }
  }
  throw new Error("SSM timeout esperando el resultado del comando");
}

/** Lee y parsea un JSON de data/ en el server. */
export async function readJson(filename) {
  const out = await ssmRun(`cat ${APP_DIR}/data/${filename}`);
  try {
    return JSON.parse(out.trim() || "{}");
  } catch {
    throw new Error(`${filename} no es JSON válido: ${out.slice(0, 200)}`);
  }
}

/**
 * Escribe un JSON en data/ del server de forma ATÓMICA (temp + mv). El proxy lo
 * recarga solo por su polling, sin reiniciar. Evita que el proxy lea un archivo
 * a medio escribir.
 */
export async function writeJsonAtomic(filename, obj) {
  // Serializamos compacto y lo pasamos por base64 para no pelear con el quoting
  // del shell/SSM (comillas, llaves, etc.).
  const json = JSON.stringify(obj);
  const b64 = Buffer.from(json, "utf8").toString("base64");
  const cmd =
    `cd ${APP_DIR} && echo ${b64} | base64 -d > data/${filename}.tmp && ` +
    `mv data/${filename}.tmp data/${filename} && cat data/${filename}`;
  const out = await ssmRun(cmd);
  return JSON.parse(out.trim());
}
