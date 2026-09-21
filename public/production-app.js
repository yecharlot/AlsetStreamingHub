/**
 * Mesa de producción multi-deporte (béisbol primero) — UI con Alset-JS-Runtime.
 * Medios: hub.js (SFU + mesh). Vistas: nodos con identidad + pulsos al VideoNode.
 */
import {
  AlsetInspector,
  AlsetRegistry,
  Column,
  Row,
  Text,
  Card,
  Button,
  mod,
  alsetState,
  Theme,
  VideoNode,
  Spacer,
} from "./vendor/alset-runtime.js";

Theme.set({ primary: "#f4b400", secondary: "#1a1528", background: "#07070c" });

// Cargar cliente de medios (no-module) una vez
await new Promise((resolve, reject) => {
  if (window.AlsetHub) return resolve();
  const s = document.createElement("script");
  s.src = "/hub.js";
  s.onload = resolve;
  s.onerror = reject;
  document.head.appendChild(s);
});

const H = window.AlsetHub;
const params = new URLSearchParams(location.search);
const matchId = params.get("match") || "partido-demo";
const ticket = params.get("ticket") || "";
const myId = "dir-" + Math.random().toString(36).slice(2, 8);

const SPORT_PRESETS = {
  beisbol: {
    label: "Béisbol",
    angles: ["Home plate", "Montículo", "Left field", "Right field", "Dugout", "General"],
  },
  futbol: {
    label: "Fútbol",
    angles: ["Tribuna", "Portería", "Lateral", "Aéreo", "Banca", "General"],
  },
  baloncesto: {
    label: "Baloncesto",
    angles: ["Centro", "Tablero", "Banda", "Aéreo", "Banca", "General"],
  },
  otro: {
    label: "Otro deporte",
    angles: ["Ángulo 1", "Ángulo 2", "Ángulo 3", "General"],
  },
};

const sport = alsetState(params.get("sport") || "beisbol");
const status = alsetState("Conectando sala…");
const producers = alsetState([]);
const activeId = alsetState(null);
const zoom = alsetState(1);
const rotX = alsetState(0);
const rotY = alsetState(0);
const logLine = alsetState("Alset Live · multi-deporte · SFU+mesh · vistas Runtime");

let ws = null;
let programSession = null;
const previewSessions = {};
const MAX_PREVIEWS = 6;

function pulseProgram(p) {
  const el = AlsetRegistry.get("program-eye");
  if (el && el.__alsetPulse) el.__alsetPulse(p);
}

function pulsePreview(id, p) {
  const el = AlsetRegistry.get("preview-" + id);
  if (el && el.__alsetPulse) el.__alsetPulse(p);
}

function applyTransform() {
  pulseProgram({
    action: "TRANSFORM",
    zoom: zoom.get(),
    rotX: rotX.get(),
    rotY: rotY.get(),
  });
}

function bestProducer(list) {
  return [...list]
    .filter((p) => p.online)
    .sort((a, b) => (b.quality || 0) - (a.quality || 0))[0];
}

async function attachStreamToProgram(stream) {
  pulseProgram({ action: "STREAM_MEDIA", stream });
  pulseProgram({ action: "MUTE", value: true });
  applyTransform();
}

async function selectProgram(id) {
  if (!id) return;
  activeId.set(id);
  status.set("Cargando ángulo…");

  if (programSession && programSession.close) {
    try {
      programSession.close();
    } catch (_) {}
    programSession = null;
  }

  const list = producers.get();
  const p = list.find((x) => x.id === id);

  // Reutilizar preview si ya tiene MediaStream (ligero)
  const prevEl = AlsetRegistry.get("preview-" + id);
  const v = prevEl && prevEl.__alsetVideo;
  if (v && v.srcObject) {
    await attachStreamToProgram(v.srcObject);
    status.set("Al aire (preview)");
    programSession = { close() {}, handleSignal: null };
    return;
  }

  if (p && p.sfuSessionId && p.tracks && p.tracks.length) {
    try {
      programSession = await H.sfuPull(p.sfuSessionId, p.tracks);
      await attachStreamToProgram(programSession.stream);
      status.set("Al aire (SFU)");
      return;
    } catch (e) {
      logLine.set("SFU: " + (e.message || e));
    }
  }

  try {
    programSession = await H.meshPull(ws, id, async (stream) => {
      await attachStreamToProgram(stream);
      status.set("Al aire (mesh)");
    });
  } catch (e) {
    status.set("Sin video");
    logLine.set(String(e.message || e));
  }
}

