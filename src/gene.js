/**
 * Alset Stream Genes — células de transmisión en el borde.
 * Nacen al ir en vivo / al conectar un publisher; se destruyen al cerrar el evento.
 * No sustituyen el SFU de media: lo orquestan (identidad, cupo, ciclo de vida).
 */

export const GENE_KIND = {
  ROOM: "stream.room",
  PUBLISHER: "stream.publisher",
  VIEWER: "stream.viewer",
  DIRECTOR: "stream.director",
};

export const PLANS = {
  free: {
    id: "free",
    label: "Free",
    maxLiveEvents: 1,
    maxPublishers: 2,
    maxViewers: 25,
    maxTicketsPerEvent: 50,
    sfu: false,
    priceHint: "0",
  },
  pro: {
    id: "pro",
    label: "Pro",
    maxLiveEvents: 10,
    maxPublishers: 8,
    maxViewers: 300,
    maxTicketsPerEvent: 2000,
    sfu: true,
    priceHint: "suscripción",
  },
  event: {
    id: "event",
    label: "Evento",
    maxLiveEvents: 1,
    maxPublishers: 12,
    maxViewers: 1000,
    maxTicketsPerEvent: 10000,
    sfu: true,
    priceHint: "pago por evento",
  },
};

export function planOf(name) {
  return PLANS[name] || PLANS.free;
}

export function newGeneId(kind) {
  const short = kind.split(".").pop().slice(0, 3);
  const r = cryptoRandom(8);
  return `gene-${short}-${r}.ans`;
}

function cryptoRandom(n) {
  const a = "abcdefghijklmnopqrstuvwxyz0123456789";
  let s = "";
  const buf = new Uint8Array(n);
  if (typeof crypto !== "undefined" && crypto.getRandomValues) {
    crypto.getRandomValues(buf);
  } else {
    for (let i = 0; i < n; i++) buf[i] = Math.floor(Math.random() * 256);
  }
  for (let i = 0; i < n; i++) s += a[buf[i] % a.length];
  return s;
}

export function spawnGene({ kind, matchId, orgId, label, peerId, sfuSessionId }) {
  const now = Date.now();
  return {
    id: newGeneId(kind),
    kind,
    matchId,
    orgId: orgId || null,
    peerId: peerId || null,
    label: label || kind,
    status: "live",
    edge: sfuSessionId ? "sfu+do" : "durable-object",
    sfuSessionId: sfuSessionId || null,
    createdAt: now,
    updatedAt: now,
    destroyedAt: null,
  };
}

export function destroyGene(gene) {
  return {
    ...gene,
    status: "destroyed",
    updatedAt: Date.now(),
    destroyedAt: Date.now(),
    sfuSessionId: null,
  };
}

export function genePublic(g) {
  if (!g) return null;
  return {
    id: g.id,
    kind: g.kind,
    label: g.label,
    status: g.status,
    edge: g.edge,
    peerId: g.peerId,
    hasSfu: !!g.sfuSessionId,
    createdAt: g.createdAt,
    destroyedAt: g.destroyedAt,
  };
}
