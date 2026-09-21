/**
 * SaaS registry — organizaciones, planes y índice de genes vivos.
 * Durable Object global: un enjambre de orgs; cada evento sigue en MatchRoom.
 */

import { PLANS, planOf, genePublic } from "./gene.js";

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
    return (await this.state.storage.get("apiKeys")) || {}; // key hash -> orgId
  }

  async putKeys(k) {
    await this.state.storage.put("apiKeys", k);
  }

  async getLiveIndex() {
    return (await this.state.storage.get("liveIndex")) || {}; // matchId -> { orgId, title, geneCount, updatedAt }
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
    if (orgs[id]) {
      return { error: "org_exists", id };
    }
    const plan = planOf(body.plan || "free");
    const apiKey = this.randomKey();
    const org = {
      id,
      name: String(body.name || id).slice(0, 80),
      plan: plan.id,
      apiKey,
      createdAt: Date.now(),
      eventsCreated: 0,
    };
    orgs[id] = { ...org, apiKeyHash: simpleHash(apiKey) };
    // store plaintext key only once in response; persist hash + masked
    const store = { ...orgs[id], apiKey: undefined, apiKeyMask: apiKey.slice(0, 8) + "…" };
    orgs[id] = store;
    const keys = await this.getKeys();
    keys[simpleHash(apiKey)] = id;
    await this.putOrgs(orgs);
    await this.putKeys(keys);
    return { ok: true, org: { id: org.id, name: org.name, plan: org.plan, apiKey, limits: plan } };
  }

  async resolveApiKey(key) {
    if (!key) return null;
    const keys = await this.getKeys();
    const orgId = keys[simpleHash(key)];
    if (!orgId) return null;
    const orgs = await this.getOrgs();
    return orgs[orgId] || null;
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
    }));
  }

  async setPlan(orgId, planId) {
    const orgs = await this.getOrgs();
    if (!orgs[orgId]) return { error: "not_found" };
    if (!PLANS[planId]) return { error: "bad_plan" };
    orgs[orgId].plan = planId;
    await this.putOrgs(orgs);
    return { ok: true, org: orgs[orgId], limits: planOf(planId) };
  }

  async registerLive(matchId, info) {
    const idx = await this.getLiveIndex();
    idx[matchId] = { ...info, updatedAt: Date.now() };
    await this.putLiveIndex(idx);
  }

  async unregisterLive(matchId) {
    const idx = await this.getLiveIndex();
    delete idx[matchId];
    await this.putLiveIndex(idx);
  }

  async fetch(request) {
    const url = new URL(request.url);
    const path = url.pathname.replace(/^\/saas/, "") || "/";

    if (path === "/health" || path === "/") {
      return Response.json({
        ok: true,
        service: "alset-streaming-saas",
        model: "genes-edge-swarm",
        plans: PLANS,
      });
    }

    if (path === "/plans" && request.method === "GET") {
      return Response.json({ ok: true, plans: PLANS });
    }

    if (path === "/orgs" && request.method === "POST") {
      const body = await request.json().catch(() => ({}));
      const out = await this.createOrg(body);
      const status = out.error ? 400 : 200;
      return Response.json(out, { status });
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
        org: { id: org.id, name: org.name, plan: org.plan, eventsCreated: org.eventsCreated || 0 },
        limits: planOf(org.plan),
      });
    }

    if (path === "/live" && request.method === "GET") {
      const idx = await this.getLiveIndex();
      return Response.json({ ok: true, live: idx });
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

    // Internal: MatchRoom → registry
    if (path === "/internal/live" && request.method === "POST") {
      const body = await request.json().catch(() => ({}));
      if (body.matchId) await this.registerLive(String(body.matchId), body);
      return Response.json({ ok: true });
    }
    if (path === "/internal/live" && request.method === "DELETE") {
      const matchId = url.searchParams.get("matchId");
      if (matchId) await this.unregisterLive(matchId);
      return Response.json({ ok: true });
    }

    return Response.json({ error: "not_found" }, { status: 404 });
  }
}

function simpleHash(s) {
  // FNV-1a 32-bit — suficiente para indexar api keys en DO (no es password hashing de usuarios)
  let h = 2166136261;
  const str = String(s || "");
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16);
}

export { PLANS, planOf, genePublic };
