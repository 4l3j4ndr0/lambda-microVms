// server.js
// Proxy Node.js para los sandboxes de Lambda MicroVMs.
//
// Flujo por request:
//   1. Lee el Host -> extrae el label del subdominio
//      (sa7s6a7.sandbox.awslearn.cloud -> "sa7s6a7")
//   2. Busca el label en routes.json -> { microvmId, endpoint }
//   3. Obtiene un token vigente para ese microvmId (tokenManager, bg refresh)
//   4. Reenvía la petición al endpoint de la MicroVM por HTTPS.
//   5. Reescribe el Set-Cookie del upstream (quita Domain) para que el navegador
//      asocie la cookie de sesión al dominio del sandbox, no al endpoint crudo.
//   6. Soporta upgrade de WebSocket inyectando auth/puerto como subprotocolos.
//
// --- CAUSA RAÍZ DEL "WebSocket close 1006" (resuelta aquí) ---
// code-server emite Set-Cookie con Domain = <endpoint>.lambda-microvm.on.aws
// (lo deriva del Host que le mandamos). El navegador, que está en
// <label>.sandbox.awslearn.cloud, DESCARTA esa cookie por dominio no
// coincidente. Sin cookie, el upgrade WS del workbench llega sin sesión y
// code-server responde 401 -> el cliente cierra con 1006.
// Fix: reescribir Set-Cookie eliminando el atributo Domain (cookie host-only).
//
// --- AUTENTICACIÓN WS ---
// En un upgrade WebSocket el endpoint NO lee X-aws-proxy-auth/-port; la
// metadata del proxy viaja como SUBPROTOCOLOS en Sec-WebSocket-Protocol:
//   lambda-microvms.authentication.<token>, lambda-microvms, lambda-microvms.port.<n>
// El endpoint los consume y los elimina antes de reenviar a la app.
//
// TLS: por defecto el proxy escucha HTTP en localhost y nginx hace el
// passthrough SNI + TLS. Si se definen TLS_CERT y TLS_KEY, el proxy termina TLS.

import http from "node:http";
import https from "node:https";
import tls from "node:tls";
import { readFileSync } from "node:fs";

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

// Reescribe los valores de Set-Cookie que vienen del upstream:
//   - Elimina el atributo "Domain=..." -> la cookie queda host-only y el
//     navegador la asocia al dominio del sandbox (<label>.sandbox.awslearn.cloud).
//   - Garantiza "Secure" (vamos sobre HTTPS de cara al navegador).
function rewriteSetCookie(value) {
  const parts = value.split(";").map((p) => p.trim());
  const kept = parts.filter((p) => !/^domain=/i.test(p));
  if (!kept.some((p) => /^secure$/i.test(p))) kept.push("Secure");
  return kept.join("; ");
}

async function resolveRouteAndToken(req, onError) {
  const label = labelFromHost(req.headers.host);
  const route = resolveLabel(label);
  if (!route) {
    onError(404, "Sandbox no encontrado\n");
    log("route_not_found", { host: req.headers.host, label });
    return null;
  }
  let token;
  try {
    token = getCachedToken(route.microvmId) || (await ensureToken(route.microvmId));
  } catch (e) {
    onError(503, "No se pudo autenticar con el sandbox\n");
    log("token_error", { label, microvmId: route.microvmId, error: String(e) });
    return null;
  }
  return { label, route, token };
}

