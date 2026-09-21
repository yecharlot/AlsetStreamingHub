/**
 * ALSET PULSE CORE v6.0 - CHRONOS
 * ------------------------------------
 * Arquitectura de supervivencia digital, alta fidelidad y 
 * adaptabilidad biotecnológica.
 */

/* =========================
   1. REGISTRO DE RESONANCIA & SHADOW COMPUTING (Cap. #7, #12)
   ========================= 
   Este registro permite la "Persistencia de Identidad". El Core no 
   recrea el DOM, sino que lo "resuena" o actualiza, manteniendo el foco 
   y estados internos (como el cursor en un input o el scroll).
*/
export const AlsetRegistry = new Map();
let currentContext = null; 
let currentTracker = null; 
const nodeDeps = new WeakMap(); 
const scheduled = new Set(); 
let flushScheduled = false;

/* =========================
   2. SCHEDULER DETERMINISTA (Cap. #4, #6)
   ========================= 
   Elimina el parpadeo visual (jitter) mediante el agrupamiento de pulsos 
   en micro-tareas. Garantiza que el Quórum de Consenso de la UI sea estable.
*/
function scheduleRecompose(fn) {
  scheduled.add(fn);
  if (flushScheduled) return;
  flushScheduled = true;
  queueMicrotask(() => {
    flushScheduled = false;
    const batch = Array.from(scheduled);
    scheduled.clear();
    for (const f of batch) { try { f(); } catch (e) { console.error("Pulse Error:", e); } }
  });
}

/* =========================
   3. ESTADO REACTIVO DE GRADO NANOTÉCNICO (Cap. #5)
   ========================= 
   Reactividad granular. Permite la "Fidelidad Progresiva": solo los 
   átomos de la interfaz que reciben un pulso cambian su estado.
*/
export function alsetState(initialValue) {
  const state = {
    value: initialValue,
    subscribers: new Set(),
    get() {
      if (currentTracker) {
        this.subscribers.add(currentTracker);
        let deps = nodeDeps.get(currentTracker);
        if (!deps) { deps = new Set(); nodeDeps.set(currentTracker, deps); }
        deps.add(state);
      }
      return this.value;
    },
    set(newValue) {
      if (Object.is(this.value, newValue)) return;
      this.value = newValue;
      this.subscribers.forEach((fn) => scheduleRecompose(fn));
    }
  };
  return state;
}

/* =========================
   4. SISTEMA DE TEMAS & ENERGY-AWARE (Cap. #13)
   ========================= 
   Controla la termodinámica visual. En modos de ahorro, reduce contrastes 
   y efectos pesados para prolongar la vida operativa del hardware.
*/
export const Theme = {
  current: {
    primary: "#FFD700", secondary: "#8B0000", background: "#050505",
    surface: "rgba(255,255,255,0.05)", radius: 24
  },
  _version: alsetState(0),
  set(newTheme) { Object.assign(this.current, newTheme); this._version.set(this._version.get() + 1); }
};

/* =========================
   5. MODIFICADOR ALSET (Nitidez Superior)
   ========================= 
   Inyecta optimización de sub-píxeles y suavizado por hardware. 
   La interfaz se siente nítida en pantallas de alta densidad (Retina/OLED).
*/
export class Modifier {
  constructor() {
    this._styles = { 
        webkitFontSmoothing: "antialiased", 
        mozOsxFontSmoothing: "grayscale", 
        textRendering: "optimizeLegibility" 
    };
    this._responsive = { sm: {}, md: {}, lg: {}, xl: {} };
    this._onclick = null; this._events = {}; this._key = null;
  }
  key(k) { this._key = k; return this; }
  sm(cb) { const m = new Modifier(); cb(m); Object.assign(this._responsive.sm, m._styles); return this; }
  md(cb) { const m = new Modifier(); cb(m); Object.assign(this._responsive.md, m._styles); return this; }
  lg(cb) { const m = new Modifier(); cb(m); Object.assign(this._responsive.lg, m._styles); return this; }
  xl(cb) { const m = new Modifier(); cb(m); Object.assign(this._responsive.xl, m._styles); return this; }

  width(v){ this._styles.width = typeof v === "number" ? `${v}px` : v; return this; }
  height(v){ this._styles.height = typeof v === "number" ? `${v}px` : v; return this; }
  size(w,h){ return this.width(w).height(h); }
  fillMaxSize(){ return this.width("100%").height("100%"); }
  padding(v){ this._styles.padding = typeof v === "number" ? `${v}px` : v; return this; }
  margin(v){ this._styles.margin = typeof v === "number" ? `${v}px` : v; return this; }
  background(c){ this._styles.backgroundColor = c; return this; }
  color(c){ this._styles.color = c; return this; }
  radius(r){ this._styles.borderRadius = typeof r === "number" ? `${r}px` : r; return this; }
  gap(v){ this._styles.gap = typeof v === "number" ? `${v}px` : v; return this; }
  wrap(v) {this._styles.flexWrap = v;return this;}
  position(p){ this._styles.position = p; return this; }
  bottom(v){ this._styles.bottom = typeof v === "number" ? `${v}px` : v; return this; }
  top(v){ this._styles.top = typeof v === "number" ? `${v}px` : v; return this; }
  left(v){ this._styles.left = typeof v === "number" ? `${v}px` : v; return this; }
  right(v){ this._styles.right = typeof v === "number" ? `${v}px` : v; return this; }
  zIndex(z){ this._styles.zIndex = z; return this; }
  opacity(v){ this._styles.opacity = v; return this; }
  weight(w){ this._styles.fontWeight = w; return this; }
  sizeText(s){ this._styles.fontSize = typeof s === "number" ? `${s}px` : s; return this; }
  overflow(v){ this._styles.overflow = v; return this; }
  border(v){ this._styles.border = v; return this; }
  addStyle(k,v){ this._styles[k] = v; return this; }
  align(a, j) { this._styles.display = "flex"; this._styles.alignItems = a; this._styles.justifyContent = j; return this; }
  alignSelf(v) { this._styles.alignSelf = v; return this; }

