// tools/kiroday.js
// Tools ESPECÍFICAS del Kiro Day: operan el estado del evento (config.json y
// routes.json) que vive en el EC2, vía SSM. Son wrappers finos sobre ese estado.
//
// La lógica de validación (major.minor, merge de campos) se reimplementa aquí
// a propósito: NO se importa fleet.js del proxy porque el medio de acceso es
// distinto (SSM vs filesystem local), y fleet.js apunta a archivos que no existen
// en esta máquina.

import { z } from "zod";
import {
  TerminateMicrovmCommand,
} from "@aws-sdk/client-lambda-microvms";

import { mvm, toolResult, toolError } from "../aws.js";
import { readJson, writeJsonAtomic } from "../ssm.js";

const ALLOW_DESTRUCTIVE = process.env.MCP_ALLOW_DESTRUCTIVE === "1";
const BASE_DOMAIN = process.env.KIRODAY_BASE_DOMAIN || "sandbox.awslearn.cloud";
// Host del endpoint de registro del evento (el mismo del QR). La tool de
// provisión hace un POST aquí, reusando toda la lógica del proxy: idempotencia
// por email, cap global, cola y envío del email con la URL.
const REGISTER_URL =
  process.env.KIRODAY_REGISTER_URL ||
  `https://registro.${BASE_DOMAIN}/api/register`;

// Defaults coherentes con fleet.js del proxy.
function normalizeConfig(cfg) {
  const max = Number(cfg.maxSandboxes);
  const ver =
    typeof cfg.imageVersion === "string" && cfg.imageVersion.trim()
      ? cfg.imageVersion.trim()
      : "7.0";
  return {
    maxSandboxes: Number.isFinite(max) && max >= 0 ? max : 60,
    registrationEnabled:
      typeof cfg.registrationEnabled === "boolean" ? cfg.registrationEnabled : true,
    imageVersion: ver,
  };
}

async function loadConfig() {
  const raw = await readJson("config.json");
  return normalizeConfig(raw);
}

// Merge: parte de la config actual (completa) y pisa solo los campos dados.
async function patchConfig(patch) {
  const current = await loadConfig();
  const next = { ...current, ...patch };
  return writeJsonAtomic("config.json", next);
}