// --- Proxy HTTP manual (https.request) ---
// Lo hacemos manual (en vez de http-proxy) para poder interceptar y reescribir
// los headers de respuesta del upstream, en particular Set-Cookie.
async function handleRequest(req, res) {
  // Healthcheck simple
  if (req.url === "/__health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true, labels: allLabels().length }));
    return;
  }

  const ctx = await resolveRouteAndToken(req, (code, msg) => {
    res.writeHead(code, { "Content-Type": "text/plain" });
    res.end(msg);
  });
  if (!ctx) return;
  const { label, route, token } = ctx;

  // Copiamos los headers del cliente, fijamos Host del endpoint e inyectamos
  // los headers de auth. Quitamos cualquier x-aws-proxy-* entrante del cliente.
  const headers = { ...req.headers };
  delete headers["x-aws-proxy-auth"];
  delete headers["x-aws-proxy-port"];
  headers["host"] = route.endpoint;
  headers["x-aws-proxy-auth"] = token;
  headers["x-aws-proxy-port"] = String(UPSTREAM_PORT);

  const upstreamReq = https.request(
    {
      host: route.endpoint,
      port: 443,
      servername: route.endpoint,
      method: req.method,
      path: req.url,
      headers,
    },
    (upstreamRes) => {
      // Reescribir Set-Cookie (quitar Domain) antes de devolver al navegador.
      const outHeaders = { ...upstreamRes.headers };
      const sc = upstreamRes.headers["set-cookie"];
      if (sc) {
        outHeaders["set-cookie"] = (Array.isArray(sc) ? sc : [sc]).map(rewriteSetCookie);
      }
      res.writeHead(upstreamRes.statusCode || 502, outHeaders);
      upstreamRes.pipe(res);
    }
  );

  upstreamReq.on("error", (e) => {
    log("http_upstream_error", { label, error: String(e), url: req.url });
    if (!res.headersSent) {
      res.writeHead(502, { "Content-Type": "text/plain" });
      res.end("Sandbox proxy error\n");
    } else {
      res.destroy();
    }
  });

  req.pipe(upstreamReq);
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

// --- Upgrade de WebSocket ---
// Implementación manual con tls.connect. La auth y el puerto van como
// SUBPROTOCOLOS (el endpoint no lee X-aws-proxy-* en un upgrade WS). La cookie
// de sesión del cliente se reenvía intacta (code-server la exige en el WS).
server.on("upgrade", async (req, socket, head) => {
  const ctx = await resolveRouteAndToken(req, () => socket.destroy());
  if (!ctx) {
    socket.destroy();
    return;
  }
  const { label, route, token } = ctx;

  const upstream = tls.connect(
    { host: route.endpoint, port: 443, servername: route.endpoint },
    () => {
      // Subprotocolos lambda-microvms.* (auth + puerto). Preservamos los
      // subprotocolos que envíe el cliente (code-server) y los anteponemos.
      const clientProtocols = (req.headers["sec-websocket-protocol"] || "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);

      const lmProtocols = [
        `lambda-microvms.authentication.${token}`,
        "lambda-microvms",
        `lambda-microvms.port.${UPSTREAM_PORT}`,
      ];

      const mergedProtocols = [...lmProtocols, ...clientProtocols].join(", ");

      // Reconstruir el handshake con Host del endpoint. Mantenemos los demás
      // headers del cliente (incluida Cookie, clave para code-server).
      const headers = { ...req.headers };
      delete headers["host"];
      delete headers["x-aws-proxy-auth"];
      delete headers["x-aws-proxy-port"];
      delete headers["sec-websocket-protocol"];

      // --- CAUSA RAÍZ DEL 403 EN EL WS ---
      // El proxy del endpoint valida el header Origin (anti-CSRF): sólo acepta
      // el upgrade si Origin coincide con el hostname del endpoint (o está
      // ausente). El navegador manda Origin = https://<label>.sandbox...,
      // que NO coincide -> 403. Reescribimos Origin al host del endpoint.
      if ("origin" in headers) {
        headers["origin"] = `https://${route.endpoint}`;
      }

      let raw = `GET ${req.url} HTTP/1.1\r\n`;
      raw += `Host: ${route.endpoint}\r\n`;
      raw += `Sec-WebSocket-Protocol: ${mergedProtocols}\r\n`;
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

      // Qué subprotocolo pidió el cliente original (si pidió alguno). El
      // navegador/code-server sólo tolera que la respuesta contenga uno que ÉL
      // haya pedido; los subprotocolos lambda-microvms.* los inyectamos nosotros
      // y hay que removerlos de la respuesta del handshake.
      const clientWanted = new Set(clientProtocols.map((p) => p.toLowerCase()));

      // Interceptar la respuesta de upgrade del upstream: leemos hasta el fin de
      // headers (\r\n\r\n), reescribimos Sec-WebSocket-Protocol, y recién ahí
      // conectamos el pipe bidireccional con el resto del stream.
      let respBuf = Buffer.alloc(0);
      let headersDone = false;

      const onUpstreamData = (chunk) => {
        if (headersDone) return;
        respBuf = Buffer.concat([respBuf, chunk]);
        const sep = respBuf.indexOf("\r\n\r\n");
        if (sep === -1) {
          // Protección: si los headers crecen demasiado, abortar.
          if (respBuf.length > 64 * 1024) {
            log("ws_response_headers_too_large", { label });
            upstream.destroy();
            socket.destroy();
          }
          return;
        }
        headersDone = true;
        upstream.removeListener("data", onUpstreamData);

        const headerText = respBuf.slice(0, sep).toString("utf8");
        const rest = respBuf.slice(sep + 4);

        const lines = headerText.split("\r\n");
        const statusLineText = lines[0]; // "HTTP/1.1 101 Switching Protocols"
        const rewritten = [];
        for (let i = 1; i < lines.length; i++) {
          const line = lines[i];
          const idx = line.indexOf(":");
          if (
            idx !== -1 &&
            line.slice(0, idx).trim().toLowerCase() === "sec-websocket-protocol"
          ) {
            const vals = line
              .slice(idx + 1)
              .split(",")
              .map((s) => s.trim())
              .filter((p) => clientWanted.has(p.toLowerCase()));
            // Re-emitimos sólo subprotocolos que el cliente SÍ pidió. El endpoint
            // siempre selecciona "lambda-microvms" (que ocultamos). Si el cliente
            // pidió uno propio, le devolvemos su primera opción para que acepte el
            // handshake; si no pidió ninguno, omitimos el header por completo.
            let out = vals;
            if (!out.length && clientProtocols.length) out = [clientProtocols[0]];
            if (out.length) rewritten.push(`Sec-WebSocket-Protocol: ${out.join(", ")}`);
            continue;
          }
          rewritten.push(line);
        }

        const status = statusLineText.split(" ")[1] || "?";
        log("ws_upstream_response", { label, status });

        const finalHead = [statusLineText, ...rewritten].join("\r\n") + "\r\n\r\n";
        socket.write(finalHead);
        if (rest.length) socket.write(rest);

        // A partir de aquí, pipe bidireccional del tráfico WS.
        upstream.pipe(socket);
        socket.pipe(upstream);
        log("ws_proxied", { label, url: req.url });
      };

      upstream.on("data", onUpstreamData);
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
