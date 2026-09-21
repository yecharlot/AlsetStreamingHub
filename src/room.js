/**
 * MatchRoom — Durable Object = gen coordinador del enjambre de stream.
 * - Genes publisher/viewer/director nacen al conectar y se destruyen al salir o al end()
 * - SFU (Cloudflare Calls) cuando el plan y el env lo permiten
 * - Tickets + límites SaaS
 */

import { GENE_KIND, spawnGene, destroyGene, genePublic, planOf } from "./gene.js";

export class MatchRoom {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.sessions = new Map();
  }

  async ensureMeta() {
    let meta = await this.state.storage.get("meta");
    if (!meta) {
      meta = {
        id: "default",
        title: "Evento en vivo",
        createdAt: Date.now(),
        status: "open", // open | live | ended
        orgId: null,
        plan: "free",
        roomGeneId: null,
      };
      await this.state.storage.put("meta", meta);
    }
    return meta;
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

  async getGenes() {
    return (await this.state.storage.get("genes")) || {};
  }

  async putGenes(g) {
    await this.state.storage.put("genes", g);
  }

  limits() {
    return planOf(this._plan || "free");
  }

  broadcast(obj, except = null) {
    const raw = JSON.stringify(obj);
    for (const [ws] of this.sessions) {
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
    this._plan = meta.plan || "free";
    const stored = await this.getProducers();
    const genes = await this.getGenes();
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
        geneId: prev.geneId || s.geneId || null,
      };
    });
    const programId = (await this.state.storage.get("program")) || null;
    const out = (await this.state.storage.get("youtube")) || null;
    const liveGenes = Object.values(genes).filter((g) => g.status === "live").map(genePublic);
    const lim = planOf(meta.plan || "free");
    const viewers = [...this.sessions.values()].filter((s) => s.role === "viewer" || s.role === "director").length;
    return {
      type: "room_state",
      meta,
      producers: list,
      programId,
      youtube: out
        ? { rtmpUrl: out.rtmpUrl, hasKey: !!out.streamKey, note: out.note || "" }
        : null,
      viewers,
      publishers: livePubs.length,
      genes: liveGenes,
      geneCount: liveGenes.length,
      limits: lim,
      sfuRequired: lim.sfu,
      matchHint: "Usa el mismo nombre de evento en Transmitir y en Ver",
      alset: {
        model: "edge-gene-swarm",
        roomGene: meta.roomGeneId,
        note: "Los genes nacen al conectar y se destruyen al cerrar el evento o al salir el peer",
      },
    };
  }

  async notifyRegistry(live) {
    try {
      if (!this.env.SAAS) return;
      const meta = await this.ensureMeta();
      const id = this.env.SAAS.idFromName("global");
      const stub = this.env.SAAS.get(id);
      const genes = await this.getGenes();
      const geneCount = Object.values(genes).filter((g) => g.status === "live").length;
      if (live) {
        const snapViewers = [...this.sessions.values()].filter((s) => s.role === "viewer" || s.role === "director").length;
        const snapPubs = [...this.sessions.values()].filter((s) => s.role === "publisher").length;
        await stub.fetch(
          new Request("https://saas/internal/live", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              matchId: meta.id,
              orgId: meta.orgId,
              title: meta.title,
              geneCount,
              status: meta.status,
              peakViewers: snapViewers,
              peakPublishers: snapPubs,
            }),
          })
        );
      } else {
        await stub.fetch(
          new Request("https://saas/internal/live?" + new URLSearchParams({ matchId: meta.id }), {
            method: "DELETE",
          })
        );
      }
    } catch (_) {}
  }

  async endEvent() {
    const meta = await this.ensureMeta();
    meta.status = "ended";
    meta.endedAt = Date.now();
    await this.state.storage.put("meta", meta);

    let genes = await this.getGenes();
    for (const id of Object.keys(genes)) {
      if (genes[id].status === "live") genes[id] = destroyGene(genes[id]);
    }
    await this.putGenes(genes);

    // Desconectar a todos
    for (const [ws] of this.sessions) {
      try {
        ws.send(JSON.stringify({ type: "event_ended", meta, genes: Object.values(genes).map(genePublic) }));
        ws.close(1000, "event_ended");
      } catch (_) {}
    }
    this.sessions.clear();
    await this.putProducers({});
    await this.notifyRegistry(false);
    return { ok: true, meta, destroyedGenes: Object.keys(genes).length };
  }

  async fetch(request) {
    const url = new URL(request.url);

    if (request.headers.get("Upgrade") !== "websocket") {
      if (url.pathname.endsWith("/state") && request.method === "GET") {
        return Response.json(await this.snapshot());
      }

      if (url.pathname.endsWith("/bootstrap") && request.method === "POST") {
        const body = await request.json().catch(() => ({}));
        const meta = await this.ensureMeta();
        if (body.title) meta.title = String(body.title).slice(0, 120);
        if (body.matchId) meta.id = String(body.matchId).slice(0, 64);
        if (body.orgId) meta.orgId = String(body.orgId).slice(0, 64);
        if (body.plan) meta.plan = String(body.plan).slice(0, 16);
        this._plan = meta.plan;
        if (!meta.roomGeneId) {
          const g = spawnGene({
            kind: GENE_KIND.ROOM,
            matchId: meta.id,
            orgId: meta.orgId,
            label: meta.title,
          });
          meta.roomGeneId = g.id;
          const genes = await this.getGenes();
          genes[g.id] = g;
          await this.putGenes(genes);
          meta._usageBootstrapped = true;
        }
        if (body.status) meta.status = body.status;
        if (meta.status === "open" || meta.status === "live") {
          /* keep */
        }
        await this.state.storage.put("meta", meta);
        if (meta._usageBootstrapped && meta.orgId && this.env.SAAS) {
          try {
            const id = this.env.SAAS.idFromName("global");
            const stub = this.env.SAAS.get(id);
            await stub.fetch(
              new Request("https://saas/internal/usage", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ orgId: meta.orgId, eventsCreated: 1, geneSpawns: 1 }),
              })
            );
          } catch (_) {}
          delete meta._usageBootstrapped;
          await this.state.storage.put("meta", meta);
        }
        await this.notifyRegistry(meta.status !== "ended");
        return Response.json({ ok: true, meta, snapshot: await this.snapshot() });
      }

      if (url.pathname.endsWith("/end") && request.method === "POST") {
        return Response.json(await this.endEvent());
      }

      if (url.pathname.endsWith("/genes") && request.method === "GET") {
        const genes = await this.getGenes();
        const live = Object.values(genes).filter((g) => g.status === "live").map(genePublic);
        const dead = Object.values(genes)
          .filter((g) => g.status === "destroyed")
          .slice(-20)
          .map(genePublic);
        return Response.json({ ok: true, live, recentDestroyed: dead });
      }

      if (url.pathname.endsWith("/meta") && request.method === "POST") {
        const body = await request.json().catch(() => ({}));
        const meta = await this.ensureMeta();
        if (body.title) meta.title = String(body.title).slice(0, 120);
        if (body.status) meta.status = body.status;
        await this.state.storage.put("meta", meta);
        this.broadcast({ type: "meta", meta });
        return Response.json(meta);
      }

      if (url.pathname.endsWith("/youtube") && request.method === "POST") {
        const body = await request.json().catch(() => ({}));
        const yt = {
          rtmpUrl: String(body.rtmpUrl || "rtmps://a.rtmp.youtube.com/live2").slice(0, 200),
          streamKey: body.streamKey ? String(body.streamKey).slice(0, 200) : "",
          note: String(body.note || "").slice(0, 200),
          updatedAt: Date.now(),
        };
        await this.state.storage.put("youtube", yt);
        this.broadcast({
          type: "youtube",
          youtube: { rtmpUrl: yt.rtmpUrl, hasKey: !!yt.streamKey, note: yt.note },
        });
        return Response.json({
          ok: true,
          youtube: { rtmpUrl: yt.rtmpUrl, hasKey: !!yt.streamKey },
          obs: {
            programUrl: "Usa /program.html?match=ESTE_EVENTO como Browser Source",
            youtubeServer: yt.rtmpUrl,
            hint: "OBS: Browser Source = programa Alset; Transmisión = YouTube RTMP + clave",
          },
        });
      }

      if (url.pathname.endsWith("/youtube") && request.method === "GET") {
        const yt = (await this.state.storage.get("youtube")) || {};
        return Response.json({
          rtmpUrl: yt.rtmpUrl || "rtmps://a.rtmp.youtube.com/live2",
          hasKey: !!yt.streamKey,
          note: yt.note || "",
        });
      }

      if (url.pathname.endsWith("/ticket") && request.method === "POST") {
        const body = await request.json().catch(() => ({}));
        const meta = await this.ensureMeta();
        const lim = planOf(meta.plan || "free");
        const tickets = await this.getTickets();
        if (Object.keys(tickets).length >= lim.maxTicketsPerEvent) {
          return Response.json(
            { error: "ticket_limit", limit: lim.maxTicketsPerEvent, plan: lim.id },
            { status: 403 }
          );
        }
        const code = (body.code || this.randomCode()).toUpperCase();
        tickets[code] = {
          code,
          createdAt: Date.now(),
          uses: 0,
          maxUses: body.maxUses || 50,
          label: body.label || "entrada",
        };
        await this.putTickets(tickets);
        if (meta.orgId && this.env.SAAS) {
          try {
            const id = this.env.SAAS.idFromName("global");
            const stub = this.env.SAAS.get(id);
            await stub.fetch(
              new Request("https://saas/internal/usage", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ orgId: meta.orgId, ticketsIssued: 1 }),
              })
            );
          } catch (_) {}
        }
        return Response.json({ ok: true, ticket: tickets[code], plan: lim.id });
      }

      if (url.pathname.endsWith("/tickets") && request.method === "GET") {
        const tickets = await this.getTickets();
        return Response.json({
          ok: true,
          tickets: Object.values(tickets).map((t) => ({
            code: t.code,
            uses: t.uses,
            maxUses: t.maxUses,
            label: t.label,
          })),
        });
      }

      return Response.json({ error: "not_found" }, { status: 404 });
    }

    // —— WebSocket ——
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    server.accept();

    const role = (url.searchParams.get("role") || "viewer").toLowerCase();
    const ticket = (url.searchParams.get("ticket") || "").toUpperCase();
    const label = url.searchParams.get("label") || "";
    const peerId =
      url.searchParams.get("id") ||
      `${role}-${Math.random().toString(36).slice(2, 9)}`;

    const meta = await this.ensureMeta();
    this._plan = meta.plan || "free";
    const lim = planOf(this._plan);

    if (meta.status === "ended") {
      server.close(1008, "event_ended");
      return new Response(null, { status: 101, webSocket: client });
    }

    // Tickets: si hay alguno, viewer/director deben presentar uno válido
    const tickets = await this.getTickets();
    const needTicket = Object.keys(tickets).length > 0;
    if (needTicket && (role === "viewer" || role === "director")) {
      const t = tickets[ticket];
      if (!t || t.uses >= t.maxUses) {
        server.send(JSON.stringify({ type: "error", error: "invalid_ticket" }));
        server.close(1008, "invalid_ticket");
        return new Response(null, { status: 101, webSocket: client });
      }
      t.uses += 1;
      tickets[ticket] = t;
      await this.putTickets(tickets);
    }

    // Límites de plan
    const pubs = [...this.sessions.values()].filter((s) => s.role === "publisher").length;
    const views = [...this.sessions.values()].filter((s) => s.role === "viewer" || s.role === "director").length;
    if (role === "publisher" && pubs >= lim.maxPublishers) {
      server.send(
        JSON.stringify({
          type: "error",
          error: "publisher_limit",
          limit: lim.maxPublishers,
          plan: lim.id,
          message: "Plan agotado de cámaras. Mejora el plan SaaS.",
        })
      );
      server.close(1008, "publisher_limit");
      return new Response(null, { status: 101, webSocket: client });
    }
    if ((role === "viewer" || role === "director") && views >= lim.maxViewers) {
      server.send(
        JSON.stringify({
          type: "error",
          error: "viewer_limit",
          limit: lim.maxViewers,
          plan: lim.id,
        })
      );
      server.close(1008, "viewer_limit");
      return new Response(null, { status: 101, webSocket: client });
    }

    // Spawn gene
    const kind =
      role === "publisher"
        ? GENE_KIND.PUBLISHER
        : role === "director"
          ? GENE_KIND.DIRECTOR
          : GENE_KIND.VIEWER;
    const gene = spawnGene({
      kind,
      matchId: meta.id,
      orgId: meta.orgId,
      label: label || role,
      peerId,
    });
    const genes = await this.getGenes();
    genes[gene.id] = gene;
    await this.putGenes(genes);

    if (meta.status === "open") {
      meta.status = "live";
      await this.state.storage.put("meta", meta);
    }

    const info = { role, id: peerId, label, geneId: gene.id };
    this.sessions.set(server, info);

    if (role === "publisher") {
      const producers = await this.getProducers();
      producers[peerId] = {
        id: peerId,
        label: label || peerId,
        online: true,
        quality: 0.7,
        bitrate: 0,
        fps: 0,
        updatedAt: Date.now(),
        geneId: gene.id,
        sfuSessionId: null,
        tracks: [],
      };
      await this.putProducers(producers);
      this.broadcast({ type: "producer_join", producer: producers[peerId], gene: genePublic(gene) });
    }

    server.send(
      JSON.stringify({
        type: "welcome",
        peerId,
        role,
        gene: genePublic(gene),
        room: await this.snapshot(),
      })
    );
    this.broadcast({ type: "presence", ...(await this.snapshot()) }, server);
    await this.notifyRegistry(true);

    server.addEventListener("message", async (ev) => {
      let msg;
      try {
        msg = JSON.parse(ev.data);
      } catch {
        return;
      }
      const info = this.sessions.get(server);
      if (!info) return;

      if (msg.type === "sfu_bind" && info.role === "publisher") {
        const producers = await this.getProducers();
        if (producers[info.id]) {
          producers[info.id].sfuSessionId = msg.sessionId || null;
          producers[info.id].tracks = msg.tracks || [];
          producers[info.id].updatedAt = Date.now();
          await this.putProducers(producers);
        }
        const genes = await this.getGenes();
        if (info.geneId && genes[info.geneId]) {
          genes[info.geneId].sfuSessionId = msg.sessionId || null;
          genes[info.geneId].edge = msg.sessionId ? "sfu+do" : "durable-object";
          genes[info.geneId].updatedAt = Date.now();
          await this.putGenes(genes);
        }
        this.broadcast({ type: "producer_sfu", id: info.id, sessionId: msg.sessionId });
        return;
      }

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
      if (!info) return;

      // Destroy peer gene
      const genes = await this.getGenes();
      if (info.geneId && genes[info.geneId]) {
        genes[info.geneId] = destroyGene(genes[info.geneId]);
        await this.putGenes(genes);
        this.broadcast({ type: "gene_destroyed", gene: genePublic(genes[info.geneId]) });
      }

      if (info.role === "publisher") {
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
