/**
 * SaaS registry — orgs, planes, pagos (Transfermóvil ahora; Stripe/PayPal/Payoneer después),
 * uso y genes vivos.
 */

import { PLANS, planOf } from "./gene.js";

const DEFAULT_PAYMENTS = () => ({
  activeProvider: "transfermovil", // transfermovil | stripe | paypal | payoneer | none
  transfermovil: {
    enabled: true,
    holderName: "",
    phone: "", // número Transfermóvil
    cardLast4: "",
    cardBank: "", // BANDEC, BPA, BANMET, etc.
    accountHint: "", // opcional: últimos dígitos o alias
    currency: "CUP",
    amountHint: "",
    instructions:
      "Realiza el pago por Transfermóvil a los datos indicados. En el concepto escribe el nombre del evento y tu nombre. Cuando confirmemos el pago, te enviaremos el ticket de acceso.",
  },
  stripe: {
    enabled: false,
    publishableKey: "",
    priceId: "",
    note: "Reservado para integración futura",
  },
  paypal: {
    enabled: false,
    clientId: "",
    meLink: "",
    note: "Reservado para integración futura",
  },
  payoneer: {
    enabled: false,
    email: "",
    note: "Reservado para integración futura",
  },
});

const DEFAULT_USAGE = () => ({
  eventsCreated: 0,
  eventsEnded: 0,
  ticketsIssued: 0,
  peakViewers: 0,
  peakPublishers: 0,
  geneSpawns: 0,
  geneDestroys: 0,
  lastEventAt: null,
  history: [], // last N events { matchId, title, peakViewers, endedAt }
});

export class SaaSRegistry {
  constructor(state, env) {
    this.state = state;
    this.env = env;
  }

  async getOrgs() {
    return (await this.state.storage.get("orgs")) || {};
  }

  async putOrgs(o) {
    await this.state.storage.put("orgs", o);
  }

  async getKeys() {
    return (await this.state.storage.get("apiKeys")) || {};
  }

  async putKeys(k) {
    await this.state.storage.put("apiKeys", k);
  }

  async getLiveIndex() {
    return (await this.state.storage.get("liveIndex")) || {};
  }

  async putLiveIndex(idx) {
    await this.state.storage.put("liveIndex", idx);
  }

  randomKey() {
    const a = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    let s = "ash_";
    for (let i = 0; i < 24; i++) s += a[Math.floor(Math.random() * a.length)];
    return s;
  }

  async createOrg(body) {
    const orgs = await this.getOrgs();
    const id =
      String(body.slug || body.name || "org")
        .toLowerCase()
        .replace(/[^a-z0-9-]/g, "")
        .slice(0, 32) || `org${Date.now().toString(36)}`;
    if (orgs[id]) return { error: "org_exists", id };

    const plan = planOf(body.plan || "free");
    const apiKey = this.randomKey();
    const store = {
      id,
      name: String(body.name || id).slice(0, 80),
      plan: plan.id,
      apiKeyHash: simpleHash(apiKey),
      apiKeyMask: apiKey.slice(0, 8) + "…",
      createdAt: Date.now(),
      eventsCreated: 0,
      payments: DEFAULT_PAYMENTS(),
      usage: DEFAULT_USAGE(),
    };
    orgs[id] = store;
    const keys = await this.getKeys();
    keys[simpleHash(apiKey)] = id;
    await this.putOrgs(orgs);
    await this.putKeys(keys);
    return {
      ok: true,
      org: { id: store.id, name: store.name, plan: store.plan, apiKey, limits: plan },
    };
  }

  async resolveApiKey(key) {
    if (!key) return null;
    const keys = await this.getKeys();
    const orgId = keys[simpleHash(key)];
    if (!orgId) return null;
    const orgs = await this.getOrgs();
    const org = orgs[orgId];
    if (!org) return null;
    // migrate older orgs
    if (!org.payments) org.payments = DEFAULT_PAYMENTS();
    if (!org.usage) org.usage = DEFAULT_USAGE();
    return org;
  }

  async saveOrg(org) {
    const orgs = await this.getOrgs();
    orgs[org.id] = org;
    await this.putOrgs(orgs);
  }

