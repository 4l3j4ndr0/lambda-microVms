// tools/microvms.js
// Tools GENÉRICAS sobre instancias MicroVM. Mapean 1:1 la API de lambda-microvms.
// Nada específico de ningún caso de uso: reusable para cualquier workload.

import { z } from "zod";
import {
  RunMicrovmCommand,
  GetMicrovmCommand,
  ListMicrovmsCommand,
  SuspendMicrovmCommand,
  ResumeMicrovmCommand,
  TerminateMicrovmCommand,
  CreateMicrovmAuthTokenCommand,
} from "@aws-sdk/client-lambda-microvms";

import { run, toolError } from "../aws.js";

// Las tools destructivas solo se registran si se habilita explícitamente, para
// evitar terminaciones accidentales desde un prompt. Steering: cuidado con
// acciones destructivas.
const ALLOW_DESTRUCTIVE = process.env.MCP_ALLOW_DESTRUCTIVE === "1";

export function registerMicrovmTools(server) {
  server.registerTool(
    "list_microvms",
    {
      description:
        "Lista las MicroVMs de la cuenta con su estado y versión de imagen. Devuelve items[].",
      inputSchema: {
        maxResults: z.number().int().positive().optional(),
        nextToken: z.string().optional(),
      },
    },
    async ({ maxResults, nextToken }) =>
      run(
        new ListMicrovmsCommand({ maxResults, nextToken }),
        (r) => `${(r.items || []).length} MicroVM(s).`
      )
  );

  server.registerTool(
    "get_microvm",
    {
      description:
        "Obtiene el detalle de una MicroVM por su identificador (microvm-...).",
      inputSchema: {
        microvmIdentifier: z.string().min(1),
      },
    },
    async ({ microvmIdentifier }) =>
      run(new GetMicrovmCommand({ microvmIdentifier }))
  );

  server.registerTool(
    "run_microvm",
    {
      description:
        "Lanza una MicroVM desde una imagen. imageIdentifier es el ARN de la imagen " +
        "(el nombre pelado se rechaza). Devuelve microvmId y endpoint.",
      inputSchema: {
        imageIdentifier: z.string().min(1).describe("ARN de la imagen MicroVM"),
        imageVersion: z.string().optional().describe("major.minor, ej. 7.0"),
        executionRoleArn: z.string().optional(),
        idlePolicy: z
          .object({
            maxIdleDurationSeconds: z.number().int().optional(),
            suspendedDurationSeconds: z.number().int().optional(),
            autoResumeEnabled: z.boolean().optional(),
          })
          .optional(),
        maximumDurationInSeconds: z.number().int().optional(),
        ingressNetworkConnectors: z.array(z.string()).optional(),
        egressNetworkConnectors: z.array(z.string()).optional(),
      },
    },
    async (args) => run(new RunMicrovmCommand(args), (r) => `MicroVM ${r.microvmId} (${r.state}).`)
  );

  server.registerTool(
    "suspend_microvm",
    {
      description: "Suspende una MicroVM en ejecución (RUNNING -> SUSPENDED).",
      inputSchema: { microvmIdentifier: z.string().min(1) },
    },
    async ({ microvmIdentifier }) =>
      run(new SuspendMicrovmCommand({ microvmIdentifier }))
  );

  server.registerTool(
    "resume_microvm",
    {
      description: "Reanuda una MicroVM suspendida (SUSPENDED -> RUNNING).",
      inputSchema: { microvmIdentifier: z.string().min(1) },
    },
    async ({ microvmIdentifier }) =>
      run(new ResumeMicrovmCommand({ microvmIdentifier }))
  );

  server.registerTool(
    "create_microvm_auth_token",
    {
      description:
        "Genera un token de auth (X-aws-proxy-auth) para una MicroVM. TTL máximo 60 min; " +
        "usá el mínimo necesario. allowedPorts limita a qué puertos da acceso.",
      inputSchema: {
        microvmIdentifier: z.string().min(1),
        expirationInMinutes: z.number().int().min(1).max(60).default(15),
        allowedPorts: z
          .array(z.object({ port: z.number().int() }))
          .default([{ port: 8080 }]),
      },
    },
    async (args) => run(new CreateMicrovmAuthTokenCommand(args))
  );

  // --- Destructiva: solo si MCP_ALLOW_DESTRUCTIVE=1 ---
  if (ALLOW_DESTRUCTIVE) {
    server.registerTool(
      "terminate_microvm",
      {
        description:
          "TERMINA (destruye) una MicroVM. Irreversible. Requiere MCP_ALLOW_DESTRUCTIVE=1.",
        inputSchema: { microvmIdentifier: z.string().min(1) },
      },
      async ({ microvmIdentifier }) =>
        run(
          new TerminateMicrovmCommand({ microvmIdentifier }),
          () => `MicroVM ${microvmIdentifier} terminada.`
        )
    );
  } else {
    // Registramos una versión que explica por qué está deshabilitada, para que
    // el modelo no "invente" que la tool no existe.
    server.registerTool(
      "terminate_microvm",
      {
        description:
          "Deshabilitada. Para terminar MicroVMs, iniciá el MCP con MCP_ALLOW_DESTRUCTIVE=1.",
        inputSchema: { microvmIdentifier: z.string().min(1) },
      },
      async () =>
        toolError(
          "terminate_microvm está deshabilitada. Reiniciá el MCP con MCP_ALLOW_DESTRUCTIVE=1 para habilitar acciones destructivas."
        )
    );
  }
}
