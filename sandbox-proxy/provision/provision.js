// provision.js
// Aprovisiona un sandbox por participante:
//   1. RunMicrovm desde la imagen kiro-sandbox
//   2. Espera a estado RUNNING (poll GetMicrovm)
//   3. Genera un label aleatorio (subdominio) -> actualiza routes.json
//   4. Envía email con la URL https://<label>.sandbox.awslearn.cloud vía SES
//
// Uso (dentro del server, como contenedor efímero que comparte el dir data/):
//   docker run --rm --env-file .env -e IMAGE_VERSION=4.0 \
//     -v $(pwd)/data:/app/data sandbox-proxy \
//     node provision/provision.js --email ana@acme.com --name "Ana"
//
//   # batch:
//   ... node provision/provision.js --file participantes.json
//
// participantes.json: [ { "name": "Ana", "email": "ana@acme.com" }, ... ]
//
// IMPORTANTE: montar el DIRECTORIO data/ (no routes.json) para que el proxy vea
// la ruta nueva al instante (el polling detecta el cambio sin reiniciar).
//
// NOTA: no incrusta secretos. El password de code-server por ahora es fijo en la
// imagen (microvm2026); cuando se parametrice irá por runHookPayload, no aquí.

import { randomBytes } from "node:crypto";
import { readFileSync, writeFileSync, renameSync, existsSync } from "node:fs";
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
const IMAGE_VERSION = process.env.IMAGE_VERSION || "6.0";
const EXEC_ROLE = `arn:aws:iam::${ACCOUNT}:role/MicroVMExecutionRole`;
const BASE_DOMAIN = process.env.BASE_DOMAIN || "sandbox.awslearn.cloud";
const ROUTES_FILE = process.env.ROUTES_FILE
  ? path.resolve(process.env.ROUTES_FILE)
  : path.resolve(process.cwd(), "routes.json");
const SES_FROM = process.env.SES_FROM || "no-reply@awslearn.cloud";
// Password de code-server (fijo en la imagen por ahora; igual que en app.py).
// Cuando se parametrice por participante, vendrá por runHookPayload.
const PASSWORD = process.env.SANDBOX_PASSWORD || "microvm2026";

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
  // Escritura atómica: escribir a un temporal en el MISMO directorio y luego
  // rename (operación atómica en el mismo filesystem). Evita que el proxy lea
  // un JSON a medio escribir. El rename cambia el inode, pero como se monta el
  // DIRECTORIO data/ (no el archivo), el proxy ve el archivo nuevo y el polling
  // por mtime lo recarga.
  const tmp = ROUTES_FILE + ".tmp";
  writeFileSync(tmp, JSON.stringify(routes, null, 2) + "\n");
  renameSync(tmp, ROUTES_FILE);
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

