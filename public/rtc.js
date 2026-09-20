/**
 * Lightweight WebRTC helpers for Alset Streaming Hub
 * Signaling via Durable Object WebSocket.
 */

export function wsUrl(matchId, { role, id, label, ticket }) {
  const u = new URL(`/ws/${encodeURIComponent(matchId)}`, location.origin);
  u.protocol = location.protocol === "https:" ? "wss:" : "ws:";
  u.searchParams.set("role", role);
  if (id) u.searchParams.set("id", id);
  if (label) u.searchParams.set("label", label);
  if (ticket) u.searchParams.set("ticket", ticket);
  return u.toString();
}

export function createPeerConnection() {
  return new RTCPeerConnection({
    iceServers: [
      { urls: "stun:stun.cloudflare.com:3478" },
      { urls: "stun:stun.l.google.com:19302" },
    ],
  });
}

export async function getCameraStream({ audio = true, video = true } = {}) {
  return navigator.mediaDevices.getUserMedia({
    audio,
    video: video
      ? {
          facingMode: { ideal: "environment" },
          width: { ideal: 1280 },
          height: { ideal: 720 },
          frameRate: { ideal: 30, max: 30 },
        }
      : false,
  });
}

/** Estimate a crude quality score 0..1 from stats */
export async function estimateQuality(pc) {
  try {
    const stats = await pc.getStats();
    let bitrate = 0;
    let fps = 0;
    stats.forEach((r) => {
      if (r.type === "outbound-rtp" && !r.isRemote) {
        if (r.kind === "video" || r.mediaType === "video") {
          if (r.bytesSent && r.timestamp) bitrate = r.bytesSent;
          if (r.framesPerSecond) fps = r.framesPerSecond;
        }
      }
    });
    const q = Math.min(1, 0.35 + (fps / 30) * 0.4 + (bitrate > 0 ? 0.2 : 0));
    return { quality: q, fps, bitrate };
  } catch {
    return { quality: 0.5, fps: 0, bitrate: 0 };
  }
}