  flex(value) {
  this._styles.flex = value;
  return this;
}

// También puedes agregar estos métodos relacionados para control completo de Flexbox:

flexGrow(value) {
  this._styles.flexGrow = value;
  return this;
}

flexShrink(value) {
  this._styles.flexShrink = value;
  return this;
}

flexBasis(value) {
  this._styles.flexBasis = typeof value === "number" ? `${value}px` : value;
  return this;
}

// Método para controlar el orden
order(value) {
  this._styles.order = value;
  return this;
}

  clickable(cb) {
    this._onclick = cb;
    this._styles.cursor = "pointer";
    this._styles.userSelect = "none";
    this._styles.webkitTapHighlightColor = "transparent"; // Soporte Touch Nativo
    return this;
  }
  on(ev, fn) { this._events[ev] = fn; return this; }
  glass() {
    this._styles.backdropFilter = "blur(24px) saturate(200%)";
    this._styles.backgroundColor = "rgba(10, 10, 10, 0.4)";
    this._styles.border = "1px solid rgba(255, 255, 255, 0.08)";
    this._styles.boxShadow = "0 8px 32px 0 rgba(0, 0, 0, 0.8)";
    return this;
  }
  applyTheme(type = "surface") {
    Theme._version.get();
    const t = Theme.current;
    this.background(t[type] || t.surface);
    this.radius(t.radius);
    if (type === "surface") this.glass();
    return this;
  }
}
export const mod = () => new Modifier();

/* =========================
   6. MOTOR ALSET CORE (FDIR & ADN Mutante #3, #8)
   ========================= 
   Soporta la reparación automática y la inyección de código vivo. 
   Si un componente falla, el pulso de recuperación (FDIR) lo restaura.
*/
function applyStyles(el, stylesObj) {
  const prev = el.__alsetPrevStyles || {};
  for (const k in prev) if (!(k in stylesObj)) el.style[k] = "";
  for (const k in stylesObj) el.style[k] = stylesObj[k];
  el.__alsetPrevStyles = stylesObj;
}

export const Alset = {
  createNode(tag, modifier, childrenBlock) {
    const key = modifier?._key;
    let el = (key && AlsetRegistry.has(key)) ? AlsetRegistry.get(key) : document.createElement(tag);
    if (key && !AlsetRegistry.has(key)) AlsetRegistry.set(key, el);

    el.__alsetDir = "column";
    el.__alsetRender = childrenBlock || null;

    el.__alsetPulse = (pulse) => {
        // Capacidad #8: Re-programación en tiempo real.
        if (pulse?.action === "MUTATE_LOGIC") { 
            el.__alsetRender = new Function('data', pulse.code); 
            return el.recomposeAction(); 
        }
        if (el.__alsetState) el.__alsetState.set(pulse.data || pulse);
        else el.recomposeAction(pulse);
    };

    el.recomposeAction = (pulseData = null) => {
      // Recolección de Basura de Dependencias (Biotecnología #18)
      const deps = nodeDeps.get(el.recomposeAction);
      if (deps) { deps.forEach(st => st.subscribers.delete(el.recomposeAction)); deps.clear(); }

      const bp = (window.innerWidth <= 480) ? "sm" : (window.innerWidth <= 768) ? "md" : (window.innerWidth <= 1024) ? "lg" : "xl";
      const next = Object.assign({}, modifier?._styles || {});
      if (modifier?._responsive?.[bp]) Object.assign(next, modifier._responsive[bp]);

      if (tag !== "span") {
        next.display = "flex";
        next.flexDirection = next.flexDirection || el.__alsetDir;
        next.boxSizing = "border-box";
      }

      applyStyles(el, next);
      
      if (modifier?._onclick && !el.__alsetBoundClick) {
          el.addEventListener("click", (e) => { e.preventDefault(); modifier._onclick(e); });
          el.__alsetBoundClick = true;
      }
      
      for (const ev in modifier?._events) {
      const eventKey = `__alset_event_${ev}`;
      if (!el[eventKey]) {
          el.addEventListener(ev, (e) => {
              // Pasamos el evento original a la función definida en el Modifier
              modifier._events[ev](e); 
          });
          el[eventKey] = true;
      }
    }

      const prevCtx = currentContext;
      const prevTracker = currentTracker;
      currentContext = el;
      currentTracker = el.recomposeAction;
      try { 
          if (el.__alsetRender) {
              if (!pulseData?.append) while (el.firstChild) el.removeChild(el.firstChild);
              el.__alsetRender(pulseData);
          }
      } finally { currentContext = prevCtx; currentTracker = prevTracker; }
    };

    if (!el.parentNode && currentContext) currentContext.appendChild(el);
    if (!key || !el.innerHTML) el.recomposeAction();
    return el;
  }
};

