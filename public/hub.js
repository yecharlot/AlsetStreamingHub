/* Alset Streaming Hub — SFU (Cloudflare Calls, patrón echo oficial) + mesh fallback */
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

  function createPC() {
    return new RTCPeerConnection({
      iceServers: [
        { urls: "stun:stun.cloudflare.com:3478" },
        { urls: "stun:stun.l.google.com:19302" },
      ],
      bundlePolicy: "max-bundle",
    });
  }

  async function getCam() {
    if (!window.isSecureContext) throw new Error("Usa HTTPS.");
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      throw new Error("Sin getUserMedia en este navegador.");
    }
    try {
      return await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: {
          facingMode: { ideal: "environment" },
          width: { ideal: 640 },
          height: { ideal: 360 },
        },
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
      const msg =
        j.error || j.message || (j.data && j.data.errorDescription) || "HTTP " + r.status;
      throw new Error(msg);
    }
    return j;
  }

  function waitIceConnected(pc, ms) {
    if (pc.iceConnectionState === "connected" || pc.iceConnectionState === "completed") {
      return Promise.resolve();
    }
    return new Promise(function (resolve, reject) {
      var t = setTimeout(function () {
        reject(new Error("ICE timeout"));
      }, ms);
      function h() {
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
      }
      pc.addEventListener("iceconnectionstatechange", h);
    });
  }

  /**
   * Publicar cámara al SFU — patrón echo Cloudflare:
   * trackName = MediaStreamTrack.id
   */
  async function sfuPublish(stream) {
    var sess = await api("/api/sfu/session", {});
    var sessionId = (sess.session && sess.session.sessionId) || sess.sessionId;
    if (!sessionId) throw new Error("Sin sessionId SFU");

    var pc = createPC();
    var transceivers = stream.getTracks().map(function (track) {
      return pc.addTransceiver(track, { direction: "sendonly" });
    });

    var offer = await pc.createOffer();
    await pc.setLocalDescription(offer);

    var tracksPayload = transceivers.map(function (tr) {
      return {
        location: "local",
        mid: String(tr.mid),
        trackName: tr.sender.track ? tr.sender.track.id : "t-" + Math.random().toString(36).slice(2, 8),
      };
    });

    var res = await api("/api/sfu/tracks", {
      sessionId: sessionId,
      sessionDescription: { type: "offer", sdp: pc.localDescription.sdp },
      tracks: tracksPayload,
    });

    var push = res.result || res;
    if (push.errorCode || push.errorDescription) {
      throw new Error(push.errorDescription || push.errorCode);
    }
    var sd = push.sessionDescription;
    if (!sd || !sd.sdp) {
      throw new Error("SFU no devolvió answer al publicar");
    }

    // Registrar ICE wait antes del setRemoteDescription (evitar race)
    var iceWait = waitIceConnected(pc, 8000).catch(function () {});
    await pc.setRemoteDescription(new RTCSessionDescription(sd));
    await iceWait;

    // Nombres confirmados por el servidor (imprescindibles para pull)
    var confirmed = [];
    (push.tracks || []).forEach(function (t) {
      if (t.errorCode) return;
      if (t.trackName) {
        confirmed.push({
          trackName: t.trackName,
          mid: t.mid != null ? String(t.mid) : undefined,
          kind: String(t.trackName).indexOf("audio") >= 0 ? "audio" : "video",
        });
      }
    });
    if (!confirmed.length) {
      confirmed = tracksPayload.map(function (t) {
        return { trackName: t.trackName, mid: t.mid, kind: "video" };
      });
    }

    return { pc: pc, sessionId: sessionId, tracks: confirmed, mode: "sfu" };
  }

  /**
   * Suscribirse a tracks remotos — patrón echo Cloudflare
   */
  async function sfuPull(remoteSessionId, remoteTracks) {
    if (!remoteSessionId) throw new Error("Sin sessionId del publicador");
    var list = (remoteTracks || []).filter(function (t) {
      return t && (t.trackName || t.name);
    });
    if (!list.length) throw new Error("Sin trackNames del publicador");

    var sess = await api("/api/sfu/session", {});
    var sessionId = (sess.session && sess.session.sessionId) || sess.sessionId;
    if (!sessionId) throw new Error("Sin sessionId SFU (viewer)");

    var pc = createPC();
    var remoteStream = new MediaStream();

    // ontrack global (además del wait por mid)
    pc.ontrack = function (ev) {
      if (ev.track) remoteStream.addTrack(ev.track);
      if (ev.streams && ev.streams[0]) {
        ev.streams[0].getTracks().forEach(function (t) {
          if (remoteStream.getTracks().indexOf(t) < 0) remoteStream.addTrack(t);
        });
      }
    };

    var tracksBody = list.map(function (t) {
      return {
        location: "remote",
        sessionId: remoteSessionId,
        trackName: t.trackName || t.name,
      };
    });

    var res = await api("/api/sfu/tracks", {
      sessionId: sessionId,
      tracks: tracksBody,
    });
    var pull = res.result || res;
    if (pull.errorCode) throw new Error(pull.errorDescription || pull.errorCode);

    var trackList = pull.tracks || [];

    // Esperar tracks POR mid ANTES de setRemoteDescription (como el demo echo)
    var resolvingTracks = Promise.all(
      trackList
        .filter(function (t) {
          return t.mid && !t.errorCode;
        })
        .map(function (t) {
          return new Promise(function (resolve, reject) {
            var timer = setTimeout(function () {
              reject(new Error("timeout mid=" + t.mid));
            }, 12000);
            function handler(ev) {
              if (ev.transceiver && String(ev.transceiver.mid) !== String(t.mid)) return;
              clearTimeout(timer);
              pc.removeEventListener("track", handler);
              if (ev.track) remoteStream.addTrack(ev.track);
              resolve(ev.track);
            }
            pc.addEventListener("track", handler);
          });
        })
    );

    if (pull.sessionDescription && pull.sessionDescription.sdp) {
      await pc.setRemoteDescription(new RTCSessionDescription(pull.sessionDescription));
      var answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      await api("/api/sfu/renegotiate", {
        sessionId: sessionId,
        sessionDescription: { type: "answer", sdp: pc.localDescription.sdp },
      });
    } else if (pull.requiresImmediateRenegotiation || pull.requiresImmediateRenegotation) {
      throw new Error("SFU pidió renegotiate pero no envió SDP");
    }

    try {
      await resolvingTracks;
    } catch (e) {
      console.warn("mid wait", e);
    }

    // Espera extra por ontrack genérico
    if (!remoteStream.getTracks().length) {
      await new Promise(function (resolve) {
        var n = 0;
        var iv = setInterval(function () {
          n++;
          if (remoteStream.getTracks().length || n > 40) {
            clearInterval(iv);
            resolve();
          }
        }, 100);
      });
    }

    await waitIceConnected(pc, 10000).catch(function () {});

    if (!remoteStream.getTracks().length) {
      try {
        pc.close();
      } catch (_) {}
      throw new Error("SFU conectó pero no llegaron tracks de video/audio");
    }

    return {
      pc: pc,
      sessionId: sessionId,
      stream: remoteStream,
      mode: "sfu",
      close: function () {
        try {
          pc.close();
        } catch (_) {}
      },
    };
  }

  function meshPublisherAttach(stream, ws) {
    var pcs = new Map();

    async function handleSignal(from, data) {
      var pc = pcs.get(from);
      if (!pc) {
        pc = createPC();
        pcs.set(from, pc);
        stream.getTracks().forEach(function (t) {
          pc.addTrack(t, stream);
        });
        pc.onicecandidate = function (e) {
          if (e.candidate && ws.readyState === 1) {
            ws.send(
              JSON.stringify({
                type: "signal",
                to: from,
                data: { candidate: e.candidate },
              })
            );
          }
        };
      }
      if (data.offer) {
        await pc.setRemoteDescription(data.offer);
        var answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        ws.send(JSON.stringify({ type: "signal", to: from, data: { answer: answer } }));
      } else if (data.candidate) {
        try {
          await pc.addIceCandidate(data.candidate);
        } catch (_) {}
      }
    }

    return {
      handleSignal: handleSignal,
      close: function () {
        pcs.forEach(function (pc) {
          pc.close();
        });
        pcs.clear();
      },
    };
  }

  async function meshPull(ws, producerId, onStream) {
    var pc = createPC();
    var remoteStream = new MediaStream();
    pc.ontrack = function (e) {
      if (e.track) remoteStream.addTrack(e.track);
      onStream(remoteStream);
    };
    pc.onicecandidate = function (e) {
      if (e.candidate && ws.readyState === 1) {
        ws.send(
          JSON.stringify({
            type: "signal",
            to: producerId,
            data: { candidate: e.candidate },
          })
        );
      }
    };
    pc.addTransceiver("video", { direction: "recvonly" });
    pc.addTransceiver("audio", { direction: "recvonly" });
    var offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    ws.send(JSON.stringify({ type: "signal", to: producerId, data: { offer: offer } }));

    return {
      pc: pc,
      stream: remoteStream,
      mode: "mesh",
      handleSignal: async function (data) {
        if (data.answer) await pc.setRemoteDescription(data.answer);
        else if (data.candidate) {
          try {
            await pc.addIceCandidate(data.candidate);
          } catch (_) {}
        }
      },
      close: function () {
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
    qs: qs,
    wsUrl: wsUrl,
    createPC: createPC,
    getCam: getCam,
    api: api,
    sfuPublish: sfuPublish,
    sfuPull: sfuPull,
    meshPublisherAttach: meshPublisherAttach,
    meshPull: meshPull,
    diag: diag,
  };
})(window);
/* ash-sfu-echo-pattern-2026-09-21 */