  publicPayments(p) {
    if (!p) p = DEFAULT_PAYMENTS();
    const provider = p.activeProvider || "transfermovil";
    const out = {
      activeProvider: provider,
      providersAvailable: ["transfermovil", "stripe", "paypal", "payoneer", "none"],
    };
    if (provider === "transfermovil" && p.transfermovil) {
      out.transfermovil = {
        enabled: !!p.transfermovil.enabled,
        holderName: p.transfermovil.holderName || "",
        phone: p.transfermovil.phone || "",
        cardLast4: p.transfermovil.cardLast4 || "",
        cardBank: p.transfermovil.cardBank || "",
        accountHint: p.transfermovil.accountHint || "",
        currency: p.transfermovil.currency || "CUP",
        amountHint: p.transfermovil.amountHint || "",
        instructions: p.transfermovil.instructions || "",
      };
    }
    if (provider === "stripe") {
      out.stripe = {
        enabled: !!p.stripe?.enabled,
        ready: false,
        note: p.stripe?.note || "Próximamente",
      };
    }
    if (provider === "paypal") {
      out.paypal = {
        enabled: !!p.paypal?.enabled,
        meLink: p.paypal?.meLink || "",
        ready: !!(p.paypal?.enabled && p.paypal?.meLink),
        note: p.paypal?.note || "Próximamente",
      };
    }
    if (provider === "payoneer") {
      out.payoneer = {
        enabled: !!p.payoneer?.enabled,
        email: p.payoneer?.email || "",
        ready: false,
        note: p.payoneer?.note || "Próximamente",
      };
    }
    return out;
  }

  async updatePayments(org, body) {
    const pay = org.payments || DEFAULT_PAYMENTS();
    if (body.activeProvider) {
      const ok = ["transfermovil", "stripe", "paypal", "payoneer", "none"].includes(body.activeProvider);
      if (ok) pay.activeProvider = body.activeProvider;
    }
    if (body.transfermovil && typeof body.transfermovil === "object") {
      pay.transfermovil = { ...pay.transfermovil, ...sanitizeTm(body.transfermovil) };
      pay.transfermovil.enabled = true;
    }
    if (body.stripe && typeof body.stripe === "object") {
      pay.stripe = {
        ...pay.stripe,
        enabled: !!body.stripe.enabled,
        publishableKey: String(body.stripe.publishableKey || pay.stripe.publishableKey || "").slice(0, 120),
        priceId: String(body.stripe.priceId || pay.stripe.priceId || "").slice(0, 80),
        note: String(body.stripe.note || pay.stripe.note || "").slice(0, 200),
      };
    }
    if (body.paypal && typeof body.paypal === "object") {
      pay.paypal = {
        ...pay.paypal,
        enabled: !!body.paypal.enabled,
        clientId: String(body.paypal.clientId || pay.paypal.clientId || "").slice(0, 120),
        meLink: String(body.paypal.meLink || pay.paypal.meLink || "").slice(0, 200),
        note: String(body.paypal.note || pay.paypal.note || "").slice(0, 200),
      };
    }
    if (body.payoneer && typeof body.payoneer === "object") {
      pay.payoneer = {
        ...pay.payoneer,
        enabled: !!body.payoneer.enabled,
        email: String(body.payoneer.email || pay.payoneer.email || "").slice(0, 120),
        note: String(body.payoneer.note || pay.payoneer.note || "").slice(0, 200),
      };
    }
    org.payments = pay;
    await this.saveOrg(org);
    return { ok: true, payments: this.publicPayments(pay) };
  }