/* =========================
   7. PRIMITIVAS DE ALTA FIDELIDAD
   ========================= 
*/
export const List = (m, content) => Column(m.overflow("auto"), content);
export const Column = (m, content) => Alset.createNode('div', m, content);
export const Row = (m, content) => {
    const el = Alset.createNode('div', m, content);
    el.style.flexDirection = 'row';
    return el;
};
export const Text = (txt, m) => { const t = Alset.createNode("span", m, null); t.innerText = txt || ""; t.style.fontFamily = "'Inter', sans-serif"; return t; };
export const Spacer = (s) => Alset.createNode("div", mod().size(s, s), null);
export const Card = (m = mod(), content) => Column(m.applyTheme("surface").padding(20).position("relative"), content);
export const Layer = (m, content) => Alset.createNode("div", (m || mod()).position("relative").addStyle("display", "grid"), content);
export const Image = (src, m) => {
  const container = Alset.createNode("div", (m || mod()).overflow("hidden"), null);
  const img = document.createElement("img");
  img.src = src;
  img.style.width = "100%";
  img.style.height = "100%";
  img.style.objectFit = "cover";
  container.appendChild(img);
  return container;
};

export const Button = (text, onClick, m = mod()) => {
  return Column(
    m.background(Theme.current.primary)
      .radius(12)
      .padding("12px 24px")
      .clickable(onClick)
      .align("center", "center"),
    () => Text(text, mod().color("#000").weight("700"))
  );
};

export const Toast = () => {
  const visible = alsetState(false);
  const message = alsetState("");

  function show(msg, duration = 2000) {
    message.set(msg);
    visible.set(true);
    setTimeout(() => visible.set(false), duration);
  }

  function ToastView() {
    if (!visible.get()) return;
    Layer(
      mod().position("fixed").bottom(20).left("50%").addStyle("transform", "translateX(-50%)").zIndex(1000),
      () => Card(mod().padding("10px 16px"), () => Text(message.get()))
    );
  }

  return { show, ToastView };
};


/**
 * GradientLayer: Capa inteligente para fondos y superposiciones
 * @param {Object} options - { type: 'linear'|'radial', direction: 'to bottom'|'45deg', colors: [], image: 'url' }
 */
export const GradientLayer = (options = {}, childrenBlock = null, m = mod()) => {
  const { 
    type = 'linear', 
    direction = 'to bottom', 
    colors = ['transparent', '#000'], 
    image = null,
    opacity = 1
  } = options;

  // Construcción de la cadena del gradiente
  const colorStr = colors.join(', ');
  const gradient = type === 'linear' 
    ? `linear-gradient(${direction}, ${colorStr})` 
    : `radial-gradient(circle, ${colorStr})`;

  // Si hay imagen, la ponemos de fondo y el gradiente encima usando múltiples backgrounds
  const finalBackground = image 
    ? `${gradient}, url(${image})` 
    : gradient;

  return Column(m
    .fillMaxSize()
    .position("absolute")
    .addStyle("backgroundImage", finalBackground)
    .addStyle("backgroundSize", "cover")
    .addStyle("backgroundPosition", "center")
    .addStyle("opacity", opacity)
    .addStyle("pointerEvents", "none"), // Para que no bloquee clics a capas inferiores
    childrenBlock
  );
};

// Estados persistentes fuera de la función para que no mueran al recomponer
const floatX = alsetState(window.innerWidth - 100);
const floatY = alsetState(window.innerHeight - 100);

export const FloatingButton = (text, onClick, m = mod()) => {
  
  const startDrag = (e) => {
    e.preventDefault();
    const move = (me) => {
      const ev = me.touches ? me.touches[0] : me;
      floatX.set(ev.clientX - 30);
      floatY.set(ev.clientY - 30);
    };
    const stop = () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("touchmove", move);
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("touchmove", move, { passive: false });
    window.addEventListener("mouseup", stop, { once: true });
    window.addEventListener("touchend", stop, { once: true });
  };

  // Usamos una capa fija que siempre esté visible
  return Column(m.key("alset-float-layer").position("fixed").zIndex(99999).top(0).left(0), () => {
    // Suscripción reactiva a los estados externos
    const px = floatX.get();
    const py = floatY.get();

    return Column(mod()
      .position("absolute")
      .addStyle("left", `${px}px`)
      .addStyle("top", `${py}px`)
      .size(60, 60)
      .background(Theme.current.primary)
      .radius("50%")
      .align("center", "center")
      .addStyle("boxShadow", "0 10px 30px rgba(0,0,0,0.5)")
      .addStyle("cursor", "move")
      .on("mousedown", startDrag)
      .on("touchstart", startDrag), 
      () => Text(text, mod().color("#000").weight("900").addStyle("pointerEvents", "none"))
    ).onclick = onClick; // Asignación directa para asegurar el disparo
  });
};


