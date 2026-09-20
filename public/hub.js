/* Alset Streaming Hub client — no ES modules (mejor en móviles) */
(function (global) {
  function qs(name, fallback) {
    const u = new URL(location.href);
    return u.searchParams.get(name) || fallback || "";
  }

  function wsUrl(matchId, opts) {
    const u = new URL("/ws/" + encodeURIComponent(matchId), location.href);
    u.protocol = location.protocol === "https:" ? "wss:" : "ws:";
    u.searchParams.set("role", opts.role || "viewer");
    if (opts.id) u.searchParams.set("id", opts.id);
    if (opts.label) u.searchParams.set("label", opts.label);
    if (opts.ticket) u.searchParams.set("ticket", opts.ticket);
    return u.toString();
  }

  function iceServers() {
    return [{ urls: "stun:stun.cloudflare.com:3478" }, { urls: "stun:stun.l.google.com:19302" }];
  }

  function createPC() {
    return new RTCPeerConnection({ iceServers: iceServers(), bundlePolicy: "max-bundle" });
  }

  async function getCam() {
    if (!window.isSecureContext) {
      throw new Error("Necesitas HTTPS (contexto seguro) para la cámara.");
    }
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      throw new Error("Este navegador no expone getUserMedia. Prueba Chrome o Safari actualizado.");
    }
    return navigator.mediaDevices.getUserMedia({
      audio: true,
      video: {
        facingMode: { ideal: "environment" },
        width: { ideal: 1280 },
        height: { ideal: 720 },
        frameRate: { ideal: 24, max: 30 },
      },
    });
  }

  async function api(path, body) {
    const r = await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body || {}),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || j.message || "HTTP " + r.status);
    return j;
  }

  /**
   * Publish local media to Cloudflare SFU.
   * Returns { sessionId, tracks: [{trackName, kind}] }
   */
  async function sfuPublish(stream, baseName) {
    const sess = await api("/api/sfu/session", {});
    const sessionId = sess.session?.sessionId || sess.session?.id || sess.sessionId;
    if (!sessionId) throw new Error("SFU no devolvió sessionId: " + JSON.stringify(sess));

    const pc = createPC();
    const tracksMeta = [];
    stream.getTracks().forEach((t) => {
      pc.addTrack(t, stream);
      tracksMeta.push({ trackName: baseName + "-" + t.kind, kind: t.kind });
    });

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);

    // Wait briefly for ICE gathering (SFU often works with trickle incomplete)
    await waitIce(pc, 1200);

    const tracks = [];
    pc.getTransceivers().forEach((tr, i) => {
      const kind = tr.sender?.track?.kind || (i === 0 ? "video" : "audio");
      const trackName = baseName + "-" + kind;
      tracks.push({
        location: "local",
        mid: tr.mid != null ? String(tr.mid) : String(i),
        trackName,
      });
    });

    const res = await api("/api/sfu/tracks", {
      sessionId,
      sessionDescription: { type: "offer", sdp: pc.localDescription.sdp },
      tracks,
    });

    const answer = res.result?.sessionDescription || res.sessionDescription;
    if (answer && answer.sdp) {
      await pc.setRemoteDescription(answer);
    }

    return {
      pc,
      sessionId,
      tracks: tracks.map((t) => ({ trackName: t.trackName, kind: t.trackName.split("-").pop() })),
    };
  }

  /** Pull remote tracks from a publisher SFU session into a viewer PC */
  async function sfuPull(remoteSessionId, remoteTracks) {
    const sess = await api("/api/sfu/session", {});
    const sessionId = sess.session?.sessionId || sess.session?.id || sess.sessionId;
    if (!sessionId) throw new Error("SFU sessionId missing");

    const pc = createPC();
    const remoteStream = new MediaStream();
    pc.ontrack = (e) => {
      e.streams[0]?.getTracks().forEach((t) => remoteStream.addTrack(t));
      if (e.track) remoteStream.addTrack(e.track);
    };

    const tracks = (remoteTracks || []).map((t) => ({
      location: "remote",
      sessionId: remoteSessionId,
      trackName: t.trackName || t,
    }));

    const res = await api("/api/sfu/tracks", { sessionId, tracks });
    const offer = res.result?.sessionDescription || res.sessionDescription;
    if (offer && offer.sdp) {
      await pc.setRemoteDescription(offer);
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      await waitIce(pc, 1200);
      await api("/api/sfu/renegotiate", {
        sessionId,
        sessionDescription: { type: "answer", sdp: pc.localDescription.sdp },
      });
    }

    return { pc, sessionId, stream: remoteStream };
  }

  function waitIce(pc, ms) {
    if (pc.iceGatheringState === "complete") return Promise.resolve();
    return new Promise((resolve) => {
      const t = setTimeout(resolve, ms);
      pc.onicegatheringstatechange = () => {
        if (pc.iceGatheringState === "complete") {
          clearTimeout(t);
          resolve();
        }
      };
    });
  }

  function diag() {
    return {
      href: location.href,
      secure: window.isSecureContext,
      protocol: location.protocol,
      ua: navigator.userAgent.slice(0, 120),
      media: !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia),
      rtc: typeof RTCPeerConnection !== "undefined",
      ws: typeof WebSocket !== "undefined",
    };
  }

  global.AlsetHub = { qs, wsUrl, createPC, getCam, api, sfuPublish, sfuPull, diag, iceServers };
})(window);
 /* v0.2.1 */
