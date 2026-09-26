import { GENE_KIND, spawnGene, destroyGene, genePublic, planOf } from "./gene.js";

/**
 * MatchRoom — Durable Object
 * - Registry of live producers (mobile cameras)
 * - WebSocket signaling for WebRTC
 * - Viewer tickets / access for paid watch
 * - Quality hints so the director can pick the best feed
 */

export class MatchRoom {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.sessions = new Map(); // ws -> { role, id, label }
  }

  async ensureMeta(matchId) {
    let meta = await this.state.storage.get("meta");
    if (!meta) {
      meta = {
        id: matchId || "default",
        title: "Evento en vivo",
        createdAt: Date.now(),
        status: "open", // open | live | ended
        orgId: null,
        plan: "free",
        requireTicket: false,
      };
      await this.state.storage.put("meta", meta);
    } else if (matchId && meta.id === "default") {
      meta.id = matchId;
      await this.state.storage.put("meta", meta);
    }
    return meta;
  }

  async getGenes() {
    return (await this.state.storage.get("genes")) || {};
  }

  async putGenes(g) {
    await this.state.storage.put("genes", g);
  }

  async listLiveGenes() {
    const genes = await this.getGenes();
    return Object.values(genes)
      .filter((g) => g && g.status === "live")
      .map(genePublic);
  }

  async getProducers() {
    return (await this.state.storage.get("producers")) || {};
  }

  async putProducers(p) {
    await this.state.storage.put("producers", p);
  }

  async getTickets() {
    return (await this.state.storage.get("tickets")) || {};
  }

  async putTickets(t) {
    await this.state.storage.put("tickets", t);
  }

  broadcast(obj, except = null) {
    const raw = JSON.stringify(obj);
    for (const [ws, info] of this.sessions) {
      if (ws === except) continue;
      try {
        ws.send(raw);
      } catch (_) {}
    }
  }

  broadcastToViewers(obj) {
    const raw = JSON.stringify(obj);
    for (const [ws, info] of this.sessions) {
      if (info.role !== "viewer" && info.role !== "director") continue;
      try {
        ws.send(raw);
      } catch (_) {}
    }
  }

  async snapshot() {
    const meta = await this.ensureMeta();
    const stored = await this.getProducers();
    // Solo cámaras con WebSocket de publisher ACTIVO (evita fantasmas en storage)
    const livePubs = [...this.sessions.values()].filter((s) => s.role === "publisher");
    const list = livePubs.map((s) => {
      const prev = stored[s.id] || {};
      return {
        id: s.id,
        label: s.label || prev.label || s.id,
        online: true,
        quality: prev.quality != null ? prev.quality : 0.7,
        bitrate: prev.bitrate || 0,
        fps: prev.fps || 0,
        updatedAt: prev.updatedAt || Date.now(),
        sfuSessionId: prev.sfuSessionId || null,
        tracks: prev.tracks || [],
      };
    });
    return {
      type: "room_state",
      meta,
      producers: list,
      viewers: [...this.sessions.values()].filter((s) => s.role === "viewer" || s.role === "director").length,
      publishers: livePubs.length,
      matchHint: "Usa el mismo nombre de evento en Transmitir y en Ver",
    };
  }

  async fetch(request) {
    const url = new URL(request.url);

    // HTTP API (no rompe WS: solo si no es upgrade)
    if (request.headers.get("Upgrade") !== "websocket") {
      const bodyIn = request.method !== "GET" && request.method !== "HEAD"
        ? await request.json().catch(() => ({}))
        : {};
      const matchHint = bodyIn.matchId || url.searchParams.get("matchId") || null;

      if (url.pathname.endsWith("/state") && request.method === "GET") {
        return Response.json(await this.snapshot());
      }

      // Bootstrap: activa sala + gen stream.room (idempotente)
      if (url.pathname.endsWith("/bootstrap") && request.method === "POST") {
        const matchId = String(bodyIn.matchId || matchHint || "default").slice(0, 64);
        const meta = await this.ensureMeta(matchId);
        if (meta.status === "ended") {
          meta.status = "open";
          meta.endedAt = null;
        }
        if (bodyIn.title) meta.title = String(bodyIn.title).slice(0, 120);
        meta.id = matchId;
        meta.orgId = bodyIn.orgId || meta.orgId || null;
        meta.plan = bodyIn.plan || meta.plan || "free";
        if (typeof bodyIn.requireTicket === "boolean") meta.requireTicket = bodyIn.requireTicket;
        meta.updatedAt = Date.now();
        await this.state.storage.put("meta", meta);

        const genes = await this.getGenes();
        let roomGene = Object.values(genes).find(
          (g) => g && g.kind === GENE_KIND.ROOM && g.status === "live"
        );
        if (!roomGene) {
          roomGene = spawnGene({
            kind: GENE_KIND.ROOM,
            matchId,
            orgId: meta.orgId,
            label: meta.title || matchId,
          });
          genes[roomGene.id] = roomGene;
          await this.putGenes(genes);
        }
        this.broadcast({ type: "meta", meta });
        return Response.json({
          ok: true,
          meta,
          gene: genePublic(roomGene),
          limits: planOf(meta.plan),
        });
      }

      if (url.pathname.endsWith("/genes") && request.method === "GET") {
        const meta = await this.ensureMeta();
        const live = await this.listLiveGenes();
        return Response.json({
          ok: true,
          matchId: meta.id,
          status: meta.status,
          genes: live,
          count: live.length,
        });
      }

      if (url.pathname.endsWith("/end") && request.method === "POST") {
        const meta = await this.ensureMeta();
        meta.status = "ended";
        meta.endedAt = Date.now();
        await this.state.storage.put("meta", meta);
        const genes = await this.getGenes();
        for (const id of Object.keys(genes)) {
          if (genes[id] && genes[id].status === "live") {
            genes[id] = destroyGene(genes[id]);
          }
        }
        await this.putGenes(genes);
        // Aviso a peers; no cortamos sockets a la fuerza (evita romper streams a mitad)
        this.broadcast({ type: "event_end", meta, genes: Object.values(genes).map(genePublic) });
        return Response.json({
          ok: true,
          meta,
          genesDestroyed: Object.values(genes).filter((g) => g.status === "destroyed").length,
        });
      }

      if (url.pathname.endsWith("/meta") && request.method === "POST") {
        const meta = await this.ensureMeta(bodyIn.matchId);
        if (bodyIn.title) meta.title = String(bodyIn.title).slice(0, 120);
        if (bodyIn.status) meta.status = bodyIn.status;
        if (typeof bodyIn.requireTicket === "boolean") meta.requireTicket = bodyIn.requireTicket;
        await this.state.storage.put("meta", meta);
        this.broadcast({ type: "meta", meta });
        return Response.json(meta);
      }
      if (url.pathname.endsWith("/ticket") && request.method === "POST") {
        const meta = await this.ensureMeta();
        if (meta.status === "ended") {
          return Response.json({ error: "event_ended" }, { status: 409 });
        }
        const limits = planOf(meta.plan || "free");
        const tickets = await this.getTickets();
        const issued = Object.keys(tickets).length;
        if (issued >= (limits.maxTicketsPerEvent || 50)) {
          return Response.json(
            { error: "ticket_limit", max: limits.maxTicketsPerEvent, plan: limits.id },
            { status: 403 }
          );
        }
        const code = (bodyIn.code || this.randomCode()).toUpperCase();
        tickets[code] = {
          code,
          createdAt: Date.now(),
          uses: 0,
          maxUses: bodyIn.maxUses || 50,
          label: bodyIn.label || "entrada",
        };
        await this.putTickets(tickets);
        return Response.json({ ok: true, ticket: tickets[code] });
      }
      if (url.pathname.endsWith("/ticket/check") && request.method === "POST") {
        const code = String(bodyIn.code || "").toUpperCase().trim();
        const tickets = await this.getTickets();
        const tk = tickets[code];
        if (!tk) return Response.json({ ok: false, error: "ticket_invalid" }, { status: 403 });
        if (tk.uses >= tk.maxUses) return Response.json({ ok: false, error: "ticket_exhausted" }, { status: 403 });
        return Response.json({ ok: true, ticket: { code: tk.code, label: tk.label } });
      }
      return Response.json({ error: "not_found" }, { status: 404 });
    }

    // WebSocket
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    server.accept();

    const role = url.searchParams.get("role") || "viewer";
    const id = url.searchParams.get("id") || crypto.randomUUID().slice(0, 8);
    const label = url.searchParams.get("label") || (role === "publisher" ? `Cámara ${id}` : id);
    const ticket = (url.searchParams.get("ticket") || "").toUpperCase();

    // Paid gate for viewers/director (publishers can use admin key or open publish)
    // Ticket solo si el viewer envía código (no bloquea acceso libre)
    if ((role === "viewer" || role === "director") && ticket) {
      const tickets = await this.getTickets();
      const t = tickets[ticket];
      if (t) {
        if (t.uses >= t.maxUses) {
          server.close(4003, "ticket_exhausted");
          return new Response(null, { status: 101, webSocket: client });
        }
        t.uses += 1;
        tickets[ticket] = t;
        await this.putTickets(tickets);
      }
    }

    this.sessions.set(server, { role, id, label });

    if (role === "publisher") {
      const producers = await this.getProducers();
      producers[id] = {
        id,
        label,
        online: true,
        quality: 0.7,
        bitrate: 0,
        fps: 0,
        updatedAt: Date.now(),
      };
      await this.putProducers(producers);
      this.broadcast({ type: "producer_join", producer: producers[id] });
    }

    server.send(JSON.stringify(await this.snapshot()));

    server.addEventListener("message", async (ev) => {
      let msg;
      try {
        msg = JSON.parse(ev.data);
      } catch {
        return;
      }
      const info = this.sessions.get(server);
      if (!info) return;

      // SFU publish announcement (session + track names)
      if (msg.type === "sfu_publish" && info.role === "publisher") {
        const producers = await this.getProducers();
        if (!producers[info.id]) {
          producers[info.id] = { id: info.id, label: info.label, online: true, quality: 0.7 };
        }
        producers[info.id].sfuSessionId = msg.sessionId || null;
        producers[info.id].tracks = msg.tracks || [];
        producers[info.id].online = true;
        producers[info.id].updatedAt = Date.now();
        await this.putProducers(producers);
        this.broadcast({ type: "producer_join", producer: producers[info.id] });
        return;
      }

      // Quality telemetry from publisher
      if (msg.type === "quality" && info.role === "publisher") {
        const producers = await this.getProducers();
        if (producers[info.id]) {
          producers[info.id].quality = clamp01(msg.quality);
          producers[info.id].bitrate = msg.bitrate || 0;
          producers[info.id].fps = msg.fps || 0;
          producers[info.id].updatedAt = Date.now();
          await this.putProducers(producers);
          this.broadcastToViewers({ type: "quality", id: info.id, producer: producers[info.id] });
        }
        return;
      }

      // WebRTC signaling relay
      if (msg.type === "signal") {
        const targetId = msg.to;
        const payload = {
          type: "signal",
          from: info.id,
          fromRole: info.role,
          to: targetId,
          data: msg.data,
        };
        for (const [ws, peer] of this.sessions) {
          if (peer.id === targetId) {
            try {
              ws.send(JSON.stringify(payload));
            } catch (_) {}
          }
        }
        return;
      }

      // Director selects active camera for all viewers (optional program feed)
      if (msg.type === "program" && (info.role === "director" || info.role === "publisher")) {
        this.broadcast({ type: "program", producerId: msg.producerId, by: info.id });
        await this.state.storage.put("program", msg.producerId);
        return;
      }

      if (msg.type === "ping") {
        server.send(JSON.stringify({ type: "pong", t: Date.now() }));
      }
    });

    server.addEventListener("close", async () => {
      const info = this.sessions.get(server);
      this.sessions.delete(server);
      if (info && info.role === "publisher") {
        const producers = await this.getProducers();
        if (producers[info.id]) {
          producers[info.id].online = false;
          producers[info.id].updatedAt = Date.now();
          await this.putProducers(producers);
          this.broadcast({ type: "producer_leave", id: info.id });
        }
      }
      this.broadcast({ type: "presence", ...(await this.snapshot()) });
    });

    return new Response(null, { status: 101, webSocket: client });
  }

  randomCode() {
    const a = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    let s = "";
    for (let i = 0; i < 6; i++) s += a[Math.floor(Math.random() * a.length)];
    return s;
  }
}

function clamp01(x) {
  const n = Number(x);
  if (Number.isNaN(n)) return 0.5;
  return Math.max(0, Math.min(1, n));
}