export const ALSET_ICONS = {
  // --- SISTEMA Y CORE ---
  cpu: "M4 4h16v16H4zM9 9h6v6H9zM15 2v2M9 2v2M15 20v2M9 20v2M20 15h2M20 9h2M2 15h2M2 9h2",
  pulse: "M22 12h-4l-3 9L9 3l-3 9H2",
  power: "M18.36 6.64a9 9 0 11-12.73 0M12 2v10",
  terminal: "M4 17l6-6-6-6M12 19h8",
  gear: "M12 15a3 3 0 100-6 3 3 0 000 6z M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-2 2 2 2 0 01-2-2v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83 0 2 2 0 010-2.83l.06-.06a1.65 1.65 0 00.33-1.82 1.65 1.65 0 00-1.51-1V11a2 2 0 01-2-2 2 2 0 012-2v-.09A1.65 1.65 0 004.6 9a1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 0 2 2 0 010 2.83l-.06.06a1.65 1.65 0 00-.33 1.82 1.65 1.65 0 001.51 1H11a2 2 0 012 2 2 2 0 012 2v.09a1.65 1.65 0 001 1.51z",
  refresh: "M23 4v6h-6M1 20v-6h6M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15",
  database: "M3 5c0 1.66 4 3 9 3s9-1.34 9-3-4-3-9-3-9 1.34-9 3M3 12c0 1.66 4 3 9 3s9-1.34 9-3M3 19c0 1.66 4 3 9 3s9-1.34 9-3M3 5v14M21 5v14",

  // --- CONECTIVIDAD Y RED ---
  wifi: "M5 12.55a11 11 0 0114.08 0M1.42 9a16 16 0 0121.16 0M8.53 16.11a6 6 0 016.95 0M12 20h.01",
  noWifi: "M1 1l22 22M16.72 11.06A10.94 10.94 0 0119 12.55M5 12.55a10.94 10.94 0 015.17-2.39M1.42 9a16 16 0 0119.9 0M8.53 16.11a6 6 0 016.95 0",
  cloud: "M18 10h-1.26A8 8 0 109 20h9a5 5 0 000-10z",
  upload: "M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M17 8l-5-5-5 5M12 3v12",
  download: "M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3",
  bluetooth: "M6.5 6.5l11 11L12 23V1l5.5 5.5-11 11",
  server: "M2 20h20M2 14h20M2 8h20M6 4h.01M6 10h.01M6 16h.01",

  // --- SEGURIDAD Y PROTECCIÓN ---
  lock: "M19 11H5a2 2 0 00-2 2v7a2 2 0 002 2h14a2 2 0 002-2v-7a2 2 0 00-2-2z M7 11V7a5 5 0 0110 0v4",
  unlock: "M19 11H5a2 2 0 00-2 2v7a2 2 0 002 2h14a2 2 0 002-2v-7a2 2 0 00-2-2z M7 11V7a5 5 0 019.9-1",
  shield: "M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z",
  fingerprint: "M12 1a11 11 0 00-8 3.5M2 12a10 10 0 0110-10M7 21a10 10 0 015-19M12 12a5 5 0 015 5",
  eye: "M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z M12 15a3 3 0 100-6 3 3 0 000 6z",
  eyeOff: "M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19M1 1l22 22",
  key: "M21 2l-2 2m-7.61 7.61a5.5 5.5 0 11-7.778 7.778 5.5 5.5 0 017.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3y-3.5 3.5",

  // --- NAVEGACIÓN Y ACCIÓN ---
  search: "M11 19a8 8 0 100-16 8 8 0 000 16zM21 21l-4.35-4.35",
  home: "M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2zM9 22V12h6v10",
  user: "M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2M12 7a4 4 0 100-8 4 4 0 000 8z",
  settings: "M12 12m-3 0a3 3 0 1 0 6 0a3 3 0 1 0 -6 0 M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1 -2.83 0l-.06-.06a1.65 1.65 0 0 0 -1.82-.33 1.65 1.65 0 0 0 -1 1.51V21a2 2 0 0 1 -2 2 2 2 0 0 1 -2 -2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0 -1.82.33l-.06.06a2 2 0 0 1 -2.83 0a2 2 0 0 1 0 -2.83l.06-.06a1.65 1.65 0 0 0 .33 -1.82 1.65 1.65 0 0 0 -1.51 -1H3a2 2 0 0 1 -2 -2 2 2 0 0 1 2 -2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0 1.82 -.33l.06-.06a2 2 0 0 1 2.83 0a2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0 -.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1 -2 2h-.09a1.65 1.65 0 0 0 -1 1.51z",
  trash: "M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2",
  menu: "M3 12h18M3 6h18M3 18h18",
  more: "M12 12m-1 0a1 1 0 1 0 2 0a1 1 0 1 0 -2 0 M19 12m-1 0a1 1 0 1 0 2 0a1 1 0 1 0 -2 0 M5 12m-1 0a1 1 0 1 0 2 0a1 1 0 1 0 -2 0",
  alert: "M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0zM12 9v4M12 17h.01",
  check: "M20 6L9 17l-5-5",
  x: "M18 6L6 18M6 6l12 12",
  plus: "M12 5v14M5 12h14",
  minus: "M5 12h14",

  // --- MULTIMEDIA ---
  play: "M5 3l14 9-14 9V3z",
  pause: "M6 4h4v16H6zM14 4h4v16h-4z",
  stop: "M4 4h16v16H4z",
  mic: "M12 1a3 3 0 00-3 3v8a3 3 0 006 0V4a3 3 0 00-3-3z M19 10v1a7 7 0 01-14 0v-1M12 18v4M8 22h8",
  camera: "M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z M12 17a4 4 0 100-8 4 4 0 000 8z",
  video: "M23 7l-7 5 7 5V7z M1 5h11a2 2 0 012 2v10a2 2 0 01-2 2H1a2 2 0 01-2-2V7a2 2 0 012-2z",
  volume: "M11 5L6 9H2v6h4l5 4V5zM15.54 8.46a5 5 0 010 7.07",
  layers: "M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5",

  // --- COMUNICACIÓN Y DOCUMENTOS ---
  mail: "M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z M22 6l-10 7L2 6",
  message: "M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z",
  phone: "M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07 19.5 19.5 0 01-6-6 19.79 19.79 0 01-3.07-8.67A2 2 0 014.11 2h3a2 2 0 012 1.72 12.84 12.84 0 00.7 2.81 2 2 0 01-.45 2.11L8.09 9.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45 12.84 12.84 0 002.81.7A2 2 0 0122 16.92z",
  edit: "M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7M18.5 2.5a2.121 2.121 0 113 3L12 15l-4 1 1-4 9.5-9.5z",
  file: "M13 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V9zM13 2l7 7m-7-7v7h7",
  copy: "M9 15H5a2 2 0 01-2-2V5a2 2 0 012-2h8a2 2 0 012 2v4M19 9h-8a2 2 0 00-2 2v8a2 2 0 002 2h8a2 2 0 002-2v-8a2 2 0 00-2-2z",
  external: "M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6M15 3h6v6M10 14L21 3",

  // --- HARDWARE Y SENSORES ---
  battery: "M6 7H4a2 2 0 00-2 2v6a2 2 0 002 2h2 M6 5v14M10 5v14M14 5v14M18 5v14M22 9v6",
  compass: "M12 22a10 10 0 100-20 10 10 0 000 20z M16.24 7.76l-2.12 6.36-6.36 2.12 2.12-6.36 6.36-2.12z",
  thermometer: "M14 14.76V3.5a2.5 2.5 0 00-5 0v11.26a4.5 4.5 0 105 0z",
  watch: "M12 22a5 5 0 100-10 5 5 0 000 10zM12 6V2M12 22v-4M7 2h10l-1 4H8zM7 22h10l-1-4H8z",
  hardDrive: "M21 18a2 2 0 01-2 2H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v12zM7 12h.01M11 12h.01",

  // --- FLECHAS DE FLUJO ---
  up: "M18 15l-6-6-6 6",
  down: "M6 9l6 6 6-6",
  left: "M15 18l-6-6 6-6",
  right: "M9 18l6-6-6-6",
  chevronDoubleRight: "M13 17l5-5-5-5M6 17l5-5-5-5",
  maximize: "M8 3H5a2 2 0 00-2 2v3M21 8V5a2 2 0 00-2-2h-3M3 16v3a2 2 0 002 2h3M16 21h3a2 2 0 002-2v-3",
  minimize: "M8 3v3a2 2 0 01-2 2H3M21 8h-3a2 2 0 01-2-2V3M3 16h3a2 2 0 012 2v3M16 21v-3a2 2 0 012-2h3",

  // --- SOCIAL Y VALORACIÓN ---
  heart: "M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78l1.06 1.06L12 21.23l8.82-8.82 1.06-1.06a5.5 5.5 0 000-7.78z",
  star: "M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14l-5-4.87 6.91-1.01L12 2z",
  bookmark: "M19 21l-7-5-7 5V5a2 2 0 012-2h10a2 2 0 012 2z",
  share: "M4 12v8a2 2 0 002 2h12a2 2 0 002-2v-8M16 6l-4-4-4 4M12 2v13"
};

