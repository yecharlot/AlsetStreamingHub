/* Alset Streaming Hub — SFU (Cloudflare Calls) + mesh fallback. Ligero, sin modules. */
(function (global) {
  function qs(name, fallback) {
    return new URL(location.href).searchParams.get(name) || fallback || "";
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
    return [
      { urls: "stun:stun.cloudflare.com:3478" },
      { urls: "stun:stun.l.google.com:19302" },
      { urls: "turn:openrelay.metered.ca:80", username: "openrelayproject", credential: "openrelayproject" },
      { urls: "turn:openrelay.metered.ca:443", username: "openrelayproject", credential: "openrelayproject" },
      { urls: "turn:openrelay.metered.ca:443?transport=tcp", username: "openrelayproject", credential: "openrelayproject" },
    ];
  }

  function createPC() {
    return new RTCPeerConnection({
      iceServers: iceServers(),
      bundlePolicy: "max-bundle",
    });
  }

  async function getCam() {
    if (!window.isSecureContext) throw new Error("Usa HTTPS.");
    if (!navigator.mediaDevices?.getUserMedia) throw new Error("Sin getUserMedia en este navegador.");
    // Prefer simpler constraints for mobile reliability
    try {
      return await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: { facingMode: { ideal: "environment" }, width: { ideal: 640 }, height: { ideal: 360 } },
      });
    } catch (_) {
      return navigator.mediaDevices.getUserMedia({ audio: true, video: true });
    }
  }

  async function api(path, body) {
    const r = await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body === undefined ? {} : body),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) {
      const msg = j.error || j.message || j.data?.errorDescription || ("HTTP " + r.status);
      throw new Error(msg);
    }
    return j;
  }

  function waitIceConnected(pc, ms) {
    if (pc.iceConnectionState === "connected" || pc.iceConnectionState === "completed") {
      return Promise.resolve();
    }
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error("ICE timeout")), ms);
      const h = () => {
        if (pc.iceConnectionState === "connected" || pc.iceConnectionState === "completed") {
          clearTimeout(t);
          pc.removeEventListener("iceconnectionstatechange", h);
          resolve();
        }
        if (pc.iceConnectionState === "failed") {
          clearTimeout(t);
          pc.removeEventListener("iceconnectionstatechange", h);
          reject(new Error("ICE failed"));
        }
      };
      pc.addEventListener("iceconnectionstatechange", h);
    });
  }

  /** Publish local camera to Cloudflare SFU (Calls). Pattern = official echo demo. */
  async function sfuPublish(stream, baseName) {
    const sess = await api("/api/sfu/session", {});
    const sessionId = sess.session?.sessionId || sess.sessionId;
    if (!sessionId) throw new Error("Sin sessionId SFU");

    const pc = createPC();
    const transceivers = stream.getTracks().map((track) =>
      pc.addTransceiver(track, { direction: "sendonly" })
    );

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);

    const tracksPayload = transceivers.map((tr) => {
      const kind = tr.sender.track?.kind || "video";
      const trackName = (baseName || "cam") + "-" + kind;
      return { location: "local", mid: String(tr.mid), trackName };
    });

    const res = await api("/api/sfu/tracks", {
      sessionId,
      sessionDescription: { type: "offer", sdp: pc.localDescription.sdp },
      tracks: tracksPayload,
    });

    const push = res.result || res;
    if (push.errorCode || push.errorDescription) {
      throw new Error(push.errorDescription || push.errorCode);
    }
    const sd = push.sessionDescription;
    if (!sd || !sd.sdp) {
      throw new Error("SFU no devolvió answer al publicar. " + JSON.stringify(push).slice(0, 200));
    }

    const iceWait = waitIceConnected(pc, 8000).catch(() => {});
    await pc.setRemoteDescription(new RTCSessionDescription(sd));
    await iceWait;

    // Prefer server-confirmed track names
    const confirmed =
      (push.tracks || [])
        .filter((t) => t.trackName && !t.errorCode)
        .map((t) => ({ trackName: t.trackName, kind: t.trackName.includes("audio") ? "audio" : "video", mid: t.mid })) ||
      tracksPayload.map((t) => ({ trackName: t.trackName, kind: t.trackName.split("-").pop() }));

    if (!confirmed.length) {
      confirmed.push(...tracksPayload.map((t) => ({ trackName: t.trackName, kind: t.trackName.split("-").pop() })));
    }

    return { pc, sessionId, tracks: confirmed, mode: "sfu" };
  }

  /** Subscribe to remote SFU tracks */
  async function sfuPull(remoteSessionId, remoteTracks) {
    const sess = await api("/api/sfu/session", {});
    const sessionId = sess.session?.sessionId || sess.sessionId;
    if (!sessionId) throw new Error("Sin sessionId SFU (viewer)");

    const pc = createPC();
    const remoteStream = new MediaStream();

    const tracks = (remoteTracks || []).map((t) => ({
      location: "remote",
      sessionId: remoteSessionId,
      trackName: typeof t === "string" ? t : t.trackName,
    }));

    if (!tracks.length) throw new Error("Sin tracks remotos");

    const res = await api("/api/sfu/tracks", { sessionId, tracks });
    const pull = res.result || res;
    if (pull.errorCode) throw new Error(pull.errorDescription || pull.errorCode);

    const trackList = pull.tracks || [];
    const midWait = Promise.all(
      trackList
        .filter((t) => t.mid && !t.errorCode)
        .map(
          (t) =>
            new Promise((resolve, reject) => {
              const timer = setTimeout(() => reject(new Error("track timeout mid=" + t.mid)), 10000);
              const handler = (ev) => {
                if (ev.transceiver && String(ev.transceiver.mid) !== String(t.mid)) return;
                clearTimeout(timer);
                pc.removeEventListener("track", handler);
                if (ev.track) remoteStream.addTrack(ev.track);
                resolve(ev.track);
              };
              pc.addEventListener("track", handler);
            })
        )
    ).catch((e) => {
      console.warn(e);
    });

    pc.ontrack = (ev) => {
      if (ev.track) remoteStream.addTrack(ev.track);
      (ev.streams[0] || { getTracks: () => [] }).getTracks().forEach((t) => {
        if (!remoteStream.getTracks().includes(t)) remoteStream.addTrack(t);
      });
    };

    if (pull.sessionDescription && pull.sessionDescription.sdp) {
      await pc.setRemoteDescription(new RTCSessionDescription(pull.sessionDescription));
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      await api("/api/sfu/renegotiate", {
        sessionId,
        sessionDescription: { type: "answer", sdp: pc.localDescription.sdp },
      });
    } else if (pull.requiresImmediateRenegotiation) {
      throw new Error("SFU pidió renegotiate pero no envió SDP");
    }

    await midWait;
    await waitIceConnected(pc, 10000).catch(() => {});

    if (!remoteStream.getTracks().length) {
      throw new Error("SFU conectó pero no llegaron tracks de video/audio");
    }

    return { pc, sessionId, stream: remoteStream, mode: "sfu" };
  }

  // —— Mesh fallback (1 publisher ↔ few viewers via DO signaling) ——
  function meshPublisherAttach(stream, ws, myId) {
    const pcs = new Map();

    async function handleSignal(from, data) {
      let pc = pcs.get(from);
      if (!pc) {
        pc = createPC();
        pcs.set(from, pc);
        stream.getTracks().forEach((t) => pc.addTrack(t, stream));
        pc.onicecandidate = (e) => {
          if (e.candidate && ws.readyState === 1) {
            ws.send(JSON.stringify({ type: "signal", to: from, data: { candidate: e.candidate } }));
          }
        };
      }
      if (data.offer) {
        await pc.setRemoteDescription(data.offer);
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        ws.send(JSON.stringify({ type: "signal", to: from, data: { answer } }));
      } else if (data.candidate) {
        try {
          await pc.addIceCandidate(data.candidate);
        } catch (_) {}
      }
    }

    return {
      handleSignal,
      close() {
        pcs.forEach((pc) => pc.close());
        pcs.clear();
      },
    };
  }

  async function meshPull(ws, producerId, onStream) {
    const pc = createPC();
    const remoteStream = new MediaStream();
    pc.ontrack = (e) => {
      if (e.track) remoteStream.addTrack(e.track);
      onStream(remoteStream);
    };
    pc.onicecandidate = (e) => {
      if (e.candidate && ws.readyState === 1) {
        ws.send(JSON.stringify({ type: "signal", to: producerId, data: { candidate: e.candidate } }));
      }
    };
    pc.addTransceiver("video", { direction: "recvonly" });
    pc.addTransceiver("audio", { direction: "recvonly" });
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    ws.send(JSON.stringify({ type: "signal", to: producerId, data: { offer } }));

    return {
      pc,
      stream: remoteStream,
      mode: "mesh",
      async handleSignal(data) {
        if (data.answer) await pc.setRemoteDescription(data.answer);
        else if (data.candidate) {
          try {
            await pc.addIceCandidate(data.candidate);
          } catch (_) {}
        }
      },
      close() {
        pc.close();
      },
    };
  }

  function diag() {
    return {
      href: location.href,
      secure: !!window.isSecureContext,
      media: !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia),
      rtc: typeof RTCPeerConnection !== "undefined",
    };
  }

  global.AlsetHub = {
    qs,
    wsUrl,
    createPC,
    getCam,
    api,
    sfuPublish,
    sfuPull,
    meshPublisherAttach,
    meshPull,
    diag,
  };
})(window);
/* 1789946034 */

/* restored-pre-saas + turn */