  async bumpUsage(orgId, patch) {
    const orgs = await this.getOrgs();
    const org = orgs[orgId];
    if (!org) return;
    if (!org.usage) org.usage = DEFAULT_USAGE();
    const u = org.usage;
    if (patch.eventsCreated) u.eventsCreated += patch.eventsCreated;
    if (patch.eventsEnded) u.eventsEnded += patch.eventsEnded;
    if (patch.ticketsIssued) u.ticketsIssued += patch.ticketsIssued;
    if (patch.geneSpawns) u.geneSpawns += patch.geneSpawns;
    if (patch.geneDestroys) u.geneDestroys += patch.geneDestroys;
    if (patch.peakViewers != null) u.peakViewers = Math.max(u.peakViewers || 0, patch.peakViewers);
    if (patch.peakPublishers != null) u.peakPublishers = Math.max(u.peakPublishers || 0, patch.peakPublishers);
    if (patch.lastEventAt) u.lastEventAt = patch.lastEventAt;
    if (patch.historyEntry) {
      u.history = [patch.historyEntry, ...(u.history || [])].slice(0, 30);
    }
    org.usage = u;
    if (patch.eventsCreated) org.eventsCreated = (org.eventsCreated || 0) + patch.eventsCreated;
    orgs[orgId] = org;
    await this.putOrgs(orgs);
  }

  async listOrgs() {
    const orgs = await this.getOrgs();
    return Object.values(orgs).map((o) => ({
      id: o.id,
      name: o.name,
      plan: o.plan,
      apiKeyMask: o.apiKeyMask,
      eventsCreated: o.eventsCreated || 0,
      limits: planOf(o.plan),
      paymentProvider: o.payments?.activeProvider || "transfermovil",
    }));
  }

  async setPlan(orgId, planId) {
    const orgs = await this.getOrgs();
    if (!orgs[orgId]) return { error: "not_found" };
    if (!PLANS[planId]) return { error: "bad_plan" };
    orgs[orgId].plan = planId;
    await this.putOrgs(orgs);
    return { ok: true, org: { id: orgId, plan: planId }, limits: planOf(planId) };
  }

  async registerLive(matchId, info) {
    const idx = await this.getLiveIndex();
    idx[matchId] = { ...info, updatedAt: Date.now() };
    await this.putLiveIndex(idx);
    if (info.orgId && info.peakViewers != null) {
      await this.bumpUsage(info.orgId, {
        peakViewers: info.peakViewers,
        peakPublishers: info.peakPublishers,
      });
    }
  }

  async unregisterLive(matchId) {
    const idx = await this.getLiveIndex();
    const prev = idx[matchId];
    delete idx[matchId];
    await this.putLiveIndex(idx);
    if (prev && prev.orgId) {
      await this.bumpUsage(prev.orgId, {
        eventsEnded: 1,
        lastEventAt: Date.now(),
        historyEntry: {
          matchId,
          title: prev.title || matchId,
          geneCount: prev.geneCount || 0,
          endedAt: Date.now(),
        },
      });
    }
  }

