/**
 * Alset Streaming Hub — Worker
 * Presence/tickets: Durable Object
 * Media path: Cloudflare Realtime SFU (Calls) when configured
 */

import { MatchRoom } from "./room.js";
import * as calls from "./calls.js";

export { MatchRoom };

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders() });
    }

    try {
      if (url.pathname === "/api/health") {
        return json({
          ok: true,
          service: "alset-streaming-hub",
          v: "0.2.0",
          sfu: calls.callsConfigured(env),
          secureHint: "Usa siempre HTTPS. En el móvil abre el enlace desde el navegador (Chrome/Safari), no un WebView restringido.",
        });
      }

      // —— SFU proxies (secret stays on worker) ——
      if (url.pathname === "/api/sfu/session" && request.method === "POST") {
        if (!calls.callsConfigured(env)) {
          return json({ error: "sfu_not_configured", message: "Falta CALLS_APP_ID / CALLS_APP_SECRET" }, 503);
        }
        const session = await calls.createSession(env);
        return json({ ok: true, session, iceServers: [{ urls: "stun:stun.cloudflare.com:3478" }] });
      }

      if (url.pathname === "/api/sfu/tracks" && request.method === "POST") {
        if (!calls.callsConfigured(env)) return json({ error: "sfu_not_configured" }, 503);
        const body = await request.json();
        const { sessionId, ...rest } = body;
        if (!sessionId) return json({ error: "sessionId_required" }, 400);
        const result = await calls.newTracks(env, sessionId, rest);
        return json({ ok: true, result });
      }

      if (url.pathname === "/api/sfu/renegotiate" && request.method === "POST") {
        if (!calls.callsConfigured(env)) return json({ error: "sfu_not_configured" }, 503);
        const body = await request.json();
        const { sessionId, ...rest } = body;
        if (!sessionId) return json({ error: "sessionId_required" }, 400);
        const result = await calls.renegotiate(env, sessionId, rest);
        return json({ ok: true, result });
      }

      if (url.pathname === "/api/sfu/close" && request.method === "POST") {
        if (!calls.callsConfigured(env)) return json({ error: "sfu_not_configured" }, 503);
        const body = await request.json();
        const { sessionId, ...rest } = body;
        const result = await calls.closeTracks(env, sessionId, rest);
        return json({ ok: true, result });
      }

      // Room HTTP + WS
      const roomMatch = url.pathname.match(/^\/api\/room\/([^/]+)(\/.*)?$/);
      if (roomMatch) {
        const matchId = sanitizeId(roomMatch[1]);
        const rest = roomMatch[2] || "/state";
        const stub = env.ROOM.get(env.ROOM.idFromName(matchId));
        const dest = new URL(request.url);
        dest.pathname = rest;
        return withCors(await stub.fetch(new Request(dest.toString(), request)));
      }

      const wsMatch = url.pathname.match(/^\/ws\/([^/]+)$/);
      if (wsMatch) {
        const matchId = sanitizeId(wsMatch[1]);
        const stub = env.ROOM.get(env.ROOM.idFromName(matchId));
        // Forward original request (preserves Upgrade: websocket)
        return stub.fetch(request);
      }

      if (url.pathname === "/api/admin/ticket" && request.method === "POST") {
        const admin = env.STREAM_ADMIN_KEY;
        if (admin && request.headers.get("X-Admin-Key") !== admin) {
          return json({ error: "unauthorized" }, 401);
        }
        const body = await request.json().catch(() => ({}));
        const matchId = sanitizeId(body.matchId || "partido-demo");
        const stub = env.ROOM.get(env.ROOM.idFromName(matchId));
        return withCors(
          await stub.fetch(
            new Request(new URL("/ticket", url.origin), {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(body),
            })
          )
        );
      }

      // Static assets (mobile-friendly cache)
      if (env.ASSETS) {
        const res = await env.ASSETS.fetch(request);
        const headers = new Headers(res.headers);
        headers.set("Access-Control-Allow-Origin", "*");
        // Avoid stale HTML on phones
        if (url.pathname.endsWith(".html") || url.pathname === "/") {
          headers.set("Cache-Control", "no-store");
        }
        return new Response(res.body, { status: res.status, headers });
      }

      return json({ ok: true, service: "alset-streaming-hub" });
    } catch (e) {
      return json({ error: e.message || String(e), data: e.data || null }, e.status || 500);
    }
  },
};

function sanitizeId(s) {
  return (
    String(s || "default")
      .toLowerCase()
      .replace(/[^a-z0-9-_]/g, "")
      .slice(0, 64) || "default"
  );
}

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,PUT,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type,X-Admin-Key",
  };
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders() },
  });
}

function withCors(res) {
  const headers = new Headers(res.headers);
  Object.entries(corsHeaders()).forEach(([k, v]) => headers.set(k, v));
  return new Response(res.body, { status: res.status, headers });
}
