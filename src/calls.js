/**
 * Cloudflare Realtime SFU (Calls) — server-side session/track helpers.
 * API base: https://rtc.live.cloudflare.com/v1/apps/{APP_ID}
 */

const CALLS_BASE = "https://rtc.live.cloudflare.com/v1/apps";

export function callsConfigured(env) {
  return !!(env.CALLS_APP_ID && env.CALLS_APP_SECRET);
}

async function callsFetch(env, path, { method = "GET", body, jsonBody = true } = {}) {
  const url = `${CALLS_BASE}/${env.CALLS_APP_ID}${path}`;
  const headers = {
    Authorization: `Bearer ${env.CALLS_APP_SECRET}`,
  };
  let payload;
  if (body !== undefined && body !== null) {
    headers["Content-Type"] = "application/json";
    payload = JSON.stringify(body);
  } else if (method !== "GET" && method !== "HEAD" && jsonBody === false) {
    // no body (required for sessions/new)
    payload = undefined;
  }
  const res = await fetch(url, {
    method,
    headers,
    body: payload,
  });
  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = { raw: text };
  }
  if (!res.ok) {
    const err = new Error(data?.errorDescription || data?.error || text || res.statusText);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

/** Create SFU session (maps to one PeerConnection on the client). */
export async function createSession(env) {
  // Realtime SFU rejects body `{}` on sessions/new — send no body.
  return callsFetch(env, "/sessions/new", { method: "POST", jsonBody: false });
}

/**
 * Publish or pull tracks.
 * body examples in Cloudflare Connection API.
 */
export async function newTracks(env, sessionId, body) {
  return callsFetch(env, `/sessions/${sessionId}/tracks/new`, { method: "POST", body });
}

export async function renegotiate(env, sessionId, body) {
  return callsFetch(env, `/sessions/${sessionId}/renegotiate`, { method: "PUT", body });
}

export async function closeTracks(env, sessionId, body) {
  return callsFetch(env, `/sessions/${sessionId}/tracks/close`, { method: "PUT", body });
}

export async function getSession(env, sessionId) {
  return callsFetch(env, `/sessions/${sessionId}`, { method: "GET" });
}