/**
 * Función Inyectora de Iconos para el Core
 * Utiliza máscaras CSS para permitir el control de color vía 'color' o 'currentColor'.
 */
export const Icon = (name, m = mod()) => {
  const path = ALSET_ICONS[name] || ALSET_ICONS['alert'];
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='white' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'><path d='${path}'/></svg>`;
  const encoded = btoa(svg);
  
  return Column(m.size(20, 20)
    .addStyle("backgroundColor", "currentColor")
    .addStyle("mask", `url('data:image/svg+xml;base64,${encoded}') no-repeat center / contain`)
    .addStyle("-webkit-mask", `url('data:image/svg+xml;base64,${encoded}') no-repeat center / contain`), 
    null
  );
};

/* =========================
   8. STREAMS E INFINITE RELAY (Cap. #16)
   ========================= 
*/
const createStream = (dir, cfg, render, m = mod()) => {
  const items = alsetState([]); const loading = alsetState(false); const hasMore = alsetState(true); const offset = alsetState(0);
  let isMounted = false;
  async function loadMore() {
    if (loading.get() || !hasMore.get()) return;
    loading.set(true);
    try {
      const next = await cfg.load(offset.get(), cfg.pageSize || 20);
      if (next.length === 0) hasMore.set(false);
      else { items.set([...items.get(), ...next]); offset.set(offset.get() + next.length); }
    } finally { loading.set(false); }
  }
  return (dir === "column" ? Column : Row)(m.fillMaxSize().overflow("auto").on("scroll", (e) => {
    const isEnd = dir === "column" ? (e.target.scrollTop + e.target.clientHeight >= e.target.scrollHeight - 50) : (e.target.scrollLeft + e.target.clientWidth >= e.target.scrollWidth - 50);
    if (isEnd) loadMore();
  }), () => {
    if (!isMounted) { isMounted = true; loadMore(); }
    items.get().forEach((item, i) => render(item, i));
  });
};
export const ColumnStream = (cfg, render, m) => createStream("column", cfg, render, m);
export const RowStream = (cfg, render, m) => createStream("row", cfg, render, m);

