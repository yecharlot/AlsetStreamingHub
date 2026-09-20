/**
 * Render entry — serves UI and proxies API/WS to Cloudflare Worker (SFU + DO).
 * Mobile users hit this HTTPS origin; media still uses Cloudflare Calls SFU.
 */
import http from "node:http";
import https from "node:https";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocketServer } from "ws";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
// optional undici not needed

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

function sendFile(res, filePath) {
  const ext = path.extname(filePath);
  const type = MIME[ext] || "application/octet-stream";
  const body = fs.readFileSync(filePath);
  res.writeHead(200, {
    "Content-Type": type,
    "Cache-Control": ext === ".html" || filePath.endsWith("index.html") ? "no-store" : "public, max-age=60",
    "Access-Control-Allow-Origin": "*",
  });
  res.end(body);
}

function proxyHttp(req, res) {
  const dest = new URL(req.url, UPSTREAM);
  const lib = dest.protocol === "https:" ? https : http;
  const headers = { ...req.headers, host: dest.host };
  delete headers["accept-encoding"];
  const p = lib.request(
    dest,
    { method: req.method, headers },
    (up) => {
      const h = { ...up.headers, "access-control-allow-origin": "*" };
      res.writeHead(up.statusCode || 502, h);
      up.pipe(res);
    }
  );
  p.on("error", (e) => {
    res.writeHead(502, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "upstream", message: e.message, upstream: UPSTREAM }));
  });
  req.pipe(p);
}

const server = http.createServer((req, res) => {
  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET,POST,PUT,OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type,X-Admin-Key",
    });
    return res.end();
  }

  const url = new URL(req.url || "/", `http://${req.headers.host}`);

  // Health local
  if (url.pathname === "/api/render-health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    return res.end(JSON.stringify({ ok: true, edge: "render", upstream: UPSTREAM }));
  }

  // Proxy API + SFU to Cloudflare
  if (url.pathname.startsWith("/api/")) {
    return proxyHttp(req, res);
  }

  // Static
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
  // SPA-ish fallback
  const index = path.join(PUBLIC, "index.html");
  if (fs.existsSync(index)) return sendFile(res, index);
  res.writeHead(404);
  res.end("not found");
});

// WebSocket proxy /ws/:match → Cloudflare
const wss = new WebSocketServer({ noServer: true });

server.on("upgrade", (req, socket, head) => {
  const url = new URL(req.url || "/", `http://${req.headers.host}`);
  if (!url.pathname.startsWith("/ws/")) {
    socket.destroy();
    return;
  }
  const dest = new URL(url.pathname + url.search, UPSTREAM);
  dest.protocol = dest.protocol === "https:" ? "wss:" : "ws:";

  import("ws").then(({ default: WebSocket }) => {
    const up = new WebSocket(dest.toString(), {
      headers: { Host: dest.host },
    });
    up.on("open", () => {
      wss.handleUpgrade(req, socket, head, (client) => {
        client.on("message", (data, isBinary) => {
          if (up.readyState === WebSocket.OPEN) up.send(data, { binary: !!isBinary });
        });
        up.on("message", (data, isBinary) => {
          if (client.readyState === WebSocket.OPEN) client.send(data, { binary: !!isBinary });
        });
        const closeBoth = () => {
          try { client.close(); } catch (_) {}
          try { up.close(); } catch (_) {}
        };
        client.on("close", closeBoth);
        up.on("close", closeBoth);
        client.on("error", closeBoth);
        up.on("error", closeBoth);
      });
    });
    up.on("error", (err) => {
      console.error("ws upstream", err.message);
      socket.write("HTTP/1.1 502 Bad Gateway\r\n\r\n");
      socket.destroy();
    });
  });
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`Alset Streaming Hub (Render edge) :${PORT} → ${UPSTREAM}`);
});
