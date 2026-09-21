/**
 * Render edge — UI local + proxy API/WS → Cloudflare Worker (DO + SFU).
 * Reduce latencia: WS con buffer, HTTP keep-alive, timeouts cortos.
 */
import http from "node:http";
import https from "node:https";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocketServer } from "ws";
import WebSocket from "ws";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(__dirname, "public");
const PORT = Number(process.env.PORT || 10000);
const UPSTREAM =
  process.env.STREAM_UPSTREAM ||
  "https://alset-streaming-hub.lhmolam-877.workers.dev";

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".webmanifest": "application/manifest+json",
};

const httpsAgent = new https.Agent({ keepAlive: true, maxSockets: 64 });
const httpAgent = new http.Agent({ keepAlive: true, maxSockets: 64 });

function sendFile(res, filePath) {
  const ext = path.extname(filePath);
  const type = MIME[ext] || "application/octet-stream";
  const body = fs.readFileSync(filePath);
  res.writeHead(200, {
    "Content-Type": type,
    "Cache-Control":
      ext === ".html" || filePath.endsWith("index.html") ? "no-store" : "public, max-age=60",
    "Access-Control-Allow-Origin": "*",
  });
  res.end(body);
}

function proxyHttp(req, res) {
  const dest = new URL(req.url, UPSTREAM);
  const lib = dest.protocol === "https:" ? https : http;
  const agent = dest.protocol === "https:" ? httpsAgent : httpAgent;
  const headers = { ...req.headers, host: dest.host, connection: "keep-alive" };
  delete headers["accept-encoding"];
  const p = lib.request(
    dest,
    { method: req.method, headers, agent, timeout: 25000 },
    (up) => {
      const h = { ...up.headers, "access-control-allow-origin": "*" };
      res.writeHead(up.statusCode || 502, h);
      up.pipe(res);
    }
  );
  p.on("timeout", () => {
    p.destroy();
    if (!res.headersSent) {
      res.writeHead(504, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "upstream_timeout", upstream: UPSTREAM }));
    }
  });
  p.on("error", (e) => {
    if (!res.headersSent) {
      res.writeHead(502, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "upstream", message: e.message, upstream: UPSTREAM }));
    }
  });
  req.pipe(p);
}

const server = http.createServer((req, res) => {
  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET,POST,PUT,DELETE,OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type,X-Admin-Key,X-API-Key",
    });
    return res.end();
  }

  const url = new URL(req.url || "/", `http://${req.headers.host}`);

  if (url.pathname === "/api/render-health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    return res.end(
      JSON.stringify({
        ok: true,
        edge: "render",
        upstream: UPSTREAM,
        hint: "API/WS proxy → Cloudflare; media SFU en edge CF",
      })
    );
  }

  if (url.pathname.startsWith("/api/")) {
    return proxyHttp(req, res);
  }

  let rel = url.pathname === "/" ? "/index.html" : url.pathname;
  rel = path.normalize(rel).replace(/^(\.\.[/\\])+/, "");
  const filePath = path.join(PUBLIC, rel);
  if (!filePath.startsWith(PUBLIC)) {
    res.writeHead(403);
    return res.end("forbidden");
  }
  if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
    return sendFile(res, filePath);
  }
  const index = path.join(PUBLIC, "index.html");
  if (fs.existsSync(index)) return sendFile(res, index);
  res.writeHead(404);
  res.end("not found");
});

const wss = new WebSocketServer({ noServer: true });

server.on("upgrade", (req, socket, head) => {
  const url = new URL(req.url || "/", `http://${req.headers.host}`);
  if (!url.pathname.startsWith("/ws/")) {
    socket.destroy();
    return;
  }
  const dest = new URL(url.pathname + url.search, UPSTREAM);
  dest.protocol = dest.protocol === "https:" ? "wss:" : "ws:";

  const pending = [];
  let upOpen = false;
  let clientWs = null;

  const up = new WebSocket(dest.toString(), {
    headers: { Host: dest.host },
    perMessageDeflate: false,
    handshakeTimeout: 12000,
  });

  // Accept client ASAP (buffer until upstream open)
  wss.handleUpgrade(req, socket, head, (client) => {
    clientWs = client;
    client.on("message", (data, isBinary) => {
      if (upOpen && up.readyState === WebSocket.OPEN) {
        up.send(data, { binary: !!isBinary });
      } else {
        pending.push({ data, isBinary: !!isBinary });
      }
    });
    const closeBoth = () => {
      try {
        client.close();
      } catch (_) {}
      try {
        up.close();
      } catch (_) {}
    };
    client.on("close", closeBoth);
    client.on("error", closeBoth);
  });

  up.on("open", () => {
    upOpen = true;
    for (const m of pending) {
      try {
        up.send(m.data, { binary: m.isBinary });
      } catch (_) {}
    }
    pending.length = 0;
  });

  up.on("message", (data, isBinary) => {
    if (clientWs && clientWs.readyState === WebSocket.OPEN) {
      try {
        clientWs.send(data, { binary: !!isBinary });
      } catch (_) {}
    }
  });

  up.on("close", () => {
    try {
      clientWs && clientWs.close();
    } catch (_) {}
  });

  up.on("error", (err) => {
    console.error("ws upstream", err.message);
    try {
      if (clientWs) clientWs.close();
      else {
        socket.write("HTTP/1.1 502 Bad Gateway\r\n\r\n");
        socket.destroy();
      }
    } catch (_) {}
  });
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`Alset Streaming Hub (Render edge) :${PORT} → ${UPSTREAM}`);
});