export function registerKirodayTools(server) {
  server.registerTool(
    "kiroday_get_config",
    {
      description:
        "Lee la config del evento (maxSandboxes, registrationEnabled, imageVersion) " +
        "desde el EC2. Modificable en caliente sin reiniciar el proxy.",
      inputSchema: {},
    },
    async () => {
      try {
        return toolResult(await loadConfig(), "Config del evento (Kiro Day).");
      } catch (e) {
        return toolError(e);
      }
    }
  );

  server.registerTool(
    "kiroday_set_max_sandboxes",
    {
      description:
        "Cambia el máximo de sandboxes permitidos (cap global) en caliente.",
      inputSchema: { maxSandboxes: z.number().int().min(0) },
    },
    async ({ maxSandboxes }) => {
      try {
        const cfg = await patchConfig({ maxSandboxes: Math.floor(maxSandboxes) });
        return toolResult(cfg, `maxSandboxes = ${cfg.maxSandboxes}.`);
      } catch (e) {
        return toolError(e);
      }
    }
  );

  server.registerTool(
    "kiroday_set_registration_enabled",
    {
      description:
        "Abre (true) o cierra (false) el formulario de registro del evento en caliente.",
      inputSchema: { enabled: z.boolean() },
    },
    async ({ enabled }) => {
      try {
        const cfg = await patchConfig({ registrationEnabled: Boolean(enabled) });
        return toolResult(
          cfg,
          `Registro ${cfg.registrationEnabled ? "ABIERTO" : "CERRADO"}.`
        );
      } catch (e) {
        return toolError(e);
      }
    }
  );

  server.registerTool(
    "kiroday_set_image_version",
    {
      description:
        "Cambia la versión de imagen (major.minor) desde la que se crean las nuevas " +
        "MicroVMs del evento, en caliente. Validá antes que la versión esté activa.",
      inputSchema: {
        imageVersion: z.string().regex(/^\d+\.\d+$/, "Formato esperado major.minor, ej. 7.0"),
      },
    },
    async ({ imageVersion }) => {
      try {
        const cfg = await patchConfig({ imageVersion });
        return toolResult(cfg, `imageVersion = ${cfg.imageVersion}.`);
      } catch (e) {
        return toolError(e);
      }
    }
  );

  server.registerTool(
    "kiroday_provision_sandbox",
    {
      description:
        "Crea un sandbox del Kiro Day para un participante: lanza la MicroVM, registra " +
        "la ruta (subdominio) y envía el email con la URL. Hace un POST al endpoint de " +
        "registro del evento, así que hereda idempotencia (si el email ya tiene sandbox " +
        "no crea otro, reenvía su enlace), el cap global y la cola. " +
        "IMPORTANTE: pedí al usuario el NOMBRE y el EMAIL del participante si no los tenés; " +
        "ambos son obligatorios.",
      inputSchema: {
        name: z.string().min(1).describe("Nombre del participante"),
        email: z
          .string()
          .regex(/^[^\s@]+@[^\s@]+\.[^\s@]+$/, "Email inválido")
          .describe("Email del participante (recibe la URL del sandbox)"),
      },
    },
    async ({ name, email }) => {
      try {
        const res = await fetch(REGISTER_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name, email }),
        });
        let data;
        try {
          data = await res.json();
        } catch {
          data = { raw: await res.text().catch(() => "") };
        }

        if (!res.ok) {
          // El endpoint ya devuelve mensajes claros (cerrado, cupo lleno, etc.).
          return toolError(
            `Registro rechazado (${res.status}): ${data.error || data.status || JSON.stringify(data)}`
          );
        }

        const summaryByStatus = {
          queued:
            `Sandbox en cola para ${name} <${email}>. ` +
            `En ~1 min le llega el email con la URL.`,
          exists:
            `${email} ya tenía un sandbox. Se reenvió el email con su enlace ` +
            `(no se creó uno nuevo).`,
        };
        return toolResult(
          { name, email, ...data },
          summaryByStatus[data.status] || `Registro enviado para ${email}.`
        );
      } catch (e) {
        return toolError(
          `No se pudo contactar el endpoint de registro (${REGISTER_URL}): ${
            e instanceof Error ? e.message : String(e)
          }`
        );
      }
    }
  );

  server.registerTool(
    "kiroday_list_sandboxes",
    {
      description:
        "Lista los sandboxes activos del evento con su label, nombre, email y URL " +
        "(desde routes.json en el EC2). Esta es la correlación label->persona que la " +
        "API de AWS no tiene.",
      inputSchema: {},
    },
    async () => {
      try {
        const routes = await readJson("routes.json");
        const items = Object.entries(routes).map(([label, r]) => ({
          label,
          name: r.name || null,
          email: r.email || null,
          microvmId: r.microvmId || null,
          url: `https://${label}.${BASE_DOMAIN}`,
          createdAt: r.createdAt || null,
        }));
        return toolResult(
          { count: items.length, items },
          `${items.length} sandbox(es) activo(s).`
        );
      } catch (e) {
        return toolError(e);
      }
    }
  );

  // --- Destructiva: teardown (termina VM + limpia ruta) ---
  if (ALLOW_DESTRUCTIVE) {
    server.registerTool(
      "kiroday_teardown_sandbox",
      {
        description:
          "Elimina un sandbox del evento: TERMINA su MicroVM y borra su entrada de " +
          "routes.json en el EC2. Buscá por label o por email. Irreversible. " +
          "Requiere MCP_ALLOW_DESTRUCTIVE=1.",
        inputSchema: {
          label: z.string().optional(),
          email: z.string().optional(),
        },
      },
      async ({ label, email }) => {
        try {
          if (!label && !email) {
            return toolError("Indicá label o email.");
          }
          const routes = await readJson("routes.json");

          let targetLabel = label;
          if (!targetLabel && email) {
            const t = email.trim().toLowerCase();
            const found = Object.entries(routes).find(
              ([, r]) => String(r.email || "").trim().toLowerCase() === t
            );
            if (!found) return toolError(`Sin sandbox para email: ${email}`);
            targetLabel = found[0];
          }

          const route = routes[targetLabel];
          if (!route) return toolError(`Sandbox no encontrado: ${targetLabel}`);

          // Terminar la MicroVM (si ya no existe, seguimos limpiando la ruta).
          let terminated = false;
          try {
            await mvm.send(
              new TerminateMicrovmCommand({ microvmIdentifier: route.microvmId })
            );
            terminated = true;
          } catch (_) {
            /* la VM podía ya no existir */
          }

          delete routes[targetLabel];
          const written = await writeJsonAtomic("routes.json", routes);

          return toolResult(
            {
              label: targetLabel,
              microvmId: route.microvmId,
              terminated,
              remaining: Object.keys(written).length,
            },
            `Sandbox ${targetLabel} eliminado (VM ${terminated ? "terminada" : "ya no existía"}).`
          );
        } catch (e) {
          return toolError(e);
        }
      }
    );
  }
}
