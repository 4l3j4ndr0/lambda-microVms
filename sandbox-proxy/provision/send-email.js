// send-email.js — reenvía SOLO el email de un sandbox ya aprovisionado.
// Útil cuando la MicroVM ya existe y la ruta está registrada, pero el envío
// falló (o se usó SKIP_EMAIL). Reusa buildEmail de provision.js.
//
// Uso (dentro del server, como contenedor efímero):
//   docker run --rm --env-file .env sandbox-proxy \
//     node provision/send-email.js --email a@b.com --name "Ana" --url https://xxx.sandbox.awslearn.cloud
//
// No crea MicroVMs ni toca routes.json.

import { SESv2Client, SendEmailCommand } from "@aws-sdk/client-sesv2";
import { buildEmail } from "./provision.js";

const REGION = process.env.AWS_REGION || "us-east-1";
const SES_FROM = process.env.SES_FROM || "no-reply@awslearn.cloud";
const PASSWORD = process.env.SANDBOX_PASSWORD || "microvm2026";

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--email") args.email = argv[++i];
    else if (a === "--name") args.name = argv[++i];
    else if (a === "--url") args.url = argv[++i];
  }
  return args;
}

async function main() {
  const { email, name, url } = parseArgs(process.argv);
  if (!email || !url) {
    console.error("Uso: node provision/send-email.js --email a@b.com [--name Ana] --url https://xxx.sandbox.awslearn.cloud");
    process.exit(1);
  }
  const ses = new SESv2Client({ region: REGION });
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
  console.log(JSON.stringify({ src: "send-email", event: "email_sent", email, url }));
}

main().catch((e) => { console.error(e); process.exit(1); });
