/**
 * Alset Streaming Hub — Cloudflare Worker
 * Routes matches to Durable Object rooms + static UI assets.
 * Genes/sondas Alset can call HTTP APIs here as edge helpers.
 */

import { MatchRoom } from "./room.js";

export { MatchRoom };

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // CORS for mobile / external genes
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: cors() });
    }

    // Health
    if (url.pathname === "/api/health") {
      return json({ ok: true, service: "alset-streaming-hub", v: "0.1.0" });
    }

    // Create / list helper — room id in path
    // /api/room/:matchId/...
    const roomMatch = url.pathname.match(/^\/api\/room\/([^/]+)(\/.*)?$/);
    if (roomMatch) {
      const matchId = sanitizeId(roomMatch[1]);
      const rest = roomMatch[2] || "";
      const id = env.ROOM.idFromName(matchId);
      const stub = env.ROOM.get(id);
      const dest = new URL(request.url);
      dest.pathname = rest || "/state";
      const headers = new Headers(request.headers);
      headers.set("X-Match-Id", matchId);
      return stub.fetch(new Request(dest.toString(), request));
    }

    // Convenience: /ws/:matchId?role=viewer|publisher|director
    const wsMatch = url.pathname.match(/^\/ws\/([^/]+)$/);
    if (wsMatch) {
      const matchId = sanitizeId(wsMatch[1]);
      const id = env.ROOM.idFromName(matchId);
      const stub = env.ROOM.get(id);
      return stub.fetch(request);
    }

    // Admin: quick ticket for a match (protect with header X-Admin-Key if set)
    if (url.pathname === "/api/admin/ticket" && request.method === "POST") {
      const admin = env.STREAM_ADMIN_KEY;
      if (admin && request.headers.get("X-Admin-Key") !== admin) {
        return json({ error: "unauthorized" }, 401);
      }
      const body = await request.json().catch(() => ({}));
      const matchId = sanitizeId(body.matchId || "partido-demo");
      const id = env.ROOM.idFromName(matchId);
      const stub = env.ROOM.get(id);
      return stub.fetch(
        new Request(new URL("/ticket", url).toString(), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        })
      );
    }

    // Static assets
    if (env.ASSETS) {
      return env.ASSETS.fetch(request);
    }
    return new Response("Alset Streaming Hub", { status: 200 });
  },
};

function sanitizeId(s) {
  return String(s || "default")
    .toLowerCase()
    .replace(/[^a-z0-9-_]/g, "")
    .slice(0, 64) || "default";
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...cors() },
  });
}

function cors() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type,X-Admin-Key",
  };
}
