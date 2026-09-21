/* Alset Streaming Hub — SFU (Calls echo) + mesh con TURN de respaldo */
(function (global) {
  function qs(name, fallback) {
    return new URL(location.href).searchParams.get(name) || fallback || "";
  }

  function wsUrl(matchId, opts) {
    var u = new URL("/ws/" + encodeURIComponent(matchId), location.href);
    u.protocol = location.protocol === "https:" ? "wss:" : "ws:";
    u.searchParams.set("role", opts.role || "viewer");
    if (opts.id) u.searchParams.set("id", opts.id);
    if (opts.label) u.searchParams.set("label", opts.label);
    if (opts.ticket) u.searchParams.set("ticket", opts.ticket);
    return u.toString();
  }

  /** STUN + TURN público de respaldo (mesh en redes móviles) */
  function iceServers() {
    return [
      { urls: "stun:stun.cloudflare.com:3478" },
      { urls: "stun:stun.l.google.com:19302" },
      {
        urls: "turn:openrelay.metered.ca:80",
        username: "openrelayproject",
        credential: "openrelayproject",
      },
      {
        urls: "turn:openrelay.metered.ca:443",
        username: "openrelayproject",
        credential: "openrelayproject",
      },
      {
        urls: "turn:openrelay.metered.ca:443?transport=tcp",
        username: "openrelayproject",
        credential: "openrelayproject",
      },
    ];
  }

  function createPC() {
    return new RTCPeerConnection({
      iceServers: iceServers(),
      bundlePolicy: "max-bundle",
      iceCandidatePoolSize: 4,
    });
  }

  async function getCam() {
    if (!window.isSecureContext) throw new Error("Usa HTTPS.");
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      throw new Error("Sin getUserMedia.");
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
    var r = await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body === undefined ? {} : body),
    });
    var j = await r.json().catch(function () {
      return {};
    });
    if (!r.ok) {
      throw new Error(
        j.error || j.message || (j.data && j.data.errorDescription) || "HTTP " + r.status
      );
    }
    return j;
  }

  function waitIceConnected(pc, ms) {
    if (pc.iceConnectionState === "connected" || pc.iceConnectionState === "completed") {
      return Promise.resolve();
    }
    return new Promise(function (resolve, reject) {
      var t = setTimeout(function () {
        reject(new Error("ICE timeout (" + pc.iceConnectionState + ")"));
      }, ms);
      function h() {
        var s = pc.iceConnectionState;
        if (s === "connected" || s === "completed") {
          clearTimeout(t);
          pc.removeEventListener("iceconnectionstatechange", h);
          resolve();
        }
        if (s === "failed") {
          clearTimeout(t);
          pc.removeEventListener("iceconnectionstatechange", h);
          reject(new Error("ICE failed"));
        }
      }
      pc.addEventListener("iceconnectionstatechange", h);
    });
  }

  function waitTracks(stream, ms) {
    if (stream.getTracks().length) return Promise.resolve();
    return new Promise(function (resolve) {
      var n = 0;
      var iv = setInterval(function () {
        n++;
        if (stream.getTracks().length || n * 100 >= ms) {
          clearInterval(iv);
          resolve();
        }
      }, 100);
    });
  }

  /** Publicar al SFU (patrón echo Cloudflare) */
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
        trackName: tr.sender.track
          ? tr.sender.track.id
          : "t-" + Math.random().toString(36).slice(2, 8),
      };
    });

    var res = await api("/api/sfu/tracks", {
      sessionId: sessionId,
      sessionDescription: { type: "offer", sdp: pc.localDescription.sdp },
      tracks: tracksPayload,
    });
    var push = res.result || res;
    if (push.errorCode) throw new Error(push.errorDescription || push.errorCode);
    if (!push.sessionDescription || !push.sessionDescription.sdp) {
      throw new Error("SFU sin answer al publicar");
    }

    var iceP = waitIceConnected(pc, 10000).catch(function (e) {
      console.warn(e);
    });
    await pc.setRemoteDescription(new RTCSessionDescription(push.sessionDescription));
    await iceP;

    var confirmed = [];
    (push.tracks || []).forEach(function (t) {
      if (t.errorCode || !t.trackName) return;
      confirmed.push({
        trackName: t.trackName,
        mid: t.mid != null ? String(t.mid) : undefined,
      });
    });
    if (!confirmed.length) {
      confirmed = tracksPayload.map(function (t) {
        return { trackName: t.trackName, mid: t.mid };
      });
    }

    return { pc: pc, sessionId: sessionId, tracks: confirmed, mode: "sfu" };
  }

  /** Suscribir tracks remotos SFU */
  async function sfuPull(remoteSessionId, remoteTracks) {
    if (!remoteSessionId) throw new Error("Sin sessionId publicador");
    var list = (remoteTracks || []).filter(function (t) {
      return t && (t.trackName || t.name);
    });
    if (!list.length) throw new Error("Publicador sin trackNames (reinicia TX)");

    var sess = await api("/api/sfu/session", {});
    var sessionId = (sess.session && sess.session.sessionId) || sess.sessionId;
    if (!sessionId) throw new Error("Sin sessionId viewer");

    var pc = createPC();
    var remoteStream = new MediaStream();

    pc.ontrack = function (ev) {
      if (ev.track) remoteStream.addTrack(ev.track);
      if (ev.streams && ev.streams[0]) {
        ev.streams[0].getTracks().forEach(function (t) {
          if (remoteStream.getTracks().indexOf(t) < 0) remoteStream.addTrack(t);
        });
      }
    };

    var res = await api("/api/sfu/tracks", {
      sessionId: sessionId,
      tracks: list.map(function (t) {
        return {
          location: "remote",
          sessionId: remoteSessionId,
          trackName: t.trackName || t.name,
        };
      }),
    });
    var pull = res.result || res;
    if (pull.errorCode) throw new Error(pull.errorDescription || pull.errorCode);

    var trackList = pull.tracks || [];
    var resolving = Promise.all(
      trackList
        .filter(function (t) {
          return t.mid && !t.errorCode;
        })
        .map(function (t) {
          return new Promise(function (resolve) {
            var timer = setTimeout(function () {
              resolve(null);
            }, 10000);
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
    }

    await resolving;
    await waitTracks(remoteStream, 5000);
    await waitIceConnected(pc, 12000).catch(function () {});

    if (!remoteStream.getTracks().length) {
      try {
        pc.close();
      } catch (_) {}
      throw new Error("SFU sin tracks de media");
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

  /** Mesh: publicador responde offers de viewers */
  function meshPublisherAttach(stream, ws) {
    var pcs = new Map();

    function getOrCreate(from) {
      var entry = pcs.get(from);
      if (entry) return entry;
      var pc = createPC();
      var pending = [];
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
      entry = { pc: pc, pending: pending, remoteSet: false };
      pcs.set(from, entry);
      return entry;
    }

    async function handleSignal(from, data) {
      var entry = getOrCreate(from);
      var pc = entry.pc;
      try {
        if (data.offer) {
          await pc.setRemoteDescription(new RTCSessionDescription(data.offer));
          entry.remoteSet = true;
          while (entry.pending.length) {
            try {
              await pc.addIceCandidate(entry.pending.shift());
            } catch (_) {}
          }
          var answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          if (ws.readyState === 1) {
            ws.send(
              JSON.stringify({
                type: "signal",
                to: from,
                data: { answer: answer },
              })
            );
          }
        } else if (data.candidate) {
          if (!entry.remoteSet) entry.pending.push(data.candidate);
          else {
            try {
              await pc.addIceCandidate(data.candidate);
            } catch (_) {}
          }
        }
      } catch (e) {
        console.warn("mesh pub signal", e);
      }
    }

    return {
      handleSignal: handleSignal,
      close: function () {
        pcs.forEach(function (e) {
          try {
            e.pc.close();
          } catch (_) {}
        });
        pcs.clear();
      },
    };
  }

  /** Mesh: viewer pide stream al publicador */
  async function meshPull(ws, producerId, onStream) {
    var pc = createPC();
    var remoteStream = new MediaStream();
    var pending = [];
    var remoteSet = false;

    pc.ontrack = function (e) {
      if (e.track) remoteStream.addTrack(e.track);
      if (e.streams && e.streams[0]) {
        e.streams[0].getTracks().forEach(function (t) {
          if (remoteStream.getTracks().indexOf(t) < 0) remoteStream.addTrack(t);
        });
      }
      if (typeof onStream === "function") onStream(remoteStream);
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
    if (ws.readyState === 1) {
      ws.send(
        JSON.stringify({
          type: "signal",
          to: producerId,
          data: { offer: offer },
        })
      );
    }

    return {
      pc: pc,
      stream: remoteStream,
      mode: "mesh",
      handleSignal: async function (data) {
        try {
          if (data.answer) {
            await pc.setRemoteDescription(new RTCSessionDescription(data.answer));
            remoteSet = true;
            while (pending.length) {
              try {
                await pc.addIceCandidate(pending.shift());
              } catch (_) {}
            }
          } else if (data.candidate) {
            if (!remoteSet) pending.push(data.candidate);
            else {
              try {
                await pc.addIceCandidate(data.candidate);
              } catch (_) {}
            }
          }
        } catch (e) {
          console.warn("mesh pull signal", e);
        }
      },
      close: function () {
        try {
          pc.close();
        } catch (_) {}
      },
    };
  }

  function attachVideo(el, stream) {
    if (!el || !stream) return;
    el.srcObject = stream;
    el.muted = true;
    el.playsInline = true;
    var p = el.play();
    if (p && p.catch) p.catch(function () {});
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
    attachVideo: attachVideo,
    waitTracks: waitTracks,
    diag: diag,
  };
})(window);
/* ash-mesh-turn-2026-09-21 */
