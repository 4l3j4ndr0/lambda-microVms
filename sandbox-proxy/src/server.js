// server.js
// Proxy Node.js para los sandboxes de Lambda MicroVMs.
//
// Flujo por request:
//   1. Lee el Host -> extrae el label del subdominio (sa7s6a7.sandbox.awslearn.cloud -> "sa7s6a7")
//   2. Busca el label en routes.json -> { microvmId, endpoint }
//   3. Obtiene un token vigente para ese microvmId (tokenManager, renovado en bg)
//   4. Reenvía la petición al endpoint de la MicroVM por HTTPS inyectando:
//        X-aws-proxy-auth: <token>   X-aws-proxy-port: 8080   Host: <endpoint>
//   5. Soporta upgrade de WebSocket (code-server lo necesita)
//
// TLS: por defecto el proxy escucha HTTP en localhost y nginx hace el passthrough
// SNI + TLS. Si se definen TLS_CERT y TLS_KEY, el proxy termina TLS él mismo.

import http from "node:http";
import https from "node:https";
import tls from "node:tls";
import { readFileSync } from "node:fs";
import httpProxy from "http-proxy";

import { resolveLabel, allLabels } from "./routes.js";
import { ensureToken, getCachedToken } from "./tokenManager.js";

const PORT = Number(process.env.PORT || 8443);
const BASE_DOMAIN = process.env.BASE_DOMAIN || "sandbox.awslearn.cloud";
const UPSTREAM_PORT = Number(process.env.SANDBOX_PORT || 8080);

function log(event, extra = {}) {
  console.log(JSON.stringify({ ts: Date.now(), src: "server", event, ...extra }));
}

// Extrae el label del Host: "sa7s6a7.sandbox.awslearn.cloud" -> "sa7s6a7"
function labelFromHost(hostHeader) {
  if (!hostHeader) return null;
  const host = hostHeader.split(":")[0].toLowerCase();
  const suffix = "." + BASE_DOMAIN.toLowerCase();
  if (!host.endsWith(suffix)) return null;
  const label = host.slice(0, -suffix.length);
  // Solo un label simple (sin puntos adicionales), alfanumérico.
  if (!/^[a-z0-9-]+$/.test(label)) return null;
  return label;
}

const proxy = httpProxy.createProxyServer({
  changeOrigin: true,
  secure: true,
  xfwd: true,
  ws: true,
});

proxy.on("error", (err, req, res) => {
  log("proxy_error", { error: String(err), url: req?.url });
  if (res && !res.headersSent && res.writeHead) {
    res.writeHead(502, { "Content-Type": "text/plain" });
    res.end("Sandbox proxy error\n");
  } else if (res && res.destroy) {
    res.destroy();
  }
});

// Inyecta los headers de auth justo antes de enviar al upstream.
proxy.on("proxyReq", (proxyReq, req) => {
  const r = req._sandboxRoute;
  const token = req._sandboxToken;
  if (r && token) {
    proxyReq.setHeader("X-aws-proxy-auth", token);
    proxyReq.setHeader("X-aws-proxy-port", String(UPSTREAM_PORT));
    proxyReq.setHeader("Host", r.endpoint);
  }
});
proxy.on("proxyReqWs", (proxyReq, req) => {
  const r = req._sandboxRoute;
  const token = req._sandboxToken;
  if (r && token) {
    proxyReq.setHeader("X-aws-proxy-auth", token);
    proxyReq.setHeader("X-aws-proxy-port", String(UPSTREAM_PORT));
    proxyReq.setHeader("Host", r.endpoint);
  }
});

function targetFor(route) {
  // El endpoint de la MicroVM habla HTTPS en 443.
  // Pasamos el target como objeto para fijar `servername` (SNI del handshake TLS).
  // http-proxy copia host/hostname/servername del target al request saliente;
  // sin servername, el TLS al endpoint falla y el WebSocket cierra con 1006.
  return {
    protocol: "https:",
    host: route.endpoint,
    hostname: route.endpoint,
    port: 443,
    servername: route.endpoint,
  };
}

