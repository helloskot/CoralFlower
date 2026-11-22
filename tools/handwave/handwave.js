// SPDX-License-Identifier: GPL-3.0-only
// Handwave: generative ambient sound played with the hands in the air. It drifts by itself (handwave-worklet.js); the
// camera sees your hands (MediaPipe's hand tracker, on this device; no picture is shown or kept) and each one's place
// across, up and down, and how near it is (its size in the picture) shape it as it goes. Right hand: across moves
// through the chords, up and down the pitch and the brightness, nearer the swell (a melody, bells). Left hand: across
// the texture, up and down the space, nearer the weather. The screen is Drift's sky (Acid Flower's calm scenes, here
// smooth and full-size: the aurora, the nebula, the flight over the hills) with your hands in neon over it. No camera:
// touch and drag, a finger for each hand.
"use strict";
(() => {
  // the page and this script are one build (tools/make_site.sh stamps both): a browser that kept an old copy of the page
  // gets a fresh one, once, rather than half a Handwave
  const BUILD = "dev";
  {
    const m = document.querySelector('meta[name="hw-build"]'), page = m ? m.content : "old";
    if (page !== BUILD) {
      const k = "handwave-heal-" + BUILD; let tried = false;
      try { tried = !!sessionStorage.getItem(k); sessionStorage.setItem(k, "1"); } catch {}
      if (!tried) { fetch(location.pathname, { cache: "reload" }).catch(() => {}).finally(() => location.reload()); return; }
    }
  }
  const T = globalThis.HWTheory, $ = (id) => document.getElementById(id);
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v), lerp = (a, b, t) => a + (b - a) * t;

  // ------------------------------------------------------------------------------------------- the state ---
  const KEY = "handwave-hands";
  const DEF = { scene: "aurora", mood: "night", vol: 0.8 };
  const S = (() => { try { return { ...DEF, ...JSON.parse(localStorage.getItem(KEY) || "{}") }; } catch { return { ...DEF }; } })();
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch {} };
  try { localStorage.removeItem("handwave-state"); } catch {}   // (the chord machine's, from before)
  // the moods: a key, a scale, the chords across (in the order the right hand meets them), the colours
  const MOODS = {
    night: { key: 9, scale: "minor", degs: [0, 5, 2, 6, 3, 4], hue: 250 },
    dawn: { key: 2, scale: "major", degs: [0, 3, 5, 4, 1, 2], hue: 330 },
    dream: { key: 2, scale: "dorian", degs: [0, 3, 6, 1, 4, 2], hue: 175 },
  };
  if (!MOODS[S.mood]) S.mood = "night";
  if (!["aurora", "nebula", "sky"].includes(S.scene)) S.scene = "aurora";

  // ------------------------------------------------------------------------------------------- the sound ---
  let ctx = null, node = null, ready = null, started = false, paused = false, viz = { level: 0, pad: [], notes: [], bells: [], near: 0, pitch: 0.45, storm: 0.15, space: 0.6, tex: 0.33, thunder: 0 };
  function audio() {
    if (ready) { if (ctx.state !== "running") ctx.resume().catch(() => {}); return ready; }
    try { if (navigator.audioSession) navigator.audioSession.type = "playback"; } catch {}
    ctx = new AudioContext({ latencyHint: "playback" });
    ready = ctx.audioWorklet.addModule("handwave-worklet.js").then(() => {
      node = new AudioWorkletNode(ctx, "handwave", { numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [2] });
      node.connect(ctx.destination);
      node.port.onmessage = (e) => { if (e.data.type === "viz") onViz(e.data); };
      post({ type: "params", p: { vol: S.vol } }); sendChord(true);
      ctx.resume().catch(() => {});
    }).catch((err) => toast("The sound couldn't start: " + err.message));
    return ready;
  }
  const post = (m) => { if (node) node.port.postMessage(m); };
  for (const t of ["pointerdown", "keydown"]) addEventListener(t, () => { if (ctx && ctx.state !== "running") ctx.resume().catch(() => {}); }, { capture: true, passive: true });

  // the harmony: the right hand's place across picks one of six chords (a little sticky at the edges); with no right hand
  // for a while, it wanders by itself
  let zone = 0, lastNotes = null, chordT = 0, rightSeenT = 0, wanderT = 0;
  function sendChord(force) {
    const M = MOODS[S.mood], c = T.nearest(T.chord(M.key, M.scale, M.degs[zone], 1), lastNotes);
    if (!force && lastNotes && c.notes.join() === lastNotes.join()) return;
    lastNotes = c.notes; chordT = performance.now();
    post({ type: "chord", notes: c.notes, root: c.root, scale: T.SCALES[M.scale].steps, key: M.key });
  }
  function zoneFrom(x) {
    const z = clamp(x * 6, 0, 5.999);
    if (Math.abs(z - (zone + 0.5)) > 0.62) { const nz = Math.floor(z); if (nz !== zone) { zone = nz; sendChord(); } }
  }

  // ------------------------------------------------------------------------------------------- the hands ---
  const TIP = [4, 8, 12, 16, 20], BONES = [[0, 1], [1, 2], [2, 3], [3, 4], [0, 5], [5, 6], [6, 7], [7, 8], [5, 9], [9, 10], [10, 11], [11, 12], [9, 13], [13, 14], [14, 15], [15, 16], [13, 17], [17, 18], [18, 19], [19, 20], [0, 17]];
  const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  // one hand, read: across (mirrored, as a mirror shows you), up, and how near (its size: wrist to the middle knuckle)
  function readHand(lm) {
    const size = dist(lm[0], lm[9]) || 0.1;
    return { x: clamp(1 - lm[9].x, 0, 1), y: clamp((0.88 - lm[9].y) / 0.76, 0, 1), z: clamp((size - 0.08) / 0.16, 0, 1), size, lm };
  }
  // the hands to the two roles: the one further right is the right hand; one alone is the right hand if it's right of
  // the middle
  function handsToControl(hands) {
    const hs = hands.map(readHand).sort((a, b) => a.x - b.x);
    let r = null, l = null;
    if (hs.length >= 2) { l = hs[0]; r = hs[hs.length - 1]; } else if (hs.length === 1) { if (hs[0].x > 0.45) r = hs[0]; else l = hs[0]; }
    return { r, l };
  }
  // what the hands are doing now: from the camera, or from fingers on the screen
  let camHands = { r: null, l: null }, touchHands = { r: null, l: null }, testHands = null;
  const current = () => testHands || (camHands.r || camHands.l ? camHands : touchHands);
  let sentAt = 0;
  function sendHands() {
    const h = current(), pick = (o) => (o ? { x: o.x, y: o.y, z: o.z } : null);
    if (h.r) { zoneFrom(h.r.x); rightSeenT = performance.now(); }
    post({ type: "hands", r: pick(h.r), l: pick(h.l) }); sentAt = performance.now();
  }
  // fingers on the screen: the first is the right hand, a second the left; held longer, nearer
  const fingers = new Map();
  const skyEl = $("sky");
  function touchUpdate() {
    const now = performance.now(), list = [...fingers.values()], mk = (f) => ({ x: f.x, y: f.y, z: clamp(0.25 + (now - f.t0) / 2500, 0, 1), touch: true, px: f.px, py: f.py });
    touchHands = { r: list[0] ? mk(list[0]) : null, l: list[1] ? mk(list[1]) : null };
  }
  const onFinger = (e) => {
    if (!started) return;
    const f = fingers.get(e.pointerId) || { t0: performance.now() };
    f.px = e.clientX; f.py = e.clientY; f.x = clamp(e.clientX / innerWidth, 0, 1); f.y = clamp(1 - e.clientY / innerHeight, 0, 1);
    fingers.set(e.pointerId, f);
  };
  $("hands").addEventListener("pointerdown", (e) => { onFinger(e); try { e.target.setPointerCapture(e.pointerId); } catch {} });
  $("hands").addEventListener("pointermove", (e) => { if (fingers.has(e.pointerId)) onFinger(e); });
  for (const t of ["pointerup", "pointercancel"]) $("hands").addEventListener(t, (e) => fingers.delete(e.pointerId));

  // the camera, only to see the hands; MediaPipe's hand tracker from a CDN the first time (then the browser keeps it)
  const MP = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14";
  const MODELS = "https://storage.googleapis.com/mediapipe-models/";
  const video = $("cam");
  let vision = null, files = null, handTr = null, camOn = false, handsOn = false, camLoop = 0;
  async function cameraOn() {
    if (camOn) return;
    const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user", width: { ideal: 640 }, height: { ideal: 480 } }, audio: false });
    video.srcObject = stream; await video.play(); camOn = true;
    let lastT = -1; const me = ++camLoop;
    const loop = () => {
      if (!camOn || me !== camLoop) return;
      if (handsOn && handTr && video.readyState >= 2 && video.currentTime !== lastT) {
        lastT = video.currentTime;
        camHands = handsToControl(handTr.detectForVideo(video, performance.now()).landmarks || []);
      }
      requestAnimationFrame(loop);
    };
    loop();
  }
  function cameraOff() { camOn = false; const st = video.srcObject; if (st) st.getTracks().forEach((t) => t.stop()); video.srcObject = null; }
  async function startHands() {
    try {
      toast("Starting the camera (only to see your hands)…");
      await cameraOn();
      if (!vision) { toast("Loading the hand tracker (the first time takes a moment)…"); vision = await import(/* webpackIgnore: true */ MP + "/vision_bundle.mjs"); files = await vision.FilesetResolver.forVisionTasks(MP + "/wasm"); }
      if (!handTr) handTr = await vision.HandLandmarker.createFromOptions(files, { baseOptions: { modelAssetPath: MODELS + "hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task", delegate: "GPU" }, runningMode: "VIDEO", numHands: 2 });
      handsOn = true; $("handsBtn").setAttribute("aria-pressed", "true");
      toast("Hands on: move them across, up and down, nearer and further");
    } catch (err) {
      stopHands();
      toast(err && err.name === "NotAllowedError" ? "The camera wasn't allowed: allow it in the browser's settings, or touch and drag instead" : "The camera couldn't start: " + (err.message || err), null, null, 7000);
    }
  }
  function stopHands() { handsOn = false; camHands = { r: null, l: null }; $("handsBtn").setAttribute("aria-pressed", "false"); cameraOff(); }
  $("handsBtn").addEventListener("click", () => { begin(); handsOn ? stopHands() : startHands(); });
  document.addEventListener("visibilitychange", () => { if (document.hidden && camOn) stopHands(); });

  // ------------------------------------------------------------------------------------------ the sky (GL) ---
  // Drift's three calm scenes as full-size shaders. Each frame they're told: the chord's colours, the level, a bloom on
  // each new chord and bell, the weather (the left hand near), the light (the right hand high: brighter), the flight
  const HEAD = `#version 300 es
precision highp float;
uniform vec2 uRes; uniform float uT, uLvl, uBloom, uW, uZ, uBolt, uNear; uniform vec2 uMood; uniform vec3 uC1, uC2, uC3;
out vec4 o;
mat2 rot(float a) { float c = cos(a), s = sin(a); return mat2(c, -s, s, c); }
float h21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vnoise(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(h21(i), h21(i + vec2(1, 0)), f.x), mix(h21(i + vec2(0, 1)), h21(i + vec2(1, 1)), f.x), f.y); }
float fbm(vec2 p) { float s = 0.0, a = 0.5; for (int i = 0; i < 5; i++) { s += a * vnoise(p); p = p * 2.03 + 17.1; a *= 0.5; } return s; }
float stars(vec2 frag, float scale) { vec2 g = floor(frag / scale); return step(0.9965, h21(g)) * (0.5 + 0.5 * sin(uT * 1.7 + h21(g + 3.1) * 40.0)); }
`;
  const SHADERS = {
    // AURORA: curtains of light over dark hills, swaying slowly, brighter with each bell; coloured by the chord
    aurora: HEAD + `
void main() {
  vec2 uv = gl_FragCoord.xy / uRes; float Hh = 150.0, py = (1.0 - uv.y) * Hh, px = uv.x * Hh * uRes.x / uRes.y, q = py / Hh;
  vec3 c = vec3(3.0 + 8.0 * q, 5.0 + 14.0 * q, 16.0 + 26.0 * q) / 255.0 * (0.8 + uMood.y * 0.6);
  c += vec3(1.0) * stars(gl_FragCoord.xy, max(2.0, uRes.y / 260.0)) * (1.0 - q) * 0.5 * (1.0 - uW);
  float glow = 0.35 + 0.4 * uLvl + uMood.y * 0.3 + uBloom * 0.35 + uNear * 0.2, t = uT * 0.5 * (1.0 + uW);
  for (int k = 0; k < 3; k++) {
    float fk = float(k); vec3 col = k == 0 ? uC1 : k == 1 ? uC2 : uC3;
    float top = 22.0 + fk * 9.0 + sin(px * 0.021 + t * (0.6 + fk * 0.2) + fk * 2.0) * (11.0 + uW * 6.0) + sin(px * 0.0065 - t * 0.3 + fk) * 8.0;
    float inten = (max(0.0, sin(px * 0.085 + t * 1.2 + fk * 1.3)) * 0.6 + 0.4) * glow;
    float j = py - top, f = 1.0 - j / 46.0;
    if (j > 0.0 && j < 46.0) c += col * inten * f * f * 0.62 * smoothstep(0.0, 3.0, j);
  }
  float hz = Hh - 16.0 + sin(px * 0.019 + 0.5) * 6.0 + sin(px * 0.053 + 1.3) * 3.0;
  c = mix(c, vec3(4.0, 6.0, 12.0) / 255.0, smoothstep(hz - 0.6, hz + 0.6, py));
  c = mix(c, vec3(0.16, 0.17, 0.22), uW * 0.35);
  c = mix(c, vec3(0.85, 0.9, 1.0), uBolt * 0.5);
  o = vec4(c, 1.0);
}`,
    // NEBULA: a slow cloud of colour folding into itself, stars drifting through
    nebula: HEAD + `
vec3 pal(float f) { f = fract(f) * 3.0; return f < 1.0 ? mix(uC1, uC2, f) : f < 2.0 ? mix(uC2, uC3, f - 1.0) : mix(uC3, uC1, f - 2.0); }
void main() {
  vec2 uv = gl_FragCoord.xy / uRes; float Hh = 150.0, py = (1.0 - uv.y) * Hh, Ww = Hh * uRes.x / uRes.y, px = uv.x * Ww;
  float t = uT * 0.12 * (1.0 + uW * 1.5), d = length(vec2(px - Ww * 0.5, py - Hh * 0.5));
  float q = sin(px * 0.029 + t) + sin(py * 0.041 - t * 1.3) + sin((px + py) * 0.016 + t * 0.7) + sin(d * 0.033 - t * 0.9);
  float br = 0.35 + uMood.y * 0.45 + uLvl * 0.25 + uBloom * 0.25 + uNear * 0.15, k = max(0.0, (q + 1.4) / 5.4) * br;
  vec3 c = pal((q + 4.0) * 26.0 / 256.0) * k * 1.3 + vec3(0.0, 0.0, 0.025);
  vec2 sp = gl_FragCoord.xy + vec2(uT * uRes.y * 0.01, 0.0);
  c += vec3(1.0) * stars(sp, max(2.0, uRes.y / 220.0)) * 0.6;
  c = mix(c, vec3(0.12, 0.13, 0.17), uW * 0.3);
  c = mix(c, vec3(0.85, 0.9, 1.0), uBolt * 0.45);
  o = vec4(c, 1.0);
}`,
    // SKY FLIGHT: hills under a sky the weather makes (dusk, or grey in a storm), the light the right hand sets, clouds,
    // an aurora when it's dark, lightning in a storm; every new chord brightens it
    sky: HEAD + `
float terr(vec2 p) { return fbm(p * 0.03) * 24.0 - 8.0; }
void main() {
  vec2 uv = (gl_FragCoord.xy - uRes * 0.5) / uRes.y;
  float storm = uW, dark = 1.0 - uMood.y;
  vec3 ro = vec3(0.0, 15.0, uZ), rd = normalize(vec3(uv.x, uv.y - 0.08, 1.0));
  rd.xy *= rot(sin(uT * 0.05) * 0.06);
  vec3 dusk = mix(vec3(0.95, 0.45, 0.55), vec3(0.25, 0.3, 0.6), dark), top = mix(vec3(0.2, 0.15, 0.45), vec3(0.02, 0.02, 0.08), dark);
  vec3 grey = vec3(0.22, 0.24, 0.3) * (1.0 - dark * 0.6);
  vec3 skyC = mix(mix(dusk, top, smoothstep(0.0, 0.5, rd.y)), grey, storm * 0.8);
  vec3 c = skyC;
  vec3 sun = normalize(vec3(0.4 - uMood.x * 0.8, 0.08 + uMood.y * 0.12, 1.0));
  c += mix(vec3(1.0, 0.7, 0.5), vec3(0.8, 0.85, 1.0), dark) * pow(max(0.0, dot(rd, sun)), 60.0) * (1.0 - storm);
  if (rd.y > 0.0) {
    c += vec3(1.0) * step(0.997, h21(floor(rd.xy / rd.z * 220.0))) * dark * (1.0 - storm) * 0.8;
    float a = sin(rd.x * 6.0 + uT * 0.2 + sin(rd.x * 13.0 - uT * 0.3)) * 0.5 + 0.5;
    c += mix(uC1, uC2, a) * smoothstep(0.1, 0.3, rd.y) * smoothstep(0.55, 0.3, rd.y) * a * dark * (1.0 - storm) * (0.5 + uBloom * 0.6);
    vec2 cp = rd.xz / rd.y * 30.0 + vec2(0.0, uZ * 0.4 + uT * 1.5);
    float cl = smoothstep(0.55 - storm * 0.35, 0.95, fbm(cp * 0.04));
    c = mix(c, mix(vec3(1.0, 0.85, 0.9) * (1.0 - dark * 0.7), vec3(0.3, 0.32, 0.38), storm), cl * smoothstep(0.0, 0.15, rd.y) * 0.85);
  }
  float t = 0.5, h = 0.0; int hit = 0;
  for (int i = 0; i < 70; i++) { vec3 p = ro + rd * t; h = p.y - terr(p.xz); if (h < 0.02 * t) { hit = 1; break; } t += max(0.3, h * 0.6); if (t > 260.0) break; }
  if (hit == 1) {
    vec3 p = ro + rd * t; vec2 e = vec2(0.4, 0.0);
    vec3 n = normalize(vec3(terr(p.xz - e.xy) - terr(p.xz + e.xy), 0.8, terr(p.xz - e.yx) - terr(p.xz + e.yx)));
    vec3 g = mix(mix(vec3(0.2, 0.12, 0.3), vec3(0.16, 0.3, 0.26), smoothstep(-4.0, 10.0, p.y)), uC1 * 0.5, 0.25);
    float rim = pow(1.0 - max(0.0, n.y), 2.0);
    vec3 hc = g * (0.25 + 0.9 * max(0.0, dot(n, sun))) * (1.0 - dark * 0.45) + skyC * rim * 0.25;
    c = mix(hc, skyC, 1.0 - exp(-t * (0.0045 + storm * 0.008)));
  }
  c *= 1.0 + uBloom * 0.25;
  c = mix(c, vec3(0.9, 0.95, 1.0), uBolt * 0.6);
  o = vec4(c, 1.0);
}`,
  };
  const gl = skyEl.getContext("webgl2", { antialias: false, alpha: false, preserveDrawingBuffer: true });
  const progs = {};
  function prog(name) {
    if (progs[name] !== undefined) return progs[name];
    const sh = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)); return s; };
    try {
      const p = gl.createProgram();
      gl.attachShader(p, sh(gl.VERTEX_SHADER, "#version 300 es\nin vec2 a; void main() { gl_Position = vec4(a, 0.0, 1.0); }"));
      gl.attachShader(p, sh(gl.FRAGMENT_SHADER, SHADERS[name]));
      gl.bindAttribLocation(p, 0, "a"); gl.linkProgram(p);
      if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
      const u = {}; for (const n of ["uRes", "uT", "uLvl", "uBloom", "uW", "uZ", "uBolt", "uNear", "uMood", "uC1", "uC2", "uC3"]) u[n] = gl.getUniformLocation(p, n);
      progs[name] = { p, u };
    } catch (err) { console.warn("Handwave: the " + name + " scene couldn't be drawn: " + err.message); progs[name] = null; }
    return progs[name];
  }
  if (gl) { const b = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, b); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW); gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0); }
  // the colours: the mood's, turned by the chord; eased toward
  const hsl = (h, s, l) => { h = ((h % 360) + 360) % 360 / 360; const f = (n) => { const k = (n + h * 12) % 12; return l - s * Math.min(l, 1 - l) * Math.max(-1, Math.min(k - 3, 9 - k, 1)); }; return [f(0), f(8), f(4)]; };
  const col = { c1: [0.4, 0.3, 0.9], c2: [0.6, 0.3, 0.9], c3: [0.2, 0.6, 0.9] };
  let q = 0.6, frameAvg = 16, skyZ = 0, bloom = 0, bolt = 0, tPrev = 0;

  // ----------------------------------------------------------------------------------------- the hands, drawn ---
  const hc = $("hands"), g = hc.getContext("2d");
  let W = 0, H = 0, dpr = 1, motes = [];
  function fit() {
    dpr = Math.min(2, devicePixelRatio || 1); W = Math.round(innerWidth * dpr); H = Math.round(innerHeight * dpr);
    hc.width = W; hc.height = H; sizeSky();
  }
  function sizeSky() { skyEl.width = Math.max(2, Math.round(W * q)); skyEl.height = Math.max(2, Math.round(H * q)); }
  addEventListener("resize", fit); fit();
  const toC = (p) => [(1 - p.x) * W, p.y * H];
  function onViz(m) {
    viz = m;
    for (const n of m.bells || []) { bloom = Math.min(1, bloom + 0.3); motes.push({ x: (0.1 + Math.random() * 0.8) * W, y: (0.15 + Math.random() * 0.4) * H, h: (n % 12) * 30, life: 1, r: (2 + Math.random() * 3) * dpr, vy: -0.01 }); }
    const hr = current().r;
    for (const n of m.notes || []) {
      const [x, y] = hr ? handPoint(hr) : [W / 2, H / 2];
      motes.push({ x: x + (Math.random() - 0.5) * 60 * dpr, y: y + (Math.random() - 0.5) * 60 * dpr, h: (n % 12) * 30, life: 1, r: (1.5 + Math.random() * 2) * dpr, vy: -0.035 });
    }
    if (m.thunder > 0.9) bolt = 1;
    if (motes.length > 120) motes.splice(0, motes.length - 120);
  }
  const handPoint = (h) => (h.lm ? toC(h.lm[9]) : h.touch ? [h.px * dpr, h.py * dpr] : [h.x * W, (1 - h.y) * H]);
  function drawHand(h, colr, now) {
    const [cx, cy] = handPoint(h), R = (18 + h.z * 46) * dpr;
    g.save(); g.globalCompositeOperation = "lighter";
    // the palm's glow: bigger as the hand comes nearer
    const rg = g.createRadialGradient(cx, cy, 0, cx, cy, R * 2.2); rg.addColorStop(0, colr.replace("A", String(0.18 + h.z * 0.3))); rg.addColorStop(1, colr.replace("A", "0"));
    g.fillStyle = rg; g.beginPath(); g.arc(cx, cy, R * 2.2, 0, 6.283); g.fill();
    if (h.lm) {
      const P = (k) => toC(h.lm[k]);
      g.shadowColor = colr.replace("A", "1"); g.shadowBlur = (10 + h.z * 16) * dpr; g.strokeStyle = colr.replace("A", "0.95"); g.lineWidth = (2.5 + h.z * 2) * dpr; g.lineCap = "round"; g.lineJoin = "round";
      g.beginPath(); for (const [a, b] of BONES) { const [x1, y1] = P(a), [x2, y2] = P(b); g.moveTo(x1, y1); g.lineTo(x2, y2); } g.stroke();
      g.fillStyle = "#fff"; for (const k of TIP) { const [x, y] = P(k); g.beginPath(); g.arc(x, y, 3.2 * dpr, 0, 6.283); g.fill(); }
    } else {
      g.strokeStyle = colr.replace("A", "0.9"); g.lineWidth = 2.5 * dpr; g.shadowColor = colr.replace("A", "1"); g.shadowBlur = 16 * dpr;
      g.beginPath(); g.arc(cx, cy, R * (0.55 + 0.05 * Math.sin(now / 300)), 0, 6.283); g.stroke();
      g.fillStyle = "#fff"; g.beginPath(); g.arc(cx, cy, 4 * dpr, 0, 6.283); g.fill();
    }
    g.restore();
  }

  // ------------------------------------------------------------------------------------------- a frame ---
  function frame(now) {
    const dt = Math.min(0.1, tPrev ? (now - tPrev) / 1000 : 0.016); tPrev = now;
    if (started) { touchUpdate(); if (now - sentAt > 33) sendHands(); }
    // no right hand for a while: the chords wander by themselves
    if (started && !paused && now - rightSeenT > 15000 && now - wanderT > 14000) { wanderT = now; if (now - rightSeenT > 16000) { zone = clamp(zone + (Math.random() < 0.5 ? -1 : 1), 0, 5); if (zone === 0 || zone === 5) zone = Math.random() < 0.5 ? 1 : 4; sendChord(); } }
    // the colours, toward the chord's
    const M = MOODS[S.mood], hue = M.hue + zone * 32 - viz.storm * 20, sat = 0.75 - viz.storm * 0.4;
    for (const [k, h] of [["c1", hue], ["c2", hue + 55], ["c3", hue - 50]]) { const t = hsl(h, sat, 0.58); for (let i = 0; i < 3; i++) col[k][i] = lerp(col[k][i], t[i], Math.min(1, dt * 1.2)); }
    if (now - chordT < 60) bloom = 1;
    bloom *= Math.pow(0.25, dt); bolt *= Math.pow(0.02, dt);
    skyZ += dt * (3 + viz.near * 7 + viz.storm * 3);
    if (gl) {
      const P = prog(S.scene);
      if (P) {
        gl.viewport(0, 0, skyEl.width, skyEl.height); gl.useProgram(P.p); const u = P.u;
        gl.uniform2f(u.uRes, skyEl.width, skyEl.height); gl.uniform1f(u.uT, now / 1000); gl.uniform1f(u.uLvl, Math.min(1, viz.level * 5));
        gl.uniform1f(u.uBloom, bloom); gl.uniform1f(u.uW, clamp((viz.storm - 0.1) / 0.85, 0, 1)); gl.uniform1f(u.uZ, skyZ); gl.uniform1f(u.uBolt, bolt); gl.uniform1f(u.uNear, viz.near);
        gl.uniform2f(u.uMood, current().r ? current().r.x : 0.5, 0.25 + viz.pitch * 0.6);
        gl.uniform3fv(u.uC1, col.c1); gl.uniform3fv(u.uC2, col.c2); gl.uniform3fv(u.uC3, col.c3);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
      }
      // the quality: lighter when frames are slow, finer when there's room
      frameAvg = lerp(frameAvg, dt * 1000, 0.05);
      if (frameAvg > 26 && q > 0.34) { q = Math.max(0.34, q - 0.08); sizeSky(); frameAvg = 18; }
      else if (frameAvg < 15 && q < 1) { q = Math.min(1, q + 0.04); sizeSky(); frameAvg = 17; }
    }
    // the hands and the motes
    g.clearRect(0, 0, W, H);
    for (const m of motes) { m.life -= dt * 0.3; m.y += m.vy * H * dt; m.x += Math.sin(now / 900 + m.h) * dt * 6 * dpr; }
    motes = motes.filter((m) => m.life > 0);
    g.globalCompositeOperation = "lighter";
    for (const m of motes) { const rg = g.createRadialGradient(m.x, m.y, 0, m.x, m.y, m.r * 5); rg.addColorStop(0, `hsla(${m.h},100%,82%,${m.life})`); rg.addColorStop(1, `hsla(${m.h},100%,60%,0)`); g.fillStyle = rg; g.fillRect(m.x - m.r * 5, m.y - m.r * 5, m.r * 10, m.r * 10); }
    g.globalCompositeOperation = "source-over";
    const h = current();
    if (h.r) drawHand(h.r, "rgba(43,240,255,A)", now);
    if (h.l) drawHand(h.l, "rgba(196,140,255,A)", now);
    $("hint").textContent = !started ? "" : handsOn && !h.r && !h.l ? "Raise your hands in front of the camera" : !handsOn && !h.r && !h.l && now - startT < 9000 ? "Tap the hand to play in the air, or touch and drag" : "";
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  // ------------------------------------------------------------------------------------------ the controls ---
  let startT = 0;
  function begin() {
    if (started) return;
    started = true; startT = performance.now(); $("start").classList.add("is-gone");
    try { if (!localStorage.getItem("handwave-hands-seen")) { localStorage.setItem("handwave-hands-seen", "1"); show($("helpSheet")); } } catch {}   // (the first time: how to play)
    audio().then(() => post({ type: "on", on: true }));
  }
  $("start").addEventListener("click", begin);
  const show = (d) => { if (!d.open) d.showModal(); };
  for (const d of document.querySelectorAll("dialog")) d.addEventListener("click", (e) => { if (e.target === d) d.close(); });
  const SCENES = ["aurora", "nebula", "sky"];
  $("sceneBtn").addEventListener("click", () => { S.scene = SCENES[(SCENES.indexOf(S.scene) + 1) % 3]; save(); drawMenu(); });
  $("menuBtn").addEventListener("click", () => { drawMenu(); show($("menuSheet")); });
  $("helpBtn").addEventListener("click", () => { $("menuSheet").close(); show($("helpSheet")); });
  $("pauseBtn").addEventListener("click", () => { paused = !paused; begin(); post({ type: "on", on: !paused }); drawMenu(); });
  $("vol").addEventListener("input", () => { S.vol = +$("vol").value; post({ type: "params", p: { vol: S.vol } }); save(); });
  document.querySelectorAll("[data-set]").forEach((sg) => sg.addEventListener("click", (e) => {
    const b = e.target.closest("button"); if (!b) return;
    S[sg.dataset.set] = b.dataset.v; save(); drawMenu();
    if (sg.dataset.set === "mood") { lastNotes = null; sendChord(true); }
  }));
  function drawMenu() {
    document.querySelectorAll("[data-set]").forEach((sg) => sg.querySelectorAll("button").forEach((b) => b.setAttribute("aria-pressed", String(S[sg.dataset.set] === b.dataset.v))));
    $("vol").value = S.vol; $("pauseBtn").textContent = paused ? "Play" : "Pause";
  }
  addEventListener("keydown", (e) => { if (e.code === "Space" && !e.target.closest("dialog")) { e.preventDefault(); if (!started) begin(); else $("pauseBtn").click(); } });
  drawMenu();

  // ------------------------------------------------------------------------------------------ the toast ---
  let toastT = 0;
  function toast(text, label, f, ms = 3200) {
    const el = $("toast"); el.textContent = text; el.hidden = false; clearTimeout(toastT);
    toastT = setTimeout(() => { el.hidden = true; }, ms);
  }

  // -------------------------------------------------------------------------------------------- start ---

  // (browser only: an old install's service worker, and its cache, let go)
  if ("serviceWorker" in navigator) navigator.serviceWorker.getRegistrations().then((rs) => rs.forEach((r) => { if (/\/handwave\//.test(r.scope)) r.unregister(); })).catch(() => {});
  if (window.caches) caches.keys().then((ks) => ks.forEach((k) => { if (/^handwave/.test(k)) caches.delete(k); })).catch(() => {});
  // made-up hands, for the tests: a hand at (x, y) on the camera's picture, this big (s: the hand's scale; nearer, bigger)
  function makeHand(x, y, s = 0.22) {
    const lm = Array.from({ length: 21 }, () => ({ x: 0, y: 0, z: 0 })), P = (k, dx, dy) => { lm[k] = { x: x + dx * s, y: y + dy * s, z: 0 }; };
    P(0, 0, 0.55); P(9, 0, 0);
    [[5, -0.28], [9, -0.05], [13, 0.16], [17, 0.34]].forEach(([b, dx]) => { P(b, dx, 0); P(b + 1, dx * 1.05, -0.32); P(b + 2, dx * 1.08, -0.5); P(b + 3, dx * 1.1, -0.66); });
    P(1, -0.32, 0.42); P(2, -0.48, 0.28); P(3, -0.58, 0.14); P(4, -0.86, -0.02);
    return lm;
  }
  window.handwave = { S, begin, ctx: () => ctx, viz: () => viz, started: () => started, zone: () => zone, camOn: () => camOn, handsOn: () => handsOn, quality: () => q,
    readHand, handsToControl, makeHand, current, setHands: (h) => { testHands = h; }, setCamHands: (lms) => { camHands = handsToControl(lms); }, gl: () => !!gl, scenesOk: () => SCENES.map((n) => !!(gl && prog(n))) };
})();
