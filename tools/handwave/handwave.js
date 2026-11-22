// SPDX-License-Identifier: GPL-3.0-only
// Handwave: ambient house and dub techno played with the body in the air. It plays by itself (handwave-worklet.js); the
// camera sees your hands, your face and your body (MediaPipe's trackers, on this device; no picture is shown or kept).
// Right hand: across moves through the chords (and turns the flight), up and down the pitch and the brightness, nearer
// the swell (an arpeggio). Left hand: across builds the groove, up and down the space (the dub echo), nearer opens the
// filter. Face: turn your head to look around, tilt it to bank, open your mouth to open the sound up. Body: dance and the
// groove builds, lean to turn, arms wide for space. The screen is Drift's sky (Acid Flower's calm scenes, smooth and
// full-size: the flight over the hills first, the aurora, the nebula) with you in neon over it. No camera: touch and
// drag, a finger for each hand.
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
  const DEF = { scene: "iso", mood: "night", vol: 0.8, hands: true, face: true, body: true, dials: true, v: 4 };
  const S = (() => { try { return { ...DEF, ...JSON.parse(localStorage.getItem(KEY) || "{}") }; } catch { return { ...DEF }; } })();
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch {} };
  try { localStorage.removeItem("handwave-state"); } catch {}   // (the chord machine's, from before)
  // the moods: a key, a scale, the chords across (in the order the right hand meets them), the colours
  const MOODS = {
    night: { key: 9, scale: "minor", degs: [0, 5, 2, 6, 3, 4], hue: 250, tempo: 120 },
    dawn: { key: 2, scale: "major", degs: [0, 3, 5, 4, 1, 2], hue: 330, tempo: 124 },
    dream: { key: 2, scale: "dorian", degs: [0, 3, 6, 1, 4, 2], hue: 175, tempo: 116 },
  };
  if (!MOODS[S.mood]) S.mood = "night";
  if (S.hands === undefined) S.hands = true;
  if (S.dials === undefined) S.dials = true;
  if (!["iso", "aurora", "nebula", "sky"].includes(S.scene) || (S.v || 0) < 4) { S.scene = "iso"; S.v = 4; S.face = S.face !== false; S.body = S.body !== false; save(); }   // (the island first)

  // ------------------------------------------------------------------------------------------- the sound ---
  let ctx = null, node = null, ready = null, started = false, paused = false, viz = { level: 0, pad: [], notes: [], kick: 0, stab: 0, near: 0, pitch: 0.45, energy: 0.55, space: 0.5, drive: 0.35, mouth: 0, dance: 0 };
  function audio() {
    if (ready) { if (ctx.state !== "running") ctx.resume().catch(() => {}); return ready; }
    try { if (navigator.audioSession) navigator.audioSession.type = "playback"; } catch {}
    ctx = new AudioContext({ latencyHint: "playback" });
    ready = ctx.audioWorklet.addModule("handwave-worklet.js").then(() => {
      node = new AudioWorkletNode(ctx, "handwave", { numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [2] });
      node.connect(ctx.destination);
      node.port.onmessage = (e) => { if (e.data.type === "viz") onViz(e.data); };
      sendParams(); sendChord(true);
      ctx.resume().catch(() => {});
    }).catch((err) => toast("The sound couldn't start: " + err.message));
    return ready;
  }
  const post = (m) => { if (node) node.port.postMessage(m); };
  const sendParams = () => post({ type: "params", p: { vol: S.vol, tempo: MOODS[S.mood].tempo } });
  for (const t of ["pointerdown", "keydown"]) addEventListener(t, () => { if (ctx && ctx.state !== "running") ctx.resume().catch(() => {}); }, { capture: true, passive: true });

  // the harmony: the right hand's place across picks one of six chords (a little sticky at the edges); with no right hand
  // for a while, it wanders by itself
  let zone = 0, lastNotes = null, chordT = 0, rightSeenT = 0, wanderT = 0;
  function sendChord(force) {
    const M = MOODS[S.mood], c = T.nearest(T.chord(M.key, M.scale, M.degs[zone], 1), lastNotes);
    if (!force && lastNotes && c.notes.join() === lastNotes.join()) return;
    lastNotes = c.notes; chordT = performance.now(); chordRing();
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
  function handsToControl(hands, prev) {
    const hs = hands.map(readHand).sort((a, b) => a.x - b.x);
    let r = null, l = null;
    if (hs.length >= 2) { l = hs[0]; r = hs[hs.length - 1]; } else if (hs.length === 1) { if (hs[0].x > 0.45) r = hs[0]; else l = hs[0]; }
    return prev ? { r: steady(r, prev.r), l: steady(l, prev.l) } : { r, l };
  }
  // a hand, steadied: a little of where it was, when it's barely moving (the tracker's jitter); none, when it moves
  function steady(h, was) {
    if (!h || !was || !was.lm) return h;
    const mv = Math.hypot(h.x - was.x, h.y - was.y) * 40, a = clamp(0.35 + mv, 0.35, 1);
    const m = (u, v) => v + (u - v) * a;
    return { ...h, x: m(h.x, was.x), y: m(h.y, was.y), z: m(h.z, was.z), lm: h.lm.map((p, i) => ({ x: m(p.x, was.lm[i].x), y: m(p.y, was.lm[i].y), z: 0 })) };
  }
  // what the hands are doing now: from the camera, or from fingers on the screen
  let camHands = { r: null, l: null }, touchHands = { r: null, l: null }, testHands = null, face = null, body = null;
  const current = () => testHands || (camHands.r || camHands.l ? camHands : touchHands);
  let sentAt = 0, lastSent = null;
  function sendHands() {
    const h = current(), pick = (o) => (o ? { x: o.x, y: o.y, z: o.z } : null);
    if (h.r) { zoneFrom(h.r.x); rightSeenT = performance.now(); }
    post({ type: "hands", r: pick(h.r), l: pick(h.l), f: face && S.face ? { mouth: face.mouth } : null, b: body && S.body ? { dance: body.dance, arms: body.arms } : null }); sentAt = performance.now();
    lastSent = h;
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

  // the camera, only to follow you (your hands, your face, your body, as chosen); MediaPipe's trackers from a CDN the
  // first time (then the browser keeps them)
  const MP = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14";
  const MODELS = "https://storage.googleapis.com/mediapipe-models/";
  const video = $("cam");
  let vision = null, files = null, handTr = null, faceTr = null, poseTr = null, camOn = false, handsOn = false, camLoop = 0;
  async function cameraOn() {
    if (camOn) return;
    const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user", width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 60 } }, audio: false });
    video.srcObject = stream; await video.play(); camOn = true;
    let lastT = -1, n = 0; const me = ++camLoop, rvfc = "requestVideoFrameCallback" in video;
    const next = () => (rvfc ? video.requestVideoFrameCallback(loop) : requestAnimationFrame(loop));
    const loop = () => {
      if (!camOn || me !== camLoop) return;
      if (handsOn && video.readyState >= 2 && video.currentTime !== lastT) {
        lastT = video.currentTime; n++;
        const ts = performance.now(), others = (S.face && faceTr ? 1 : 0) + (S.body && poseTr ? 1 : 0);
        if (S.hands && handTr) camHands = handsToControl(handTr.detectForVideo(video, ts).landmarks || [], camHands);
        else camHands = { r: null, l: null };
        // (with the hands too: the face and the body take turns every few frames; alone, they share every frame)
        const turn = S.hands && handTr ? n % 3 : n % Math.max(1, others) + 1;
        if (S.face && faceTr && turn === 1) face = readFace(faceTr.detectForVideo(video, ts + 0.3));
        if (S.body && poseTr && turn === (S.face && faceTr ? 2 : 1)) body = readBody((poseTr.detectForVideo(video, ts + 0.6).landmarks || [])[0], ts);
      }
      next();
    };
    next();
  }
  function cameraOff() { camOn = false; const st = video.srcObject; if (st) st.getTracks().forEach((t) => t.stop()); video.srcObject = null; }
  async function startHands() {
    if (!S.hands && !S.face && !S.body) { S.hands = true; save(); drawMenu(); }
    try {
      toast("Starting the camera (it only follows your movement)…");
      await cameraOn();
      if (!vision) { toast("Loading the trackers (the first time takes a moment)…"); vision = await import(/* webpackIgnore: true */ MP + "/vision_bundle.mjs"); files = await vision.FilesetResolver.forVisionTasks(MP + "/wasm"); }
      if (S.hands && !handTr) handTr = await vision.HandLandmarker.createFromOptions(files, { baseOptions: { modelAssetPath: MODELS + "hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task", delegate: "GPU" }, runningMode: "VIDEO", numHands: 2, minHandPresenceConfidence: 0.4, minTrackingConfidence: 0.4 });
      handsOn = true; $("handsBtn").setAttribute("aria-pressed", "true");
      toast(S.hands ? "Camera on: move your hands across, up and down, nearer and further" : "Camera on");
      loadFaceBody();
    } catch (err) {
      stopHands();
      toast(err && err.name === "NotAllowedError" ? "The camera wasn't allowed: allow it in the browser's settings, or touch and drag instead" : "The camera couldn't start: " + (err.message || err), null, null, 7000);
    }
  }
  function stopHands() { handsOn = false; camHands = { r: null, l: null }; face = null; body = null; $("handsBtn").setAttribute("aria-pressed", "false"); cameraOff(); }
  // the face and the body: their trackers loaded when they're wanted (the face's with its expressions, for the mouth)
  async function loadFaceBody() {
    try {
      if (S.hands && !handTr) handTr = await vision.HandLandmarker.createFromOptions(files, { baseOptions: { modelAssetPath: MODELS + "hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task", delegate: "GPU" }, runningMode: "VIDEO", numHands: 2, minHandPresenceConfidence: 0.4, minTrackingConfidence: 0.4 });
      if (S.face && !faceTr) faceTr = await vision.FaceLandmarker.createFromOptions(files, { baseOptions: { modelAssetPath: MODELS + "face_landmarker/face_landmarker/float16/1/face_landmarker.task", delegate: "GPU" }, runningMode: "VIDEO", numFaces: 1, outputFaceBlendshapes: true });
      if (S.body && !poseTr) poseTr = await vision.PoseLandmarker.createFromOptions(files, { baseOptions: { modelAssetPath: MODELS + "pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task", delegate: "GPU" }, runningMode: "VIDEO", numPoses: 1 });
    } catch (err) { console.warn("Handwave: the face or body tracker couldn't start: " + err.message); }
  }
  // the face, read: the head turned (left/right) and tilted, the mouth open; its outline, to draw
  const OVAL = [10, 338, 297, 332, 284, 251, 389, 356, 454, 323, 361, 288, 397, 365, 379, 378, 400, 377, 152, 148, 176, 149, 150, 136, 172, 58, 132, 93, 234, 127, 162, 21, 54, 103, 67, 109, 10];
  function readFace(res) {
    const lm = res && res.faceLandmarks && res.faceLandmarks[0]; if (!lm) return null;
    const eL = lm[33], eR = lm[263], nose = lm[1], mid = { x: (eL.x + eR.x) / 2, y: (eL.y + eR.y) / 2 }, ed = Math.hypot(eR.x - eL.x, eR.y - eL.y) || 0.1;
    const bs = res.faceBlendshapes && res.faceBlendshapes[0] && res.faceBlendshapes[0].categories, jaw = bs ? (bs.find((c) => c.categoryName === "jawOpen") || {}).score || 0 : clamp((dist(lm[13], lm[14]) / ed - 0.05) * 3, 0, 1);
    return { yaw: clamp(-(nose.x - mid.x) / ed * 2.2, -1, 1), roll: Math.atan2(eR.y - eL.y, eR.x - eL.x) * -1, mouth: clamp((jaw - 0.08) / 0.55, 0, 1), lm };
  }
  // the body, read: how much it moves (dancing), how it leans, how wide the arms are; its bones, to draw
  const POSE = [[11, 12], [11, 13], [13, 15], [12, 14], [14, 16], [11, 23], [12, 24], [23, 24], [23, 25], [24, 26], [25, 27], [26, 28]];
  let bodyPrev = null, danceE = 0;
  function readBody(lm, ts) {
    if (!lm) { bodyPrev = null; return body ? { ...body, dance: body.dance * 0.9 } : null; }
    const sh = dist(lm[11], lm[12]) || 0.1, pts = [11, 12, 15, 16, 23, 24, 0];
    if (bodyPrev) { const dt = Math.max(0.016, (ts - bodyPrev.ts) / 1000); let m = 0; for (const k of pts) m += dist(lm[k], bodyPrev.lm[k]); danceE = lerp(danceE, clamp((m / pts.length / sh / dt - 0.15) / 1.6, 0, 1), 0.08); }
    bodyPrev = { lm: lm.map((p) => ({ x: p.x, y: p.y })), ts };
    const cx = (lm[11].x + lm[12].x) / 2, hx = (lm[23].x + lm[24].x) / 2;
    return { dance: danceE, arms: clamp((dist(lm[15], lm[16]) / sh - 1.4) / 2.2, 0, 1), lean: clamp(-(cx - hx) / sh * 2.5, -1, 1), lm };
  }
  $("handsBtn").addEventListener("click", () => { begin(); handsOn ? stopHands() : startHands(); });
  document.addEventListener("visibilitychange", () => { if (document.hidden && camOn) stopHands(); });

  // ------------------------------------------------------------------------------------------ the sky (GL) ---
  // Drift's three calm scenes as full-size shaders. Each frame they're told: the chord's colours, the level, a bloom on
  // each new chord and bell, the weather (the left hand near), the light (the right hand high: brighter), the flight
  const HEAD = `#version 300 es
precision highp float;
uniform vec2 uRes, uPos; uniform float uT, uLvl, uBloom, uW, uZ, uBolt, uNear, uYaw, uLook, uRoll, uKick, uE, uD; uniform vec2 uMood; uniform vec3 uC1, uC2, uC3;
out vec4 o;
mat2 rot(float a) { float c = cos(a), s = sin(a); return mat2(c, -s, s, c); }
float h21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vnoise(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(h21(i), h21(i + vec2(1, 0)), f.x), mix(h21(i + vec2(0, 1)), h21(i + vec2(1, 1)), f.x), f.y); }
float fbm(vec2 p) { float s = 0.0, a = 0.5; for (int i = 0; i < 5; i++) { s += a * vnoise(p); p = p * 2.03 + 17.1; a *= 0.5; } return s; }
float stars(vec2 frag, float scale) { vec2 g = floor(frag / scale); return step(0.9965, h21(g)) * (0.5 + 0.5 * sin(uT * 1.7 + h21(g + 3.1) * 40.0)); }
`;
  const SHADERS = {
    // ISO: isometric pixel art. A floating island of blocks seen from above at the classic angle, drawn small and shown
    // big (each pixel a block on the screen), in a few colours with an ordered dither. The land scrolls under you and
    // turns with the right hand; towers rise with the groove and bounce on the kick; their windows light as the filter
    // opens; the water shimmers; the chord colours it all
    iso: HEAD + `
float bayer(vec2 f) { ivec2 p = ivec2(mod(f, 4.0)); int i = p.x + p.y * 4;
  int[16] m = int[16](0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5); return (float(m[i]) + 0.5) / 16.0; }
vec2 TGT;
float tower(vec2 c) { return h21(c * 1.37 + 3.1); }
// a cell's top (its bottom is the island's underside); out past the island's edge, nothing
float cellH(vec2 c) {
  if (length(c + 0.5 - TGT) > 12.5) return -99.0;
  float h = max(0.0, floor(fbm(c * 0.075 + 40.0) * 10.0) - 3.0);
  float tw = tower(c);
  if (h > 0.0 && tw > 0.9) h += 1.0 + floor(uE * 7.0 * (0.45 + 0.55 * h21(c + 7.0))) + (tw > 0.96 ? uKick * 1.2 : 0.0);
  return h;
}
void main() {
  vec2 f = gl_FragCoord.xy, p = f - uRes * 0.5;
  float s = 30.0 / min(uRes.x, uRes.y), a = 0.785 + uYaw * 1.1, e = 0.6 + uLook * 0.5;
  vec3 d = normalize(vec3(cos(e) * sin(a), -sin(e), cos(e) * cos(a)));
  vec3 rt = normalize(cross(d, vec3(0.0, 1.0, 0.0))), up = cross(rt, d);
  TGT = uPos * 0.35;
  vec3 ro = vec3(TGT.x, 3.0, TGT.y) + (rt * p.x + up * p.y) * s - d * 40.0;
  ro += d * ((14.0 - ro.y) / d.y);
  // the sky behind the island: the mood's dark, pixel stars
  float q = f.y / uRes.y;
  vec3 c = mix(vec3(0.02, 0.02, 0.05) + uC1 * 0.05, vec3(0.06, 0.05, 0.13) + uC2 * 0.12, q) * (0.7 + uMood.y * 0.6);
  vec2 sg = floor(f / 2.0); c += vec3(0.9) * step(0.993, h21(sg)) * (0.5 + 0.5 * sin(uT * 2.0 + h21(sg + 1.0) * 30.0)) * q;
  // through the grid, cell by cell (the columns stand from the underside, y = -3, to their top)
  vec2 cell = floor(ro.xz), st = sign(d.xz), td = abs(1.0 / d.xz), tm = ((cell + max(st, 0.0)) - ro.xz) / d.xz;
  float t = 0.0; int side = -1, hit = 0; vec3 pos = ro; float hh = 0.0; vec2 hc = cell;
  for (int i = 0; i < 90; i++) {
    float h = cellH(cell), tx = min(tm.x, tm.y), y0 = ro.y + d.y * t, y1 = ro.y + d.y * tx;
    if (h > -50.0 && y1 <= h && y0 >= -3.0) {
      if (y0 <= h && side >= 0) { hit = 2 + side; pos = ro + d * t; } else { hit = 1; pos = ro + d * ((h - ro.y) / d.y); }
      hh = h; hc = cell; break;
    }
    if (tm.x < tm.y) { t = tm.x; tm.x += td.x; cell.x += st.x; side = 0; } else { t = tm.y; tm.y += td.y; cell.y += st.y; side = 1; }
    if (ro.y + d.y * t < -6.0) break;
  }
  if (hit > 0) {
    float tw = tower(hc); bool isT = hh > 0.0 && tw > 0.9 && hh > max(0.0, floor(fbm(hc * 0.075 + 40.0) * 10.0) - 3.0);
    vec3 grass = mix(vec3(0.25, 0.55, 0.3), uC1, 0.3), sand = vec3(0.85, 0.75, 0.5), rock = vec3(0.55, 0.5, 0.6), snow = vec3(0.92, 0.94, 1.0);
    vec3 base = hh < 0.5 ? mix(vec3(0.15, 0.35, 0.75), uC3, 0.35) : hh < 1.5 ? sand : hh < 4.5 ? grass : hh < 6.5 ? rock : snow;
    if (isT) base = mix(vec3(0.75, 0.74, 0.8), uC2, 0.35);
    if (hit == 1) {
      c = base;
      vec2 fr = fract(pos.xz);
      if (hh < 0.5) c += 0.12 * step(0.75, sin((pos.x + pos.z) * 3.0 + uT * 2.0 + h21(hc) * 6.0)) + uKick * 0.08;   // (the water shimmers)
      if (min(min(fr.x, 1.0 - fr.x), min(fr.y, 1.0 - fr.y)) < 0.07) c *= 0.82;                                         // (each tile's edge)
      if (isT && tw > 0.96) c = mix(c, vec3(1.0), uKick * 0.6);                                                       // (the tall ones flash on the kick)
    } else {
      float sh = hit == 2 ? 0.66 : 0.46;
      c = (pos.y < 0.0 ? mix(vec3(0.35, 0.25, 0.22), vec3(0.2, 0.15, 0.18), clamp(-pos.y / 3.0, 0.0, 1.0)) : base) * sh;
      if (isT && pos.y > 0.3) {                         // windows, lit as the filter opens
        vec2 w = vec2((hit == 2 ? pos.z : pos.x) * 3.0, pos.y * 3.0), wc = floor(w), wf = fract(w);
        if (wf.x > 0.25 && wf.x < 0.75 && wf.y > 0.3 && wf.y < 0.8) c = h21(wc + hc * 7.0) < 0.08 + uD * 0.85 ? mix(vec3(1.0, 0.85, 0.45), uC2, 0.25) * (1.0 + uKick * 0.3) : c * 0.6;
      }
    }
    c *= 0.75 + uMood.y * 0.45 + uBloom * 0.15;
  }
  // a few colours, an ordered dither: pixel art
  float lv = hit > 0 ? 6.0 : 24.0; c = floor(c * lv + bayer(f)) / lv;   // (the sky in finer steps: calm)
  o = vec4(c, 1.0);
}`,
    // AURORA: curtains of light over dark hills, swaying slowly, brighter with each bell; coloured by the chord
    aurora: HEAD + `
void main() {
  vec2 uv = gl_FragCoord.xy / uRes; float Hh = 150.0, py = (1.0 - uv.y) * Hh - uLook * 40.0, px = uv.x * Hh * uRes.x / uRes.y + uYaw * 120.0, q = clamp(py / Hh, 0.0, 1.0);
  vec3 c = vec3(3.0 + 8.0 * q, 5.0 + 14.0 * q, 16.0 + 26.0 * q) / 255.0 * (0.8 + uMood.y * 0.6);
  c += vec3(1.0) * stars(gl_FragCoord.xy, max(2.0, uRes.y / 260.0)) * (1.0 - q) * 0.5 * (1.0 - uW);
  float glow = 0.35 + 0.4 * uLvl + uMood.y * 0.3 + uBloom * 0.35 + uNear * 0.2 + uKick * 0.25, t = uT * 0.5 * (1.0 + uW);
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
  vec2 uv = gl_FragCoord.xy / uRes; float Hh = 150.0, py = (1.0 - uv.y) * Hh - uLook * 40.0, Ww = Hh * uRes.x / uRes.y, px = uv.x * Ww + uYaw * 120.0;
  float t = uT * 0.12 * (1.0 + uW * 1.5), d = length(vec2(px - Ww * 0.5, py - Hh * 0.5));
  float q = sin(px * 0.029 + t) + sin(py * 0.041 - t * 1.3) + sin((px + py) * 0.016 + t * 0.7) + sin(d * 0.033 - t * 0.9);
  float br = 0.35 + uMood.y * 0.45 + uLvl * 0.25 + uBloom * 0.25 + uNear * 0.15 + uKick * 0.2, k = max(0.0, (q + 1.4) / 5.4) * br;
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
  vec3 ro = vec3(uPos.x, 15.0 + uKick * 0.35, uPos.y), rd = normalize(vec3(uv.x, uv.y - 0.08, 1.0));
  rd.xy *= rot(uRoll); rd.yz *= rot(-uLook); rd.xz *= rot(uYaw);
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
    vec2 cp = rd.xz / rd.y * 30.0 + uPos * 0.4 + vec2(0.0, uT * 1.5);
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
  c *= 1.0 + uBloom * 0.25 + uKick * 0.1;
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
      const u = {}; for (const n of ["uRes", "uPos", "uT", "uLvl", "uBloom", "uW", "uZ", "uBolt", "uNear", "uYaw", "uLook", "uRoll", "uKick", "uE", "uD", "uMood", "uC1", "uC2", "uC3"]) u[n] = gl.getUniformLocation(p, n);
      progs[name] = { p, u };
    } catch (err) { console.warn("Handwave: the " + name + " scene couldn't be drawn: " + err.message); progs[name] = null; }
    return progs[name];
  }
  if (gl) { const b = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, b); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW); gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0); }
  // the colours: the mood's, turned by the chord; eased toward
  const hsl = (h, s, l) => { h = ((h % 360) + 360) % 360 / 360; const f = (n) => { const k = (n + h * 12) % 12; return l - s * Math.min(l, 1 - l) * Math.max(-1, Math.min(k - 3, 9 - k, 1)); }; return [f(0), f(8), f(4)]; };
  const col = { c1: [0.4, 0.3, 0.9], c2: [0.6, 0.3, 0.9], c3: [0.2, 0.6, 0.9] };
  let q = 0.5, frameAvg = 16, skyZ = 0, bloom = 0, bolt = 0, tPrev = 0, kickP = 0;
  // the view: it turns with the right hand across (and the head, and a lean), looks up and down with its height, banks
  // as it turns; the flight goes the way it faces
  const view = { yaw: 0, look: 0, roll: 0, x: 0, z: 0, vy: 0 };

  // ----------------------------------------------------------------------------------------- the hands, drawn ---
  const hc = $("hands"), g = hc.getContext("2d");
  let W = 0, H = 0, dpr = 1, motes = [];
  // (in pixel art, the iso scene, everything is drawn small, about 180 pixels across the short side, and shown big with
  // each pixel a sharp block; the hands too)
  const pixel = () => S.scene === "iso";
  function fit() {
    if (pixel()) { const ps = Math.min(innerWidth, innerHeight) / 180; dpr = 1 / ps; W = Math.round(innerWidth / ps); H = Math.round(innerHeight / ps); }
    else { dpr = Math.min(2, devicePixelRatio || 1); W = Math.round(innerWidth * dpr); H = Math.round(innerHeight * dpr); }
    document.documentElement.classList.toggle("pixel", pixel());
    hc.width = W; hc.height = H; sizeSky();
  }
  function sizeSky() { const k = pixel() ? 1 : q; skyEl.width = Math.max(2, Math.round(W * k)); skyEl.height = Math.max(2, Math.round(H * k)); }
  addEventListener("resize", fit); fit();
  const toC = (p) => [(1 - p.x) * W, p.y * H];
  function onViz(m) {
    viz = m;
    if (m.kick) { kickP = 1; kickTotal += m.kick; for (const t of trails) t.pulse = 1; }
    if (m.stab) bloom = Math.min(1, bloom + 0.15);
    const hr = current().r;
    for (const n of m.notes || []) {
      const [x, y] = hr ? handPoint(hr) : [W / 2, H / 2];
      motes.push({ x: x + (Math.random() - 0.5) * 70 * dpr, y: y + (Math.random() - 0.5) * 70 * dpr, h: (n % 12) * 30, life: 1, r: Math.max(1, (1.5 + Math.random() * 2.2) * dpr), vy: -0.04 });
    }
    if (motes.length > 140) motes.splice(0, motes.length - 140);
  }
  // a ring from the right hand (or the middle) on each new chord
  let rings = [], kickTotal = 0;
  function chordRing() { const hr = current().r, [x, y] = hr ? handPoint(hr) : [W / 2, H * 0.45]; rings.push({ x, y, t: 0 }); if (rings.length > 12) rings.shift(); }
  // the trails: where each hand has been, fading
  const trails = [{ pts: [], pulse: 0 }, { pts: [], pulse: 0 }];
  const handPoint = (h) => (h.lm ? toC(h.lm[9]) : h.touch ? [h.px * dpr, h.py * dpr] : [h.x * W, (1 - h.y) * H]);
  // the look: light painted in the air, not wire. A stroke in layers (a wide faint glow, a brighter body, a white-hot
  // core) is the light; no blur filters (they're slow)
  const glowLine = (pts, w, rgb, a) => {
    if (pts.length < 2) return;
    const path = () => { g.beginPath(); g.moveTo(pts[0][0], pts[0][1]); for (let i = 1; i < pts.length - 1; i++) { const mx = (pts[i][0] + pts[i + 1][0]) / 2, my = (pts[i][1] + pts[i + 1][1]) / 2; g.quadraticCurveTo(pts[i][0], pts[i][1], mx, my); } g.lineTo(pts[pts.length - 1][0], pts[pts.length - 1][1]); };
    for (const [k, al] of [[3.2, 0.07], [1.8, 0.16], [1, 0.45]]) { g.strokeStyle = `rgba(${rgb},${al * a})`; g.lineWidth = w * k; path(); g.stroke(); }
    g.strokeStyle = `rgba(255,255,255,${0.75 * a})`; g.lineWidth = Math.max(1, w * 0.28); path(); g.stroke();
  };
  const orb = (x, y, r, rgb, a) => { const gr = g.createRadialGradient(x, y, 0, x, y, r); gr.addColorStop(0, `rgba(255,255,255,${a})`); gr.addColorStop(0.25, `rgba(${rgb},${a * 0.8})`); gr.addColorStop(1, `rgba(${rgb},0)`); g.fillStyle = gr; g.fillRect(x - r, y - r, r * 2, r * 2); };
  const FINGERS = [[1, 2, 3, 4], [5, 6, 7, 8], [9, 10, 11, 12], [13, 14, 15, 16], [17, 18, 19, 20]], PALM = [0, 1, 5, 9, 13, 17];
  const tipsWas = [[], []];
  // a hand: each finger a stroke of light, the palm lit from inside, the fingertips bright (sparks fly off them as they
  // move); bigger and brighter as it comes nearer, a pulse on the kick
  function drawHand(h, rgb, now, pulse = 0, side = 0) {
    g.save(); g.globalCompositeOperation = "lighter"; g.lineCap = "round"; g.lineJoin = "round";
    if (h.lm) {
      const P = (k) => toC(h.lm[k]), sc = Math.hypot(P(0)[0] - P(9)[0], P(0)[1] - P(9)[1]), w = sc * (0.09 + h.z * 0.04) * (1 + pulse * 0.25), a = 0.7 + h.z * 0.3;
      // the palm
      const [cx, cy] = P(9).map((v, i) => (v + P(0)[i]) / 2), pg = g.createRadialGradient(cx, cy, 0, cx, cy, sc * 1.1);
      pg.addColorStop(0, `rgba(${rgb},${0.38 * a + pulse * 0.2})`); pg.addColorStop(1, `rgba(${rgb},0)`);
      g.fillStyle = pg; g.beginPath(); PALM.forEach((k, i) => { const [x, y] = P(k); i ? g.lineTo(x, y) : g.moveTo(x, y); }); g.closePath(); g.fill();
      orb(cx, cy, sc * (1.6 + h.z * 0.8), rgb, 0.18 + h.z * 0.12 + pulse * 0.15);
      // the fingers, from the wrist's side out
      for (const f of FINGERS) glowLine([f[0] === 1 ? P(0) : P(f[0]), ...f.map(P)].filter((_, i) => i > 0 || f[0] === 1), w, rgb, a);
      // the fingertips; sparks when they move fast
      const was = tipsWas[side];
      TIP.forEach((k, i) => {
        const [x, y] = P(k); orb(x, y, w * (2.6 + pulse), rgb, 0.9);
        if (was[i]) { const sp = Math.hypot(x - was[i][0], y - was[i][1]) / dpr; if (sp > 6 && motes.length < 220) for (let j = 0; j < Math.min(3, sp / 8); j++) motes.push({ x, y, h: side ? 275 : 185, life: 0.7, r: Math.max(1, (1 + Math.random() * 1.6) * dpr), vy: -0.01 + (Math.random() - 0.5) * 0.04, vx: (x - was[i][0]) * 0.02 + (Math.random() - 0.5) * 0.6 }); }
        was[i] = [x, y];
      });
    } else {
      // a finger on the glass: a ball of light, bigger the longer it's held
      const [cx, cy] = handPoint(h), R = (22 + h.z * 40 + pulse * 10) * dpr;
      orb(cx, cy, R * 2.4, rgb, 0.35 + h.z * 0.25); orb(cx, cy, R * 0.6, rgb, 0.9);
      g.strokeStyle = `rgba(${rgb},0.5)`; g.lineWidth = 2 * dpr; g.beginPath(); g.arc(cx, cy, R * (0.9 + 0.05 * Math.sin(now / 300)), 0, 6.283); g.stroke();
    }
    g.restore();
  }
  // the face: a constellation, its points glimmering on the beat; the eyes and the lips drawn in light; the lips glow as
  // the mouth opens
  const EYE_L = [33, 160, 158, 133, 153, 144, 33], EYE_R = [362, 385, 387, 263, 373, 380, 362];
  const LIPS = [61, 185, 40, 39, 37, 0, 267, 269, 270, 409, 291, 375, 321, 405, 314, 17, 84, 181, 91, 146, 61];
  function drawFace(f) {
    const P = (k) => toC(f.lm[k]), rgb = "255,150,225", pulse = kickP * 0.6, sc = Math.hypot(P(33)[0] - P(263)[0], P(33)[1] - P(263)[1]) || 40 * dpr;
    g.save(); g.globalCompositeOperation = "lighter"; g.lineCap = "round"; g.lineJoin = "round";
    const [cx, cy] = P(1); orb(cx, cy, sc * 2.2, rgb, 0.1 + pulse * 0.08);
    g.fillStyle = `rgba(255,215,245,${0.35 + pulse * 0.4})`;
    const d = Math.max(1, sc * 0.018);
    for (let i = 0; i < f.lm.length; i += 2) { const [x, y] = P(i); g.fillRect(x - d / 2, y - d / 2, d, d); }
    glowLine(OVAL.map(P), sc * 0.03, rgb, 0.45);
    glowLine(EYE_L.map(P), sc * 0.035, rgb, 0.8); glowLine(EYE_R.map(P), sc * 0.035, rgb, 0.8);
    glowLine(LIPS.map(P), sc * (0.04 + f.mouth * 0.05), rgb, 0.7 + f.mouth * 0.3);
    if (f.mouth > 0.15) { const [mx, my] = [(P(13)[0] + P(14)[0]) / 2, (P(13)[1] + P(14)[1]) / 2]; orb(mx, my, sc * (0.4 + f.mouth * 0.9), rgb, 0.3 + f.mouth * 0.5); }
    g.restore();
  }
  // the body: soft limbs of warm light, the chest glowing; brighter the more you dance
  const LIMBS = [[11, 13, 15], [12, 14, 16], [23, 25, 27], [24, 26, 28], [11, 12], [23, 24], [11, 23], [12, 24]];
  function drawBody(lm) {
    const P = (k) => toC(lm[k]), ok = (k) => (lm[k].visibility ?? 1) > 0.35, dn = body.dance || 0, rgb = "255,200,110";
    const sc = Math.hypot(P(11)[0] - P(12)[0], P(11)[1] - P(12)[1]) || 80 * dpr, a = 0.35 + dn * 0.5 + kickP * dn * 0.3;
    g.save(); g.globalCompositeOperation = "lighter"; g.lineCap = "round"; g.lineJoin = "round";
    if (ok(11) && ok(12)) { const [x1, y1] = P(11), [x2, y2] = P(12), hy = ok(23) ? P(23)[1] : y1 + sc; orb((x1 + x2) / 2, (y1 + y2 + hy * 2) / 4, sc * 1.3, rgb, 0.12 + dn * 0.15); }
    for (const L of LIMBS) { const pts = L.filter(ok).map(P); if (pts.length === L.length) glowLine(pts, sc * 0.07, rgb, a); }
    for (const k of [15, 16]) if (ok(k)) { const [x, y] = P(k); orb(x, y, sc * 0.35, rgb, 0.4 + dn * 0.4); }
    g.restore();
  }

  // the strip: four dials that turn as you move (blue the pitch and green the swell, the right hand's; white the groove and
  // orange the filter, the left hand's), and a little black display (the tempo, the mood, the sound's line, who's seen)
  const DIALS = [["dPitch", () => viz.pitch], ["dSwell", () => Math.min(1, viz.near + (viz.mouth || 0) * 0.3)], ["dGroove", () => viz.energy], ["dFilter", () => viz.drive]].map(([id, f]) => {
    const el = $(id); return { f, val: el.querySelector(".val"), tick: el.querySelector(".tick"), num: el.querySelector(".num"), shown: -1 };
  });
  const scope = $("scope"), sg = scope.getContext("2d"), hist = new Float32Array(96);
  let histI = 0, scopeT = 0;
  function drawStrip(now) {
    if (!started || !S.dials) return;
    for (const d of DIALS) {
      const v = clamp(d.f() || 0, 0, 1), q2 = Math.round(v * 99);
      if (q2 === d.shown) continue;
      d.shown = q2; d.val.setAttribute("stroke-dasharray", `${(v * 100).toFixed(1)} 100`);
      d.tick.setAttribute("transform", `rotate(${(135 + v * 270).toFixed(1)})`); d.num.textContent = String(q2).padStart(2, "0");
    }
    if (now - scopeT < 33) return;
    scopeT = now;
    hist[histI++ % hist.length] = Math.min(1, viz.level * 5 + kickP * 0.4);
    const w = scope.clientWidth * dpr, h = scope.clientHeight * dpr;
    if (scope.width !== Math.round(w)) { scope.width = Math.round(w); scope.height = Math.round(h); }
    sg.clearRect(0, 0, scope.width, scope.height); sg.strokeStyle = "#e9f2e4"; sg.lineWidth = 1.5 * dpr; sg.beginPath();
    const n = hist.length;
    for (let i = 0; i < n; i++) { const v = hist[(histI + i) % n], x = (i / (n - 1)) * scope.width, y = scope.height / 2 + Math.sin(i * 0.9 + now / 120) * v * scope.height * 0.42; i ? sg.lineTo(x, y) : sg.moveTo(x, y); }
    sg.stroke();
    $("lcdBpm").textContent = MOODS[S.mood].tempo + " BPM"; $("lcdMood").textContent = (paused ? "PAUSED" : S.mood).toUpperCase();
    const h2 = current();
    $("dotHands").classList.toggle("on", !!(h2.r || h2.l)); $("dotFace").classList.toggle("on", !!(face && S.face)); $("dotBody").classList.toggle("on", !!(body && S.body));
  }

  // ------------------------------------------------------------------------------------------- a frame ---
  function frame(now) {
    const dt = Math.min(0.1, tPrev ? (now - tPrev) / 1000 : 0.016); tPrev = now;
    if (started) { touchUpdate(); sendHands(); }
    // no right hand for a while: the chords wander by themselves
    if (started && !paused && now - rightSeenT > 15000 && now - wanderT > 14000) { wanderT = now; if (now - rightSeenT > 16000) { zone = clamp(zone + (Math.random() < 0.5 ? -1 : 1), 0, 5); if (zone === 0 || zone === 5) zone = Math.random() < 0.5 ? 1 : 4; sendChord(); } }
    // the colours, toward the chord's
    const M = MOODS[S.mood], hue = M.hue + zone * 32 + viz.drive * 25, sat = 0.7 + viz.drive * 0.2;
    for (const [k, h] of [["c1", hue], ["c2", hue + 55], ["c3", hue - 50]]) { const t = hsl(h, sat, 0.58); for (let i = 0; i < 3; i++) col[k][i] = lerp(col[k][i], t[i], Math.min(1, dt * 1.2)); }
    if (now - chordT < 60) bloom = 1;
    bloom *= Math.pow(0.25, dt); bolt *= Math.pow(0.02, dt);
    // the view
    const hh = current(), fYaw = face && S.face ? face.yaw : 0, bLean = body && S.body ? body.lean : 0;
    const wantYaw = clamp((hh.r ? (hh.r.x - 0.5) * 1.3 : Math.sin(now / 20000) * 0.25) + fYaw * 0.7 + bLean * 0.6, -1.4, 1.4);
    const wantLook = hh.r ? (hh.r.y - 0.5) * 0.35 : 0, oldYaw = view.yaw;
    view.yaw = lerp(view.yaw, wantYaw, Math.min(1, dt * 5)); view.look = lerp(view.look, wantLook, Math.min(1, dt * 5));
    view.vy = lerp(view.vy, (view.yaw - oldYaw) / Math.max(dt, 0.001), Math.min(1, dt * 4));
    view.roll = lerp(view.roll, clamp(-view.vy * 0.25, -0.5, 0.5) + (face && S.face ? face.roll * 0.6 : 0), Math.min(1, dt * 5));
    const speed = 4 + viz.near * 6 + viz.energy * 5 + (viz.dance || 0) * 4;
    view.x += Math.sin(view.yaw) * speed * dt; view.z += Math.cos(view.yaw) * speed * dt; skyZ = view.z;
    kickP *= Math.pow(0.004, dt);
    if (gl) {
      const P = prog(S.scene);
      if (P) {
        gl.viewport(0, 0, skyEl.width, skyEl.height); gl.useProgram(P.p); const u = P.u;
        gl.uniform2f(u.uRes, skyEl.width, skyEl.height); gl.uniform1f(u.uT, now / 1000); gl.uniform1f(u.uLvl, Math.min(1, viz.level * 5));
        gl.uniform1f(u.uBloom, bloom); gl.uniform1f(u.uW, 0); gl.uniform1f(u.uZ, skyZ); gl.uniform1f(u.uBolt, bolt); gl.uniform1f(u.uNear, viz.near);
        gl.uniform1f(u.uE, viz.energy); gl.uniform1f(u.uD, viz.drive);
        gl.uniform2f(u.uPos, view.x, view.z); gl.uniform1f(u.uYaw, view.yaw); gl.uniform1f(u.uLook, view.look); gl.uniform1f(u.uRoll, view.roll); gl.uniform1f(u.uKick, kickP * Math.min(1, viz.energy * 2.5));
        gl.uniform2f(u.uMood, current().r ? current().r.x : 0.5, 0.25 + viz.pitch * 0.6);
        gl.uniform3fv(u.uC1, col.c1); gl.uniform3fv(u.uC2, col.c2); gl.uniform3fv(u.uC3, col.c3);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
      }
      // the quality: lighter when frames are slow, finer when there's room
      frameAvg = lerp(frameAvg, dt * 1000, 0.05); if (pixel()) frameAvg = 16.7;
      if (frameAvg > 20 && q > 0.3) { q = Math.max(0.3, q - 0.08); sizeSky(); frameAvg = 16.7; }
      else if (frameAvg < 14 && q < 0.85) { q = Math.min(0.85, q + 0.03); sizeSky(); frameAvg = 16.7; }
    }
    // the hands and the motes
    g.clearRect(0, 0, W, H);
    for (const m of motes) { m.life -= dt * (m.vx !== undefined ? 1.2 : 0.3); m.y += m.vy * H * dt; m.x += (m.vx || 0) * dt * 60 + Math.sin(now / 900 + m.h) * dt * 6 * dpr; if (m.vx) m.vx *= 0.96; }
    motes = motes.filter((m) => m.life > 0);
    g.globalCompositeOperation = "lighter";
    for (const m of motes) { const rg = g.createRadialGradient(m.x, m.y, 0, m.x, m.y, m.r * 5); rg.addColorStop(0, `hsla(${m.h},100%,82%,${m.life})`); rg.addColorStop(1, `hsla(${m.h},100%,60%,0)`); g.fillStyle = rg; g.fillRect(m.x - m.r * 5, m.y - m.r * 5, m.r * 10, m.r * 10); }
    g.globalCompositeOperation = "source-over";
    // the body and the face, faint; the trails, the rings; the hands over them
    if (body && S.body && body.lm) drawBody(body.lm);
    if (face && S.face && face.lm) drawFace(face);
    const h = current();
    [h.r, h.l].forEach((hd, i) => {
      const T = trails[i]; T.pulse *= Math.pow(0.01, dt);
      if (hd) { T.pts.push({ p: handPoint(hd), t: now }); } while (T.pts.length && now - T.pts[0].t > 700) T.pts.shift();
      if (T.pts.length > 1) {
        g.save(); g.globalCompositeOperation = "lighter"; g.lineCap = "round"; g.lineJoin = "round";
        for (let j = 1; j < T.pts.length; j++) { const a = T.pts[j - 1].p, b2 = T.pts[j].p, f = j / T.pts.length; g.strokeStyle = (i ? "rgba(196,140,255," : "rgba(43,240,255,") + (f * (0.35 + T.pulse * 0.4)) + ")"; g.lineWidth = (2 + f * 10 + T.pulse * 6) * dpr; g.beginPath(); g.moveTo(a[0], a[1]); g.lineTo(b2[0], b2[1]); g.stroke(); }
        g.restore();
      }
    });
    for (const rg of rings) rg.t += dt;
    rings = rings.filter((rg) => rg.t < 1.4);
    g.save(); g.globalCompositeOperation = "lighter";
    for (const rg of rings) { const f = rg.t / 1.4; g.strokeStyle = `rgba(255,255,255,${(1 - f) * 0.6})`; g.lineWidth = (3 - f * 2) * dpr; g.beginPath(); g.arc(rg.x, rg.y, 20 * dpr + f * Math.min(W, H) * 0.5, 0, 6.283); g.stroke(); }
    g.restore();
    if (h.r) drawHand(h.r, "60,235,255", now, trails[0].pulse, 0); else tipsWas[0] = [];
    if (h.l) drawHand(h.l, "200,140,255", now, trails[1].pulse, 1); else tipsWas[1] = [];
    drawStrip(now);
    $("hint").textContent = !started ? "" : handsOn && !h.r && !h.l && !face && !body ? "Step into the camera's view" : !handsOn && !h.r && !h.l && now - startT < 9000 ? "Touch and drag, or tap the hand to use the camera" : "";
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  // ------------------------------------------------------------------------------------------ the controls ---
  let startT = 0;
  function begin() {
    if (started) return;
    started = true; startT = performance.now(); $("start").classList.add("is-gone"); $("strip").hidden = !S.dials;
    audio().then(() => post({ type: "on", on: true }));
  }
  // the start: choose what the camera follows, then start with it, or without (touch and drag)
  const drawFollow = () => { document.querySelectorAll("[data-follow]").forEach((b) => b.setAttribute("aria-pressed", String(!!S[b.dataset.follow]))); $("startCam").disabled = !S.hands && !S.face && !S.body; };
  document.querySelectorAll("[data-follow]").forEach((b) => b.addEventListener("click", () => { S[b.dataset.follow] = !S[b.dataset.follow]; save(); drawFollow(); drawMenu(); }));
  $("startCam").addEventListener("click", () => { begin(); startHands(); });
  $("startTouch").addEventListener("click", begin);
  drawFollow();
  const show = (d) => { if (!d.open) d.showModal(); };
  for (const d of document.querySelectorAll("dialog")) d.addEventListener("click", (e) => { if (e.target === d) d.close(); });
  const SCENES = ["iso", "sky", "aurora", "nebula"];
  $("sceneBtn").addEventListener("click", () => { S.scene = SCENES[(SCENES.indexOf(S.scene) + 1) % SCENES.length]; save(); fit(); drawMenu(); });
  $("menuBtn").addEventListener("click", () => { drawMenu(); show($("menuSheet")); });
  $("helpBtn").addEventListener("click", () => { $("menuSheet").close(); show($("helpSheet")); });
  $("pauseBtn").addEventListener("click", () => { paused = !paused; begin(); post({ type: "on", on: !paused }); drawMenu(); });
  $("dialsBtn").addEventListener("click", () => { S.dials = !S.dials; save(); drawMenu(); $("strip").hidden = !S.dials || !started; });
  $("vol").addEventListener("input", () => { S.vol = +$("vol").value; sendParams(); save(); });
  for (const k of ["hands", "face", "body"]) $(k + "Follow").addEventListener("click", () => { S[k] = !S[k]; save(); drawMenu(); drawFollow(); if (!S[k]) { if (k === "face") face = null; else if (k === "body") body = null; else camHands = { r: null, l: null }; } else if (handsOn) loadFaceBody(); });
  document.querySelectorAll("[data-set]").forEach((sg) => sg.addEventListener("click", (e) => {
    const b = e.target.closest("button"); if (!b) return;
    S[sg.dataset.set] = b.dataset.v; save(); drawMenu(); if (sg.dataset.set === "scene") fit();
    if (sg.dataset.set === "mood") { lastNotes = null; sendChord(true); sendParams(); }
  }));
  function drawMenu() {
    document.querySelectorAll("[data-set]").forEach((sg) => sg.querySelectorAll("button").forEach((b) => b.setAttribute("aria-pressed", String(S[sg.dataset.set] === b.dataset.v))));
    $("vol").value = S.vol; $("pauseBtn").textContent = paused ? "Play" : "Pause";
    for (const k of ["hands", "face", "body"]) $(k + "Follow").setAttribute("aria-pressed", String(!!S[k]));
    $("dialsBtn").setAttribute("aria-pressed", String(!!S.dials));
  }
  addEventListener("keydown", (e) => { if (e.code === "Space" && !e.target.closest("dialog") && started) { e.preventDefault(); $("pauseBtn").click(); } });
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
    readHand, handsToControl, makeHand, current, setHands: (h) => { testHands = h; }, setCamHands: (lms) => { camHands = handsToControl(lms, camHands); }, gl: () => !!gl, scenesOk: () => SCENES.map((n) => !!(gl && prog(n))),
    view: () => ({ ...view }), pixelSize: () => [skyEl.width, skyEl.height, hc.width], dial: (i) => DIALS[i].shown, setFace: (f) => { face = f; }, setBody: (b) => { body = b; }, readFace, readBody, rings: () => rings.length, kicks: () => kickTotal, trackers: () => ({ hand: !!handTr, face: !!faceTr, pose: !!poseTr }) };
})();