async function handleRequest(req, res) {
  // Healthcheck simple
  if (req.url === "/__health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true, labels: allLabels().length }));
    return;
  }

  const label = labelFromHost(req.headers.host);
  const route = resolveLabel(label);
  if (!route) {
    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("Sandbox no encontrado\n");
    log("route_not_found", { host: req.headers.host, label });
    return;
  }

  let token;
  try {
    token = getCachedToken(route.microvmId) || (await ensureToken(route.microvmId));
  } catch (e) {
    res.writeHead(503, { "Content-Type": "text/plain" });
    res.end("No se pudo autenticar con el sandbox\n");
    log("token_error", { label, microvmId: route.microvmId, error: String(e) });
    return;
  }

  req._sandboxRoute = route;
  req._sandboxToken = token;
  proxy.web(req, res, {
    target: targetFor(route),
    changeOrigin: true,
    secure: true,
    headers: {
      Host: route.endpoint,
      "X-aws-proxy-auth": token,
      "X-aws-proxy-port": String(UPSTREAM_PORT),
    },
  });
}

// --- Arranque: HTTP o HTTPS según haya certs ---
let server;
if (process.env.TLS_CERT && process.env.TLS_KEY) {
  server = https.createServer(
    {
      cert: readFileSync(process.env.TLS_CERT),
      key: readFileSync(process.env.TLS_KEY),
    },
    handleRequest
  );
  log("tls_enabled");
} else {
  server = http.createServer(handleRequest);
  log("tls_disabled_behind_nginx");
}

// Upgrade de WebSocket — implementación manual con tls.connect.
// http-proxy pierde/corrompe headers largos (el token JWE ~812 chars) en el
// handshake WS, causando 401 desde el endpoint. Aquí abrimos la conexión TLS al
// endpoint nosotros mismos, reenviamos el handshake de upgrade con el token
// inyectado, y hacemos pipe bidireccional de los sockets.
server.on("upgrade", async (req, socket, head) => {
  const label = labelFromHost(req.headers.host);
  const route = resolveLabel(label);
  if (!route) {
    socket.destroy();
    return;
  }
  let token;
  try {
    token = getCachedToken(route.microvmId) || (await ensureToken(route.microvmId));
  } catch (e) {
    log("ws_token_error", { label, error: String(e) });
    socket.destroy();
    return;
  }

  // Conexión TLS al endpoint de la MicroVM (HTTPS :443, SNI = endpoint).
  const upstream = tls.connect(
    { host: route.endpoint, port: 443, servername: route.endpoint },
    () => {
      // Reconstruir la request line + headers del cliente, pero con Host del
      // endpoint y los headers de auth inyectados.
      const headers = { ...req.headers };
      delete headers["host"];
      delete headers["x-aws-proxy-auth"];
      delete headers["x-aws-proxy-port"];

      let raw = `GET ${req.url} HTTP/1.1\r\n`;
      raw += `Host: ${route.endpoint}\r\n`;
      raw += `X-aws-proxy-auth: ${token}\r\n`;
      raw += `X-aws-proxy-port: ${UPSTREAM_PORT}\r\n`;
      for (const [k, v] of Object.entries(headers)) {
        if (Array.isArray(v)) {
          for (const vv of v) raw += `${k}: ${vv}\r\n`;
        } else {
          raw += `${k}: ${v}\r\n`;
        }
      }
      raw += `\r\n`;
      upstream.write(raw);
      if (head && head.length) upstream.write(head);

      // Pipe bidireccional: lo que venga del endpoint va al cliente y viceversa.
      upstream.pipe(socket);
      socket.pipe(upstream);
      log("ws_proxied", { label });
    }
  );

  upstream.on("error", (e) => {
    log("ws_upstream_error", { label, error: String(e) });
    socket.destroy();
  });
  socket.on("error", () => upstream.destroy());
});

server.listen(PORT, () => {
  log("listening", { port: PORT, baseDomain: BASE_DOMAIN });
});