async function ensurePreview(p) {
  if (previewSessions[p.id]) return;
  let closed = false;
  const handle = {
    close() {
      closed = true;
    },
  };
  previewSessions[p.id] = handle;

  try {
    if (p.sfuSessionId && p.tracks && p.tracks.length) {
      const pull = await H.sfuPull(p.sfuSessionId, p.tracks);
      if (closed) {
        pull.pc.close();
        return;
      }
      pulsePreview(p.id, { action: "STREAM_MEDIA", stream: pull.stream });
      handle.close = () => {
        closed = true;
        try {
          pull.pc.close();
        } catch (_) {}
      };
      return;
    }
    if (!ws || ws.readyState !== 1) return;
    const mesh = await H.meshPull(ws, p.id, (stream) => {
      pulsePreview(p.id, { action: "STREAM_MEDIA", stream });
    });
    handle.mesh = mesh;
    handle.close = () => {
      closed = true;
      try {
        mesh.close();
      } catch (_) {}
    };
  } catch (e) {
    console.warn("preview", p.id, e);
    delete previewSessions[p.id];
  }
}

function syncPreviews(list) {
  const online = list.filter((p) => p.online).slice(0, MAX_PREVIEWS);
  online.forEach((p) => ensurePreview(p));
  Object.keys(previewSessions).forEach((id) => {
    if (!online.find((p) => p.id === id)) {
      try {
        previewSessions[id].close();
      } catch (_) {}
      delete previewSessions[id];
    }
  });
}

function captureFrame() {
  const el = AlsetRegistry.get("program-eye");
  const video = el && el.__alsetVideo;
  if (!video || !video.videoWidth) {
    logLine.set("Captura: sin frame");
    return;
  }
  const c = document.createElement("canvas");
  c.width = video.videoWidth;
  c.height = video.videoHeight;
  c.getContext("2d").drawImage(video, 0, 0);
  const url = c.toDataURL("image/jpeg", 0.92);
  const a = document.createElement("a");
  a.href = url;
  a.download = "alset-live-" + Date.now() + ".jpg";
  a.click();
  logLine.set("Captura " + c.width + "×" + c.height);
}

// WebSocket sala
ws = new WebSocket(
  H.wsUrl(matchId, { role: "director", id: myId, ticket })
);
ws.onopen = () => status.set("Sala lista · " + matchId);
ws.onerror = () => status.set("Error de red");
ws.onmessage = (ev) => {
  const msg = JSON.parse(ev.data);
  if (msg.type === "room_state" || msg.type === "presence") {
    const list = msg.producers || [];
    producers.set(list);
    syncPreviews(list);
    if (!activeId.get()) {
      const b = bestProducer(list);
      if (b) selectProgram(b.id);
    }
  }
  if (msg.type === "producer_join") {
    const list = producers
      .get()
      .filter((p) => p.id !== msg.producer.id)
      .concat([msg.producer]);
    producers.set(list);
    syncPreviews(list);
  }
  if (msg.type === "producer_leave") {
    const list = producers
      .get()
      .map((p) => (p.id === msg.id ? { ...p, online: false } : p));
    producers.set(list);
    syncPreviews(list);
  }
  if (msg.type === "quality" && msg.producer) {
    const list = producers
      .get()
      .map((p) => (p.id === msg.id ? { ...p, ...msg.producer } : p));
    producers.set(list);
  }
  if (msg.type === "signal" && msg.from === activeId.get() && programSession?.handleSignal) {
    programSession.handleSignal(msg.data);
  }
  if (msg.type === "signal" && previewSessions[msg.from]?.mesh) {
    previewSessions[msg.from].mesh.handleSignal(msg.data);
  }
};