/* =========================
   9. INPUTS & FORMULARIOS
   ========================= 
*/
export const Input = (state, m = mod(), { placeholder = "", type = "text" } = {}) => {
  const el = Alset.createNode("input", m, null);
  el.type = type; el.placeholder = placeholder; el.__alsetState = state;
  el.oninput = (e) => state.set(e.target.value);
  const sync = () => { if (el.value !== state.get()) el.value = state.get(); };
  scheduleRecompose(sync);
  return el;
};

export const LoginForm = ({ onSubmit }) => {
  const email = alsetState(""); const pass = alsetState("");
  return Column(mod().gap(20).padding(40).glass().radius(32).width(360), () => {
    Text("Alset OS", mod().sizeText(32).weight("900"));
    Input(email, mod().padding(14).radius(14).background("rgba(255,255,255,0.05)").color("#fff"), { placeholder: "Email" });
    Input(pass, mod().padding(14).radius(14).background("rgba(255,255,255,0.05)").color("#fff"), { placeholder: "Contraseña", type: "password" });
    Column(mod().background(Theme.current.primary).padding(14).radius(14).clickable(() => onSubmit({email: email.get(), pass: pass.get()})).align("center", "center"), 
    () => Text("ACCEDER", mod().color("#000").weight("900")));
  });
};

export const RegisterForm = ({ onSubmit }) => {
  const email = alsetState(""); const pass = alsetState(""); const confirm = alsetState("");
  return Column(mod().gap(20).padding(40).glass().radius(32).width(360), () => {
    Text("Registro", mod().sizeText(32).weight("900"));
    Input(email, mod().padding(14).radius(14).background("rgba(255,255,255,0.05)").color("#fff"), { placeholder: "Email" });
    Input(pass, mod().padding(14).radius(14).background("rgba(255,255,255,0.05)").color("#fff"), { placeholder: "Pass", type: "password" });
    Input(confirm, mod().padding(14).radius(14).background("rgba(255,255,255,0.05)").color("#fff"), { placeholder: "Confirmar", type: "password" });
    Column(mod().background(Theme.current.secondary).padding(14).radius(14).clickable(() => onSubmit({email: email.get(), pass: pass.get()})).align("center", "center"), 
    () => Text("REGISTRAR", mod().color("#fff").weight("900")));
  });
};


/**
 * ALSET EDITOR - Grado NASA
 * Implementa persistencia de nodo por Registro para evitar el ciclo de limpieza del Core.
 */
/*export const AlsetEditor = (state, m = mod()) => {
  const key = "alset-nasa-ide-core";
  let el;

  if (AlsetRegistry.has(key)) {
    el = AlsetRegistry.get(key);
  } else {
    el = document.createElement("textarea");
    el.id = key;
    el.spellcheck = false;
    el.value = state.get();
    AlsetRegistry.set(key, el);

    el.oninput = (e) => {
        state.set(e.target.value);
    };

    el.onkeydown = (e) => {
        e.stopPropagation();
        if (e.key === "Tab") {
            e.preventDefault();
            const start = el.selectionStart;
            el.value = el.value.substring(0, start) + "  " + el.value.substring(el.selectionEnd);
            el.selectionStart = el.selectionEnd = start + 2;
            state.set(el.value);
        }
    };
  }

  if (m && m._styles) {
      const next = Object.assign({}, m._styles);
      // Ajustes críticos de acoplamiento NASA
      next.display = "block";
      next.boxSizing = "border-box"; // Asegura que el padding no desborde el 100%
      next.fontFamily = "'Fira Code', monospace";
      next.outline = "none";
      next.resize = "none";
      
      for (const k in next) el.style[k] = next[k];
  }

  if (currentContext && !currentContext.contains(el)) {
      currentContext.appendChild(el);
  }

  return el;
}; */


// Agregamos esta capacidad al AlsetEditor para que acepte inyecciones
export const AlsetEditor = (state, m = mod()) => {
  const key = "alset-nasa-ide-core";
  let el = AlsetRegistry.get(key);

  if (!el) {
    el = document.createElement("textarea");
    el.id = key;
    el.spellcheck = false;
    el.value = state.get();
    AlsetRegistry.set(key, el);
    
    el.oninput = (e) => state.set(e.target.value);
    el.onkeydown = (e) => {
        e.stopPropagation();
        if (e.key === "Tab") {
            e.preventDefault();
            const start = el.selectionStart;
            el.value = el.value.substring(0, start) + "  " + el.value.substring(el.selectionEnd);
            el.selectionStart = el.selectionEnd = start + 2;
            state.set(el.value);
        }
    };
  }
  
  // Función global temporal para que los botones puedan inyectar
  window.__alsetInject = (code) => {
    const start = el.selectionStart;
    const end = el.selectionEnd;
    const text = el.value;
    el.value = text.substring(0, start) + code + text.substring(end);
    el.focus();
    el.selectionStart = el.selectionEnd = start + code.length;
    state.set(el.value);
  };

  if (m && m._styles) {
    const next = Object.assign({}, m._styles);
    next.display = "block";
    next.boxSizing = "border-box";
    for (const k in next) el.style[k] = next[k];
  }

  if (currentContext && !currentContext.contains(el)) currentContext.appendChild(el);
  return el;
};

