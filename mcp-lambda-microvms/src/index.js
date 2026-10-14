#!/usr/bin/env node
// index.js
// Servidor MCP (local, stdio) para AWS Lambda MicroVMs.
//
// Capas:
//   - tools/microvms.js, tools/images.js  -> GENÉRICAS (API lambda-microvms).
//       Reusables para cualquier proyecto de microVMs. Usan tu identidad AWS.
//   - tools/kiroday.js                     -> ESPECÍFICAS del evento (config/fleet
//       vía SSM). Se registran solo si KIRODAY_ENABLED != "0".
//
// Seguridad: corre LOCAL por stdio con tu perfil AWS (AWS_PROFILE). No escucha en
// ningún puerto, no hay API key, no hay superficie pública. Las acciones
// destructivas (terminate / delete version / teardown) solo se habilitan con
// MCP_ALLOW_DESTRUCTIVE=1.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { registerMicrovmTools } from "./tools/microvms.js";
import { registerImageTools } from "./tools/images.js";
import { registerKirodayTools } from "./tools/kiroday.js";

const server = new McpServer({
  name: "mcp-lambda-microvms",
  version: "0.1.0",
});

// Tools genéricas (siempre).
registerMicrovmTools(server);
registerImageTools(server);

// Tools del evento (opcionales).
if (process.env.KIRODAY_ENABLED !== "0") {
  registerKirodayTools(server);
}

const transport = new StdioServerTransport();
await server.connect(transport);

// Log a stderr (stdout está reservado para el protocolo MCP).
console.error(
  JSON.stringify({
    src: "mcp-lambda-microvms",
    event: "started",
    destructive: process.env.MCP_ALLOW_DESTRUCTIVE === "1",
    kiroday: process.env.KIRODAY_ENABLED !== "0",
    region: process.env.AWS_REGION || "us-east-1",
  })
);