// Escapa texto para interpolar de forma segura dentro de HTML.
function esc(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const KIRO_LOGO =
  "https://cdn.jsdelivr.net/gh/glincker/thesvg@main/public/icons/kiro/default.svg";

function buildEmail({ name, url, password }) {
  const safeName = esc(name) || "participante";
  const safeUrl = esc(url);
  const safePass = esc(password);
  const subject = "Tu entorno del Kiro Day Medellín 2026 está listo 🚀";

  // Versión texto plano (fallback para clientes sin HTML).
  const text =
    `Hola ${name || "participante"},\n\n` +
    `Tu entorno de desarrollo para el Kiro Day Medellín 2026 ya está listo.\n\n` +
    `Ábrelo en tu navegador:\n  ${url}\n\n` +
    `Contraseña de acceso: ${password}\n\n` +
    `El entorno trae VS Code en el navegador con Kiro CLI preinstalado.\n` +
    `Para autenticar Kiro, abre un terminal y ejecuta: kiro-cli login --use-device-flow\n\n` +
    `Consejos:\n` +
    `  • Úsalo desde un navegador moderno (Chrome, Edge, Firefox).\n` +
    `  • Tu entorno es personal: no compartas la URL ni la contraseña.\n\n` +
    `Nos vemos en el workshop.\n` +
    `— Equipo Kiro Day Medellín 2026\n`;

  // Versión HTML: tablas + estilos inline (compatibilidad Gmail/Outlook).
  const html = `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<meta name="color-scheme" content="light dark" />
<title>${subject}</title>
</head>
<body style="margin:0;padding:0;background:#0f0f17;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#0f0f17;padding:24px 12px;">
  <tr>
    <td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#1b1b2b;border:1px solid #2b2b40;border-radius:16px;overflow:hidden;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">

        <!-- Header -->
        <tr>
          <td style="padding:28px 32px 20px 32px;background:linear-gradient(135deg,#2a1a4a 0%,#1b1b2b 100%);border-bottom:1px solid #2b2b40;">
            <table role="presentation" cellpadding="0" cellspacing="0">
              <tr>
                <td style="vertical-align:middle;padding-right:12px;">
                  <img src="${KIRO_LOGO}" alt="Kiro" width="36" height="36" style="display:block;border:0;" />
                </td>
                <td style="vertical-align:middle;">
                  <div style="font-size:20px;font-weight:700;color:#ffffff;line-height:1.2;">Kiro Day <span style="color:#bd93f9;">Medell&iacute;n 2026</span></div>
                  <div style="font-size:13px;color:#8b8ba7;margin-top:2px;">Tu entorno de desarrollo est&aacute; listo</div>
                </td>
              </tr>
            </table>
          </td>
        </tr>

        <!-- Body -->
        <tr>
          <td style="padding:28px 32px 8px 32px;">
            <p style="margin:0 0 14px 0;font-size:16px;color:#f8f8f2;">Hola <strong>${safeName}</strong>,</p>
            <p style="margin:0 0 20px 0;font-size:15px;line-height:1.6;color:#c7c7d9;">
              Ya tienes tu <strong style="color:#f8f8f2;">sandbox personal</strong> para el workshop: un
              <strong style="color:#50fa7b;">VS Code</strong> completo en el navegador con
              <strong style="color:#8be9fd;">Kiro CLI</strong> preinstalado. Sin instalar nada en tu equipo.
            </p>
          </td>
        </tr>

        <!-- CTA -->
        <tr>
          <td align="center" style="padding:4px 32px 24px 32px;">
            <table role="presentation" cellpadding="0" cellspacing="0">
              <tr>
                <td style="border-radius:10px;background:linear-gradient(135deg,#bd93f9,#8be9fd);">
                  <a href="${safeUrl}" target="_blank"
                     style="display:inline-block;padding:14px 32px;font-size:16px;font-weight:600;color:#0f0f17;text-decoration:none;border-radius:10px;">
                    Abrir mi entorno &rarr;
                  </a>
                </td>
              </tr>
            </table>
            <p style="margin:12px 0 0 0;font-size:12px;color:#6272a4;word-break:break-all;">
              o copia este enlace:<br />
              <a href="${safeUrl}" target="_blank" style="color:#8be9fd;text-decoration:none;">${safeUrl}</a>
            </p>
          </td>
        </tr>

        <!-- Credenciales -->
        <tr>
          <td style="padding:0 32px 24px 32px;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#13131f;border:1px solid #2b2b40;border-radius:12px;">
              <tr>
                <td style="padding:16px 20px;">
                  <div style="font-size:12px;text-transform:uppercase;letter-spacing:0.6px;color:#6272a4;margin-bottom:6px;">Contrase&ntilde;a de acceso</div>
                  <div style="font-size:18px;font-weight:700;color:#50fa7b;font-family:'SF Mono',Menlo,Consolas,monospace;letter-spacing:0.5px;">${safePass}</div>
                </td>
              </tr>
            </table>
          </td>
        </tr>

        <!-- Siguiente paso -->
        <tr>
          <td style="padding:0 32px 24px 32px;">
            <p style="margin:0 0 8px 0;font-size:14px;color:#c7c7d9;line-height:1.6;">
              Dentro del editor, abre un <strong style="color:#f8f8f2;">terminal</strong> y autentica Kiro:
            </p>
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#0d0d16;border:1px solid #2b2b40;border-radius:10px;">
              <tr>
                <td style="padding:12px 16px;font-family:'SF Mono',Menlo,Consolas,monospace;font-size:14px;color:#8be9fd;">
                  <span style="color:#6272a4;">$</span> kiro-cli login --use-device-flow
                </td>
              </tr>
            </table>
          </td>
        </tr>

        <!-- Nota de seguridad -->
        <tr>
          <td style="padding:0 32px 28px 32px;">
            <p style="margin:0;font-size:12px;color:#6272a4;line-height:1.6;">
              🔒 Tu entorno es personal. No compartas la URL ni la contrase&ntilde;a. Usa un navegador moderno (Chrome, Edge o Firefox).
            </p>
          </td>
        </tr>

        <!-- Footer -->
        <tr>
          <td style="padding:18px 32px;background:#13131f;border-top:1px solid #2b2b40;">
            <p style="margin:0;font-size:12px;color:#6272a4;text-align:center;">
              Kiro Day Medell&iacute;n 2026 &middot; Nos vemos en el workshop 👋
            </p>
          </td>
        </tr>

      </table>
    </td>
  </tr>
</table>
</body>
</html>`;

  return { subject, text, html };
}

async function sendEmail({ name, email, url }) {
  const { subject, text, html } = buildEmail({ name, url, password: PASSWORD });
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
