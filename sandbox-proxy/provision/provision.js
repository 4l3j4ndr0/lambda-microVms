// provision.js
// Aprovisiona un sandbox por participante:
//   1. RunMicrovm desde la imagen kiro-sandbox
//   2. Espera a estado RUNNING (poll GetMicrovm)
//   3. Genera un label aleatorio (subdominio) -> actualiza routes.json
//   4. Envía email con la URL https://<label>.sandbox.awslearn.cloud vía SES
//
// Uso:
//   node provision/provision.js --email ana@acme.com --name "Ana"
//   node provision/provision.js --file participantes.json      (batch)
//
// participantes.json: [ { "name": "Ana", "email": "ana@acme.com" }, ... ]
//
// NOTA: no incrusta secretos. El password de code-server por ahora es fijo en la
// imagen (microvm2026); cuando se parametrice irá por runHookPayload, no aquí.

import { randomBytes } from "node:crypto";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";

import {
  LambdaMicrovmsClient,
  RunMicrovmCommand,
  GetMicrovmCommand,
} from "@aws-sdk/client-lambda-microvms";
import { SESv2Client, SendEmailCommand } from "@aws-sdk/client-sesv2";

const REGION = process.env.AWS_REGION || "us-east-1";
const ACCOUNT = process.env.ACCOUNT_ID || "590183999298";
const IMAGE = process.env.IMAGE_NAME || "kiro-sandbox";
const IMAGE_VERSION = process.env.IMAGE_VERSION || "1.0";
const EXEC_ROLE = `arn:aws:iam::${ACCOUNT}:role/MicroVMExecutionRole`;
const BASE_DOMAIN = process.env.BASE_DOMAIN || "sandbox.awslearn.cloud";
const ROUTES_FILE = process.env.ROUTES_FILE
  ? path.resolve(process.env.ROUTES_FILE)
  : path.resolve(process.cwd(), "routes.json");
const SES_FROM = process.env.SES_FROM || "no-reply@awslearn.cloud";

const IMAGE_ARN = `arn:aws:lambda:${REGION}:${ACCOUNT}:microvm-image:${IMAGE}`;

const mvm = new LambdaMicrovmsClient({ region: REGION });
const ses = new SESv2Client({ region: REGION });

function log(event, extra = {}) {
  console.log(JSON.stringify({ ts: Date.now(), src: "provision", event, ...extra }));
}

function randomLabel() {
  // 7 chars alfanuméricos en minúscula; sirve como subdominio y como secreto.
  return randomBytes(8).toString("hex").slice(0, 7);
}

function loadRoutes() {
  if (!existsSync(ROUTES_FILE)) return {};
  try {
    return JSON.parse(readFileSync(ROUTES_FILE, "utf8") || "{}");
  } catch {
    return {};
  }
}

function saveRoutes(routes) {
  writeFileSync(ROUTES_FILE, JSON.stringify(routes, null, 2) + "\n");
}

async function runMicrovm() {
  const res = await mvm.send(
    new RunMicrovmCommand({
      imageIdentifier: IMAGE_ARN,
      imageVersion: IMAGE_VERSION,
      executionRoleArn: EXEC_ROLE,
      idlePolicy: {
        maxIdleDurationSeconds: 3600,
        suspendedDurationSeconds: 1800,
        autoResumeEnabled: true,
      },
      maximumDurationInSeconds: 28800, // 8h, tope de la plataforma
    })
  );
  return { microvmId: res.microvmId, endpoint: res.endpoint, state: res.state };
}

async function waitRunning(microvmId, timeoutMs = 180000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const res = await mvm.send(new GetMicrovmCommand({ microvmIdentifier: microvmId }));
    if (res.state === "RUNNING") return res;
    if (res.state === "TERMINATED" || res.state === "TERMINATING") {
      throw new Error(`MicroVM ${microvmId} terminó inesperadamente: ${res.state} (${res.stateReason || ""})`);
    }
    await new Promise((r) => setTimeout(r, 4000));
  }
  throw new Error(`Timeout esperando RUNNING para ${microvmId}`);
}

async function sendEmail({ name, email, url }) {
  const subject = "Tu sandbox del Kiro Day está listo";
  const text =
    `Hola ${name || ""},\n\n` +
    `Tu ambiente sandbox para el Kiro Day ya está disponible.\n\n` +
    `Abre esta URL en tu navegador:\n  ${url}\n\n` +
    `Contraseña de acceso: microvm2026\n\n` +
    `El ambiente trae VS Code en el navegador con Kiro CLI preinstalado.\n` +
    `Dentro de un terminal puedes autenticarte con: kiro-cli login\n\n` +
    `Nos vemos en el workshop.\n`;
  const html =
    `<p>Hola ${name || ""},</p>` +
    `<p>Tu ambiente <b>sandbox</b> para el Kiro Day ya está disponible.</p>` +
    `<p>Abre esta URL en tu navegador:<br><a href="${url}">${url}</a></p>` +
    `<p>Contraseña de acceso: <code>microvm2026</code></p>` +
    `<p>El ambiente trae VS Code en el navegador con <b>Kiro CLI</b> preinstalado. ` +
    `Dentro de un terminal: <code>kiro-cli login</code>.</p>` +
    `<p>Nos vemos en el workshop.</p>`;

  await ses.send(
    new SendEmailCommand({
      FromEmailAddress: SES_FROM,
      Destination: { ToAddresses: [email] },
      Content: {
        Simple: {
          Subject: { Data: subject },
          Body: { Text: { Data: text }, Html: { Data: html } },
        },
      },
    })
  );
}

async function provisionOne({ name, email }) {
  log("provision_start", { email, name });
  const { microvmId, endpoint } = await runMicrovm();
  log("microvm_created", { microvmId, endpoint });

  await waitRunning(microvmId);
  log("microvm_running", { microvmId });

  const label = randomLabel();
  const url = `https://${label}.${BASE_DOMAIN}`;

  const routes = loadRoutes();
  routes[label] = { microvmId, endpoint, email, name: name || null, createdAt: Date.now() };
  saveRoutes(routes);
  log("route_written", { label, url });

  if (process.env.SKIP_EMAIL === "1") {
    log("email_skipped", { email });
  } else {
    await sendEmail({ name, email, url });
    log("email_sent", { email });
  }

  return { label, url, microvmId, endpoint };
}

// --- CLI ---
function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--email") args.email = argv[++i];
    else if (a === "--name") args.name = argv[++i];
    else if (a === "--file") args.file = argv[++i];
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv);
  let participants = [];
  if (args.file) {
    participants = JSON.parse(readFileSync(path.resolve(args.file), "utf8"));
  } else if (args.email) {
    participants = [{ email: args.email, name: args.name }];
  } else {
    console.error("Uso: node provision/provision.js --email a@b.com [--name Ana] | --file participantes.json");
    process.exit(1);
  }

  const results = [];
  for (const p of participants) {
    try {
      const r = await provisionOne(p);
      results.push({ ...p, ...r, ok: true });
    } catch (e) {
      log("provision_failed", { email: p.email, error: String(e) });
      results.push({ ...p, ok: false, error: String(e) });
    }
  }
  console.log("\n=== Resumen ===");
  for (const r of results) {
    console.log(r.ok ? `OK   ${r.email} -> ${r.url}` : `FALLO ${r.email} -> ${r.error}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