/* =========================
   10. MAPAS, ANIMACIÓN & UTILIDADES
   ========================= 
*/
export const MapNode = (m = mod(), config = {}) => {
  const el = Alset.createNode("div", m.background("#111").fillMaxSize(), null);
  if (!el.__mapInit) {
    el.__mapInit = true;
    const init = () => {
      const map = new maplibregl.Map({ container: el, style: 'https://demotiles.maplibre.org/style.json', center: config.center || [0,0], zoom: config.zoom || 2 });
      el.__alsetMap = map; config.onMapReady?.(map);
    };
    if (!window.maplibregl) {
      const s = document.createElement("script"); s.src = "https://unpkg.com/maplibre-gl@latest/dist/maplibre-gl.js"; s.onload = init; document.head.appendChild(s);
      const l = document.createElement("link"); l.rel = "stylesheet"; l.href = "https://unpkg.com/maplibre-gl@latest/dist/maplibre-gl.css"; document.head.appendChild(l);
    } else init();
  }
  return el;
};

export const Animate = (contentBlock, { from = { opacity: 0 }, to = { opacity: 1 }, duration = 400 } = {}) => {
  const node = contentBlock?.();
  if (node) node.animate([from, to], { duration, fill: "both", easing: "cubic-bezier(0.23, 1, 0.32, 1)" });
  return node;
};

export const createToast = () => {
  const visible = alsetState(false); const message = alsetState("");
  return {
    show: (msg) => { message.set(msg); visible.set(true); setTimeout(() => visible.set(false), 3000); },
    ToastView: () => {
      if (!visible.get()) return;
      Layer(mod().position("fixed").bottom(40).left("50%").addStyle("transform", "translateX(-50%)").zIndex(9999), 
      () => Card(mod().radius(40).glass().padding("15px 30px"), () => Text(message.get(), mod().weight("800"))));
    }
  };
};

/* =========================
   11. ROUTER & RESPONSIVE HOOK
   ========================= 
*/
export const currentRoute = alsetState({ name: "home", params: {} });
export const navigateTo = (name, params = {}) => currentRoute.set({ name, params });
export const Router = (routes) => Column(mod().fillMaxSize(), () => {
  const r = currentRoute.get(); const Comp = routes[r.name]; Comp ? Comp(r.params) : Text("404");
});

const __bpVersion = alsetState(0);
window.addEventListener("resize", () => __bpVersion.set(__bpVersion.get() + 1));
export const useBreakpoint = () => {
  __bpVersion.get();
  const w = window.innerWidth;
  if (w <= 480) return "sm";
  if (w <= 768) return "md";
  if (w <= 1024) return "lg";
  return "xl";
};

/* =========================
   12. INSPECTOR & MOUNT
   ========================= 
*/
export const AlsetInspector = (App) => {
  const root = document.getElementById("app");
  
  // Sincronización de tema inicial con el DOM Real
  root.style.backgroundColor = Theme.current.background;
  
  // Establecemos el contexto de montaje inicial
  currentContext = root; 
  
  // Ejecutamos la aplicación
  App();
};

/* =========================
   13. ALSET NEURAL LINK (Sistema Distribuido)
   ========================= 
   Extiende el estado reactivo para sincronización multi-dispositivo.
*/
export function alsetNeuralState(key, initialValue) {
  const state = alsetState(initialValue);
  
  // Creamos un canal de comunicación único para esta 'key'
  const neuralChannel = new BroadcastChannel(`alset_link_${key}`);

  // Escuchar cambios de otros "nodos" (Mirrors/Pestañas)
  neuralChannel.onmessage = (event) => {
    if (JSON.stringify(event.data) !== JSON.stringify(state.get())) {
      // Usamos el set interno para no crear un bucle infinito
      state.value = event.data;
      state.subscribers.forEach((fn) => scheduleRecompose(fn));
    }
  };

  // Envoltura para emitir pulsos al exterior
  return {
    get: () => state.get(),
    set: (newValue) => {
      state.set(newValue);
      neuralChannel.postMessage(newValue); // Emitir a la red Alset
    }
  };
}

/* =========================
   15. ALSET AUDIO LINK (Cap. #22)
   ========================= 
   Recibe fragmentos binarios vía pulso y los reproduce en tiempo real.
*/