  async fetch(request) {
    const url = new URL(request.url);
    const path = url.pathname.replace(/^\/saas/, "") || "/";

    if (path === "/health" || path === "/") {
      return Response.json({
        ok: true,
        service: "alset-streaming-saas",
        model: "genes-edge-swarm",
        payments: ["transfermovil", "stripe", "paypal", "payoneer"],
        plans: PLANS,
      });
    }

    if (path === "/plans" && request.method === "GET") {
      return Response.json({ ok: true, plans: PLANS });
    }

    if (path === "/orgs" && request.method === "POST") {
      const body = await request.json().catch(() => ({}));
      const out = await this.createOrg(body);
      return Response.json(out, { status: out.error ? 400 : 200 });
    }

    if (path === "/orgs" && request.method === "GET") {
      const admin = this.env.STREAM_ADMIN_KEY;
      if (admin && request.headers.get("X-Admin-Key") !== admin) {
        return Response.json({ error: "unauthorized" }, { status: 401 });
      }
      return Response.json({ ok: true, orgs: await this.listOrgs() });
    }

    if (path === "/me" && request.method === "GET") {
      const key = request.headers.get("X-API-Key") || url.searchParams.get("apiKey");
      const org = await this.resolveApiKey(key);
      if (!org) return Response.json({ error: "unauthorized" }, { status: 401 });
      return Response.json({
        ok: true,
        org: {
          id: org.id,
          name: org.name,
          plan: org.plan,
          eventsCreated: org.eventsCreated || 0,
          createdAt: org.createdAt,
        },
        limits: planOf(org.plan),
        payments: this.publicPayments(org.payments),
        usage: org.usage || DEFAULT_USAGE(),
      });
    }

    if (path === "/payments" && request.method === "GET") {
      const org = await this.resolveApiKey(request.headers.get("X-API-Key") || url.searchParams.get("apiKey"));
      if (!org) return Response.json({ error: "unauthorized" }, { status: 401 });
      return Response.json({ ok: true, payments: this.publicPayments(org.payments) });
    }

    if (path === "/payments" && request.method === "POST") {
      const org = await this.resolveApiKey(request.headers.get("X-API-Key"));
      if (!org) return Response.json({ error: "unauthorized" }, { status: 401 });
      const body = await request.json().catch(() => ({}));
      return Response.json(await this.updatePayments(org, body));
    }

    if (path === "/usage" && request.method === "GET") {
      const org = await this.resolveApiKey(request.headers.get("X-API-Key") || url.searchParams.get("apiKey"));
      if (!org) return Response.json({ error: "unauthorized" }, { status: 401 });
      return Response.json({
        ok: true,
        usage: org.usage || DEFAULT_USAGE(),
        plan: org.plan,
        limits: planOf(org.plan),
      });
    }

    // Público: instrucciones de pago de una org (por orgId)
    if (path.startsWith("/pay/") && request.method === "GET") {
      const orgId = path.split("/")[2];
      const orgs = await this.getOrgs();
      const org = orgs[orgId];
      if (!org) return Response.json({ error: "not_found" }, { status: 404 });
      if (!org.payments) org.payments = DEFAULT_PAYMENTS();
      return Response.json({
        ok: true,
        org: { id: org.id, name: org.name },
        payments: this.publicPayments(org.payments),
      });
    }

    if (path === "/live" && request.method === "GET") {
      return Response.json({ ok: true, live: await this.getLiveIndex() });
    }

    if (path.startsWith("/orgs/") && path.endsWith("/plan") && request.method === "POST") {
      const admin = this.env.STREAM_ADMIN_KEY;
      if (admin && request.headers.get("X-Admin-Key") !== admin) {
        return Response.json({ error: "unauthorized" }, { status: 401 });
      }
      const orgId = path.split("/")[2];
      const body = await request.json().catch(() => ({}));
      return Response.json(await this.setPlan(orgId, body.plan || "free"));
    }

    if (path === "/internal/live" && request.method === "POST") {
      const body = await request.json().catch(() => ({}));
      if (body.matchId) await this.registerLive(String(body.matchId), body);
      if (body.orgId && body.geneSpawns) await this.bumpUsage(body.orgId, { geneSpawns: body.geneSpawns });
      if (body.orgId && body.eventsCreated) await this.bumpUsage(body.orgId, { eventsCreated: body.eventsCreated });
      if (body.orgId && body.ticketsIssued) await this.bumpUsage(body.orgId, { ticketsIssued: body.ticketsIssued });
      return Response.json({ ok: true });
    }
    if (path === "/internal/live" && request.method === "DELETE") {
      const matchId = url.searchParams.get("matchId");
      if (matchId) await this.unregisterLive(matchId);
      return Response.json({ ok: true });
    }
    if (path === "/internal/usage" && request.method === "POST") {
      const body = await request.json().catch(() => ({}));
      if (body.orgId) await this.bumpUsage(body.orgId, body);
      return Response.json({ ok: true });
    }

    return Response.json({ error: "not_found" }, { status: 404 });
  }
}

function sanitizeTm(t) {
  return {
    holderName: String(t.holderName || "").slice(0, 80),
    phone: String(t.phone || "").replace(/[^\d+]/g, "").slice(0, 20),
    cardLast4: String(t.cardLast4 || "").replace(/\D/g, "").slice(-4),
    cardBank: String(t.cardBank || "").slice(0, 40),
    accountHint: String(t.accountHint || "").slice(0, 80),
    currency: String(t.currency || "CUP").slice(0, 8),
    amountHint: String(t.amountHint || "").slice(0, 40),
    instructions: String(t.instructions || "").slice(0, 800),
    enabled: t.enabled !== false,
  };
}

function simpleHash(s) {
  let h = 2166136261;
  const str = String(s || "");
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16);
}

export { PLANS, planOf };