// ——— UI Alset ———
AlsetInspector(() => {
  const sp = SPORT_PRESETS[sport.get()] || SPORT_PRESETS.otro;
  const list = producers.get().filter((p) => p.online);
  const best = bestProducer(list);

  Column(
    mod()
      .fillMaxSize()
      .background(Theme.current.background)
      .padding(16)
      .gap(12),
    () => {
      Row(mod().gap(12).align("center", "space-between"), () => {
        Column(mod().gap(4), () => {
          Text("ALSET LIVE", mod().sizeText(12).color("#666").weight("700"));
          Text("Producción · " + sp.label, mod().sizeText(22).weight("800").color(Theme.current.primary));
          Text(status.get(), mod().sizeText(13).color("#8b8b9a").key("st"));
        });
        Row(mod().gap(8), () => {
          Button("Inicio", () => {
            location.href = "/";
          }, mod().padding("8px 14px").radius(20).background("#12121c"));
        });
      });

      Row(mod().gap(8).key("sport-row"), () => {
        for (const key of Object.keys(SPORT_PRESETS)) {
          const on = sport.get() === key;
          Button(
            SPORT_PRESETS[key].label,
            () => sport.set(key),
            mod()
              .padding("8px 12px")
              .radius(16)
              .background(on ? "rgba(244,180,0,.2)" : "#12121c")
              .key("sport-" + key)
          );
        }
      });

      Text(
        "Ángulos sugeridos: " + sp.angles.join(" · "),
        mod().sizeText(12).color("#666")
      );

      // Programa (VideoNode con key estable)
      Card(
        mod()
          .key("program-card")
          .padding(8)
          .radius(16)
          .background("#0c0c14")
          .addStyle("border", "1px solid rgba(244,180,0,.25)"),
        () => {
          Column(mod().gap(8), () => {
            VideoNode(
              mod()
                .key("program-eye")
                .width("100%")
                .addStyle("aspectRatio", "16/9")
                .radius(12)
                .overflow("hidden")
            );
            Row(mod().gap(8).align("center", "flex-start"), () => {
              Button("Mejor señal", () => {
                const b = bestProducer(producers.get());
                if (b) selectProgram(b.id);
              }, mod().padding("8px 12px").radius(16));
              Button("Al aire", () => {
                if (ws?.readyState === 1 && activeId.get()) {
                  ws.send(JSON.stringify({ type: "program", producerId: activeId.get() }));
                  status.set("Programa enviado · " + activeId.get());
                }
              }, mod().padding("8px 12px").radius(16).background("rgba(244,180,0,.15)"));
              Button("− Zoom", () => {
                zoom.set(Math.max(1, +(zoom.get() - 0.15).toFixed(2)));
                applyTransform();
              }, mod().padding("8px 12px").radius(16));
              Button("+ Zoom", () => {
                zoom.set(Math.min(3, +(zoom.get() + 0.15).toFixed(2)));
                applyTransform();
              }, mod().padding("8px 12px").radius(16));
              Button("3D ⟲", () => {
                rotY.set(Math.max(-35, rotY.get() - 6));
                applyTransform();
              }, mod().padding("8px 12px").radius(16));
              Button("3D ⟳", () => {
                rotY.set(Math.min(35, rotY.get() + 6));
                applyTransform();
              }, mod().padding("8px 12px").radius(16));
              Button("Reset", () => {
                zoom.set(1);
                rotX.set(0);
                rotY.set(0);
                applyTransform();
              }, mod().padding("8px 12px").radius(16));
              Button("Captura", () => captureFrame(), mod().padding("8px 12px").radius(16));
            });
          });
        }
      );

      Text("Previews en vivo · toca para programa", mod().sizeText(13).color("#8b8b9a"));

      Row(mod().gap(10).key("previews-" + list.map((p) => p.id).join(",")), () => {
        if (!list.length) {
          Text("Ningún móvil transmitiendo. Abre Transmitir con el mismo evento.", mod().sizeText(13).color("#666"));
          return;
        }
        list.slice(0, MAX_PREVIEWS).forEach((p) => {
          const isActive = activeId.get() === p.id;
          const isBest = best && best.id === p.id;
          Card(
            mod()
              .key("card-" + p.id)
              .width(160)
              .padding(6)
              .radius(12)
              .background("#0c0c14")
              .addStyle(
                "border",
                isActive
                  ? "1px solid #f4b400"
                  : isBest
                    ? "1px solid rgba(76,175,80,.6)"
                    : "1px solid rgba(244,180,0,.2)"
              )
              .clickable(() => selectProgram(p.id)),
            () => {
              VideoNode(
                mod()
                  .key("preview-" + p.id)
                  .width("100%")
                  .addStyle("aspectRatio", "16/9")
                  .radius(8)
                  .overflow("hidden")
              );
              Text(p.label || p.id, mod().sizeText(12).weight("700").color("#eee"));
              Text(
                Math.round((p.quality || 0) * 100) + "% · " + (p.sfuSessionId ? "SFU" : "mesh"),
                mod()
                  .sizeText(11)
                  .color((p.quality || 0) >= 0.7 ? "#4caf50" : (p.quality || 0) >= 0.4 ? "#ff9800" : "#ff5252")
              );
            }
          );
        });
      });

      Spacer(4);
      Text(logLine.get(), mod().sizeText(11).color("#555").key("log"));
      Text(
        "Evento " + matchId + " · híbrido SFU+mesh · Runtime Alset (identidad de nodos)",
        mod().sizeText(11).color("#444")
      );
    }
  );
});
