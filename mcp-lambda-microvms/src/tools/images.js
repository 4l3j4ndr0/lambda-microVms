// tools/images.js
// Tools GENÉRICAS sobre imágenes MicroVM. Cubren los dos niveles del modelo:
//   - Tus imágenes (de tu cuenta): list/get, versiones, builds, create/update/delete.
//   - Imágenes base gestionadas por AWS: list managed (para --base-image-arn).

import { z } from "zod";
import {
  ListMicrovmImagesCommand,
  GetMicrovmImageCommand,
  ListMicrovmImageVersionsCommand,
  GetMicrovmImageVersionCommand,
  ListMicrovmImageBuildsCommand,
  ListManagedMicrovmImagesCommand,
  ListManagedMicrovmImageVersionsCommand,
  CreateMicrovmImageCommand,
  UpdateMicrovmImageCommand,
  DeleteMicrovmImageVersionCommand,
} from "@aws-sdk/client-lambda-microvms";

import { run, toolError } from "../aws.js";

const ALLOW_DESTRUCTIVE = process.env.MCP_ALLOW_DESTRUCTIVE === "1";

export function registerImageTools(server) {
  // --- Tus imágenes ---
  server.registerTool(
    "list_microvm_images",
    {
      description:
        "Lista TUS imágenes MicroVM (de la cuenta) con su estado y la última versión " +
        "activa/fallida. nameFilter filtra por nombre. Devuelve items[].",
      inputSchema: {
        nameFilter: z.string().optional(),
        maxResults: z.number().int().positive().optional(),
        nextToken: z.string().optional(),
      },
    },
    async (args) =>
      run(
        new ListMicrovmImagesCommand(args),
        (r) => `${(r.items || []).length} imagen(es).`
      )
  );

  server.registerTool(
    "get_microvm_image",
    {
      description:
        "Detalle de una imagen MicroVM por ARN o nombre, incluida latestActiveImageVersion.",
      inputSchema: { imageIdentifier: z.string().min(1) },
    },
    async ({ imageIdentifier }) =>
      run(new GetMicrovmImageCommand({ imageIdentifier }))
  );

  server.registerTool(
    "list_microvm_image_versions",
    {
      description: "Lista las versiones (ej. 6.0, 7.0) de una imagen MicroVM.",
      inputSchema: {
        imageIdentifier: z.string().min(1),
        maxResults: z.number().int().positive().optional(),
        nextToken: z.string().optional(),
      },
    },
    async (args) => run(new ListMicrovmImageVersionsCommand(args))
  );

  server.registerTool(
    "get_microvm_image_version",
    {
      description: "Detalle de una versión concreta de una imagen MicroVM.",
      inputSchema: {
        imageIdentifier: z.string().min(1),
        imageVersion: z.string().min(1),
      },
    },
    async (args) => run(new GetMicrovmImageVersionCommand(args))
  );

  server.registerTool(
    "list_microvm_image_builds",
    {
      description:
        "Lista los builds por arquitectura/chipset de una versión de imagen.",
      inputSchema: {
        imageIdentifier: z.string().min(1),
        imageVersion: z.string().min(1),
        maxResults: z.number().int().positive().optional(),
        nextToken: z.string().optional(),
      },
    },
    async (args) => run(new ListMicrovmImageBuildsCommand(args))
  );

  // --- Imágenes base gestionadas por AWS ---
  server.registerTool(
    "list_managed_microvm_images",
    {
      description:
        "Lista las imágenes base gestionadas por AWS (ej. al2023-1) para usar como " +
        "base-image-arn al crear/actualizar imágenes. Devuelve items[].",
      inputSchema: {
        maxResults: z.number().int().positive().optional(),
        nextToken: z.string().optional(),
      },
    },
    async (args) =>
      run(
        new ListManagedMicrovmImagesCommand(args),
        (r) => `${(r.items || []).length} imagen(es) base.`
      )
  );

  server.registerTool(
    "list_managed_microvm_image_versions",
    {
      description: "Lista las versiones de una imagen base gestionada por AWS.",
      inputSchema: {
        imageArn: z.string().min(1),
        maxResults: z.number().int().positive().optional(),
        nextToken: z.string().optional(),
      },
    },
    async (args) => run(new ListManagedMicrovmImageVersionsCommand(args))
  );

  // --- Mutaciones de imagen ---
  server.registerTool(
    "create_microvm_image",
    {
      description:
        "Crea una imagen MicroVM nueva desde un zip en S3 (Dockerfile en la raíz) + " +
        "una imagen base + un build role.",
      inputSchema: {
        name: z.string().min(1),
        baseImageArn: z.string().min(1),
        buildRoleArn: z.string().min(1),
        codeArtifact: z.object({ uri: z.string().min(1) }),
        additionalOsCapabilities: z.array(z.string()).optional(),
      },
    },
    async (args) =>
      run(new CreateMicrovmImageCommand(args), (r) => `Imagen creada: ${r.imageArn || ""}`)
  );

  server.registerTool(
    "update_microvm_image",
    {
      description:
        "Construye una NUEVA versión de una imagen existente (nuevo zip en S3). Requiere " +
        "baseImageArn y buildRoleArn.",
      inputSchema: {
        imageIdentifier: z.string().min(1),
        baseImageArn: z.string().min(1),
        buildRoleArn: z.string().min(1),
        codeArtifact: z.object({ uri: z.string().min(1) }),
      },
    },
    async (args) => run(new UpdateMicrovmImageCommand(args))
  );

  // --- Destructiva ---
  if (ALLOW_DESTRUCTIVE) {
    server.registerTool(
      "delete_microvm_image_version",
      {
        description:
          "BORRA una versión de imagen (libera storage). Irreversible. Requiere " +
          "MCP_ALLOW_DESTRUCTIVE=1.",
        inputSchema: {
          imageIdentifier: z.string().min(1),
          imageVersion: z.string().min(1),
        },
      },
      async (args) =>
        run(
          new DeleteMicrovmImageVersionCommand(args),
          () => `Versión ${args.imageVersion} eliminada.`
        )
    );
  } else {
    server.registerTool(
      "delete_microvm_image_version",
      {
        description:
          "Deshabilitada. Iniciá el MCP con MCP_ALLOW_DESTRUCTIVE=1 para habilitarla.",
        inputSchema: {
          imageIdentifier: z.string().min(1),
          imageVersion: z.string().min(1),
        },
      },
      async () =>
        toolError(
          "delete_microvm_image_version está deshabilitada. Reiniciá el MCP con MCP_ALLOW_DESTRUCTIVE=1."
        )
    );
  }
}
