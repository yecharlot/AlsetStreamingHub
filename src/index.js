/**
 * Alset Streaming Hub — Worker SaaS
 * Genes de borde + MatchRoom DO + SFU Cloudflare Calls + registro de orgs
 */

import { MatchRoom } from "./room.js";
import { SaaSRegistry } from "./saas.js";
import * as calls from "./calls.js";
import { PLANS } from "./gene.js";

export { MatchRoom, SaaSRegistry };

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
          v: "1.0.0-saas",
          model: "alset-edge-gene-swarm",
          sfu: calls.callsConfigured(env),
          plans: Object.keys(PLANS),
          secureHint: "HTTPS obligatorio. Móvil: Chrome/Safari, no WebView restringido.",
        });
      }

      // —— SaaS registry DO ——
      if (url.pathname.startsWith("/api/saas")) {
        const stub = env.SAAS.get(env.SAAS.idFromName("global"));
        const u = new URL(request.url);
        u.pathname = url.pathname.replace(/^\/api\/saas/, "") || "/";
        return withCors(await stub.fetch(new Request(u, request)));
      }

      // —— SFU proxies ——
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


      // Público: datos de pago del organizador del match
      const payMatch = url.pathname.match(/^\/api\/pay\/match\/([^/]+)$/);
      if (payMatch && request.method === "GET") {
        const matchId = sanitizeId(payMatch[1]);
        const stub = env.ROOM.get(env.ROOM.idFromName(matchId));
        const st = await stub.fetch(new Request(new URL("/state", url.origin)));
        const room = await st.json().catch(() => ({}));
        const orgId = room.meta && room.meta.orgId;
        if (!orgId || !env.SAAS) {
          return json({ ok: true, matchId, payments: { activeProvider: "none" }, message: "Sin org o pagos configurados" });
        }
        const reg = env.SAAS.get(env.SAAS.idFromName("global"));
        const pr = await reg.fetch(new Request("https://saas/pay/" + orgId));
        const data = await pr.json();
        return json({ ...data, matchId, title: room.meta && room.meta.title });
      }

      // —— Room helpers ——
      const roomState = url.pathname.match(/^\/api\/room\/([^/]+)\/state$/);
      if (roomState && request.method === "GET") {
        const matchId = sanitizeId(roomState[1]);
        const stub = env.ROOM.get(env.ROOM.idFromName(matchId));
        return withCors(await stub.fetch(new Request(new URL("/state", url.origin), request)));
      }

      const roomGenes = url.pathname.match(/^\/api\/room\/([^/]+)\/genes$/);
      if (roomGenes && request.method === "GET") {
        const matchId = sanitizeId(roomGenes[1]);
        const stub = env.ROOM.get(env.ROOM.idFromName(matchId));
        return withCors(await stub.fetch(new Request(new URL("/genes", url.origin), request)));
      }

      const roomBoot = url.pathname.match(/^\/api\/room\/([^/]+)\/bootstrap$/);
      if (roomBoot && request.method === "POST") {
        const matchId = sanitizeId(roomBoot[1]);
        const body = await request.json().catch(() => ({}));
        // Optional: bind org from API key
        let orgId = body.orgId || null;
        let plan = body.plan || "free";
        const apiKey = request.headers.get("X-API-Key");
        if (apiKey && env.SAAS) {
          const reg = env.SAAS.get(env.SAAS.idFromName("global"));
          const me = await reg.fetch(
            new Request("https://saas/me", { headers: { "X-API-Key": apiKey } })
          );
          const data = await me.json().catch(() => ({}));
          if (data.ok && data.org) {
            orgId = data.org.id;
            plan = data.org.plan || plan;
          }
        }
        const stub = env.ROOM.get(env.ROOM.idFromName(matchId));
        const bootRes = await stub.fetch(
          new Request(new URL("/bootstrap", url.origin), {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ ...body, matchId, orgId, plan }),
          })
        );
        // Registro de uso SaaS (best-effort; no bloquea el stream si falla)
        if (bootRes.ok && orgId && env.SAAS) {
          try {
            const reg = env.SAAS.get(env.SAAS.idFromName("global"));
            await reg.fetch(
              new Request("https://saas/event-start", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ orgId, matchId, plan }),
              })
            );
          } catch (_) {}
        }
        return withCors(bootRes);
      }

      const roomEnd = url.pathname.match(/^\/api\/room\/([^/]+)\/end$/);
      if (roomEnd && request.method === "POST") {
        const matchId = sanitizeId(roomEnd[1]);
        const stub = env.ROOM.get(env.ROOM.idFromName(matchId));
        const endRes = await stub.fetch(new Request(new URL("/end", url.origin), { method: "POST" }));
        if (endRes.ok && env.SAAS) {
          try {
            const reg = env.SAAS.get(env.SAAS.idFromName("global"));
            await reg.fetch(
              new Request("https://saas/event-end", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ matchId }),
              })
            );
          } catch (_) {}
        }
        return withCors(endRes);
      }

      // Tickets por sala (proxy al DO — no rompe admin/ticket)
      const roomTicket = url.pathname.match(/^\/api\/room\/([^/]+)\/ticket$/);
      if (roomTicket && request.method === "POST") {
        const matchId = sanitizeId(roomTicket[1]);
        const stub = env.ROOM.get(env.ROOM.idFromName(matchId));
        return withCors(
          await stub.fetch(
            new Request(new URL("/ticket", url.origin), {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: await request.text(),
            })
          )
        );
      }
      const roomTicketCheck = url.pathname.match(/^\/api\/room\/([^/]+)\/ticket\/check$/);
      if (roomTicketCheck && request.method === "POST") {
        const matchId = sanitizeId(roomTicketCheck[1]);
        const stub = env.ROOM.get(env.ROOM.idFromName(matchId));
        return withCors(
          await stub.fetch(
            new Request(new URL("/ticket/check", url.origin), {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: await request.text(),
            })
          )
        );
      }

      const wsMatch = url.pathname.match(/^\/ws\/([^/]+)$/);
      if (wsMatch) {
        const matchId = sanitizeId(wsMatch[1]);
        const stub = env.ROOM.get(env.ROOM.idFromName(matchId));
        return stub.fetch(request);
      }

      if (url.pathname === "/api/admin/ticket" && request.method === "POST") {
        const admin = env.STREAM_ADMIN_KEY;
        const apiKey = request.headers.get("X-API-Key");
        if (admin && request.headers.get("X-Admin-Key") !== admin && !apiKey) {
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

      if (env.ASSETS) {
        let assetReq = request;
        // Landing vendible: / → index.html (html_handling=none no reescribe solo)
        if (url.pathname === "/" || url.pathname === "") {
          assetReq = new Request(new URL("/index.html", url.origin), request);
        }
        const res = await env.ASSETS.fetch(assetReq);
        const headers = new Headers(res.headers);
        headers.set("Access-Control-Allow-Origin", "*");
        if (url.pathname.endsWith(".html") || url.pathname === "/" || url.pathname === "") {
          headers.set("Cache-Control", "no-store");
        }
        return new Response(res.body, { status: res.status, headers });
      }

      return json({ ok: true, service: "alset-streaming-hub", v: "1.0.0-saas" });
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
    "Access-Control-Allow-Methods": "GET,POST,PUT,DELETE,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type,X-Admin-Key,X-API-Key",
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