export const AudioNode = (m = mod()) => {
  const el = Alset.createNode("div", m, null);
  
  // Creamos un elemento de audio nativo para streaming pesado
  const player = new Audio();
  player.crossOrigin = "anonymous";
  
  el.__alsetPulse = (pulse) => {
    // NUEVA ACCIÓN: Streaming directo
    if (pulse.action === "STREAM_URL") {
      console.log("🛰️ Sincronizando flujo directo:", pulse.url);
      player.src = pulse.url;
      player.play().catch(e => console.warn("Esperando click para sonar..."));
    }
    
    // Mantenemos las acciones anteriores para compatibilidad (pulso corto)
    if (pulse.action === "AUDIO_DATA") { /* ... tu lógica anterior ... */ }
  };

  return el;
};

export const VideoNode = (m = mod()) => {
  const el = Alset.createNode("div", m.position("relative").overflow("hidden"), null);
  
  // El "ojo" de Alset
  const video = document.createElement("video");
  video.style.width = "100%";
  video.style.height = "100%";
  video.style.objectFit = "cover";
  video.autoplay = true;
  video.controls = false; // Lo controlaremos por pulsos, no por botones feos
  
  el.appendChild(video);

  video.playsInline = true;
  video.muted = true;
  video.setAttribute("playsinline", "");
  el.__alsetVideo = video;

  el.__alsetPulse = (pulse) => {
    if (!pulse || !pulse.action) return;

    // URL (HLS/MP4/MediaMTX) — vía externa OBS
    if (pulse.action === "STREAM_VIDEO" && pulse.url) {
      video.srcObject = null;
      video.src = pulse.url;
      video.play().catch(() => {});
    }

    // MediaStream WebRTC (SFU/mesh) — no viaja por JSON; solo en-proceso
    if (pulse.action === "STREAM_MEDIA" && pulse.stream) {
      video.src = "";
      video.srcObject = pulse.stream;
      video.play().catch(() => {});
    }

    if (pulse.action === "PLAY") video.play().catch(() => {});
    if (pulse.action === "PAUSE") video.pause();

    if (pulse.action === "FX" && pulse.filter != null) {
      video.style.filter = pulse.filter;
    }

    // Zoom + giro 3D (retransmisión) — transform en el ojo
    if (pulse.action === "TRANSFORM") {
      const z = pulse.zoom != null ? pulse.zoom : 1;
      const rx = pulse.rotX != null ? pulse.rotX : 0;
      const ry = pulse.rotY != null ? pulse.rotY : 0;
      video.style.transformOrigin = "center center";
      video.style.transform =
        "scale(" + z + ") rotateX(" + rx + "deg) rotateY(" + ry + "deg)";
    }

    if (pulse.action === "MUTE") video.muted = !!pulse.value;
  };

  return el;
};

/* =========================
   14. ALSET PULSE STREAM (Protocolo NASA)
   ========================= 
*/

export const AlsetPulseStream = (url) => {
  let xhr = new XMLHttpRequest();
  let seenBytes = 0;
  let isReconnecting = false;

  const connect = () => {
    xhr = new XMLHttpRequest();
    seenBytes = 0;
    xhr.open("POST", url, true);
    xhr.setRequestHeader("Content-Type", "application/alset-pulse");

    xhr.onprogress = () => {
      const newData = xhr.responseText.substr(seenBytes);
      seenBytes = xhr.responseText.length;
      const lines = newData.split("\n").filter(l => l.trim());
      
      lines.forEach(line => {
        try {
          const { target, data } = JSON.parse(line);
          // Si es un latido de mantenimiento (heartbeat), lo ignoramos
          if (target === "hb") return; 

          const el = AlsetRegistry.get(target);
          if (el && el.__alsetPulse) el.__alsetPulse(data);
        } catch (e) { /* Pulso corrupto o incompleto */ }
      });
    };

    // Si la conexión se cierra por cualquier motivo (Timeout de Cloudflare o Error)
    xhr.onload = xhr.onerror = () => {
      if (!isReconnecting) {
        isReconnecting = true;
        console.log("📡 Resintonizando señal Alset...");
        setTimeout(() => {
          isReconnecting = false;
          connect(); 
        }, 1000); // Reintento en 1 segundo
      }
    };

    xhr.send(JSON.stringify({ type: "handshake" }));
  };

  connect();

  return {
    send: (msg) => fetch(url + "/uplink", { method: 'POST', body: JSON.stringify(msg) }),
    close: () => { isReconnecting = true; xhr.abort(); }
  };
};


/*export const AlsetPulseStream = async (url) => {
  try {
    const response = await fetch(url);
    if (!response.body) return;

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      let result;
      try {
        // La lectura puede fallar si el servidor se reinicia o hay lag
        result = await reader.read();
      } catch (e) {
        console.warn("⚠️ [NASA] Error de lectura en flujo, reiniciando antena...");
        break; // Sale al catch externo para reconectar
      }

      const { value, done } = result;
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop();

      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const pulse = JSON.parse(line);
          // Ignorar pings de mantenimiento
          if (pulse.type === "ping") continue;

          if (AlsetRegistry.has(pulse.target)) {
            const el = AlsetRegistry.get(pulse.target);
            el.__alsetPulse(pulse.data);
          }
        } catch (e) { console.warn("Pulso corrupto:", line); }
      }
    }
  } catch (err) {
    console.error("📡 Antena desconectada. Reintentando...");
  } finally {
    // Reconexión automática tras 3 segundos
    setTimeout(() => AlsetPulseStream(url), 3000);
  }
};*/
