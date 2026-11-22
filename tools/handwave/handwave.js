// SPDX-License-Identifier: GPL-3.0-only
// Handwave: an ambient house chord machine you play with your hands. The pads (seven chords, all in key), the flavours
// (what kind of chord), a soft groove, the arpeggiator and Drift (a generative bed on your chord: the sound engine is
// handwave-worklet.js), the chord memory, and the camera, used only to see your hands (MediaPipe's hand tracker; no
// picture is shown or kept): the right hand's height picks the chord and a pinch plays it, the left hand's fingers pick
// the flavour. The stage shows your hands in neon over a slow aurora. MIDI in (any key plays a chord in key) and out.
"use strict";
(() => {
  const T = globalThis.HWTheory, $ = (id) => document.getElementById(id), app = $("app");
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

  // ------------------------------------------------------------------------------------------- the state ---
  const KEY = "handwave-state";
  const DEF = { key: 9, scale: "minor", flavour: 1, hold: false, tempo: 116, memory: Array(8).fill(null),
    p: { sound: "saw", cutoff: 0.6, reso: 0.2, attack: 0.3, release: 1.4, swing: 0.55, arp: "off", arpRate: 16, strum: 0.12, bass: "sub", drums: "deep",
         pump: 0.35, delay: 0.32, verb: 0.5, vol: 0.8, chordVol: 0.8, bassVol: 0.8, drumVol: 0.65, drift: 0.6, texture: "vinyl", bells: true } };
  const S = (() => { try { const s = JSON.parse(localStorage.getItem(KEY) || "null"); if (s) return { ...DEF, ...s, p: { ...DEF.p, ...(s.p || {}) }, memory: (s.memory || DEF.memory).slice(0, 8) }; } catch {} return structuredClone(DEF); })();
  if (!T.SCALES[S.scale]) S.scale = "minor";             // (a scale that's gone: minor)
  delete S.mask; delete S.pic;                            // (from before: what's gone, or changed)
  if (S.p.sound === "stab") S.p.sound = "organ";
  if (!["off", "deep", "dub", "garage", "breaks", "halftime"].includes(S.p.drums)) S.p.drums = "deep";
  if (!["off", "sub", "deep", "dub"].includes(S.p.bass)) S.p.bass = "sub";
  let saveT = 0;
  const save = () => { clearTimeout(saveT); saveT = setTimeout(() => { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch {} }, 250); };

  // ------------------------------------------------------------------------------------------- the sound ---
  let ctx = null, node = null, ready = null;
  function audio() {
    if (ready) { if (ctx.state !== "running") ctx.resume().catch(() => {}); return ready; }
    try { if (navigator.audioSession) navigator.audioSession.type = "playback"; } catch {}
    ctx = new AudioContext({ latencyHint: "interactive" });
    ready = ctx.audioWorklet.addModule("handwave-worklet.js").then(() => {
      node = new AudioWorkletNode(ctx, "handwave", { numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [2] });
      node.connect(ctx.destination);
      node.port.onmessage = (e) => { if (e.data.type === "viz") onViz(e.data); };
      sendParams(); sendProg();
      ctx.resume().catch(() => {});
    }).catch((err) => toast("The sound couldn't start: " + err.message));
    return ready;
  }
  const post = (m) => { if (node) node.port.postMessage(m); };
  const sendParams = () => post({ type: "params", p: { ...S.p, tempo: S.tempo } });
  // (the browser lets it sound from the first touch or key)
  for (const t of ["pointerdown", "keydown"]) addEventListener(t, () => audio(), { capture: true, passive: true });

  // ------------------------------------------------------------------------------------------- the chords ---
  const hue = (d) => [280, 320, 350, 30, 190, 220, 250][d];
  let cur = null, curDeg = -1, lastNotes = null;           // the chord sounding, its degree
  // a chord on a degree, voiced as near the last one as it can be (smooth changes); voicing 0: as it stands (the labels)
  function build(deg, flavour = S.flavour, voicing) {
    const c = T.chord(S.key, S.scale, deg, flavour, 0, 0);
    return voicing === 0 ? c : T.nearest(c, lastNotes);
  }
  // play a chord: on the pads, a key, a hand; vel 0..1, dir +1 down / -1 up (a strum's way)
  function play(deg, opts = {}) {
    audio().then(() => {
      const c = opts.chord || build(deg, opts.flavour);
      cur = c; curDeg = deg; lastNotes = c.notes;
      post({ type: "chord", notes: c.notes, root: c.root, vel: opts.vel == null ? 0.85 : opts.vel, dir: opts.dir || 1 });
      midiChord(c.notes, opts.vel);
      drawNow(); drawPads();
      ripple(deg, opts.at);
      if (memRec && !opts.fromMemory) record(c, deg);
    });
  }
  function release(force) {
    if (S.hold && !force) return;
    post({ type: "release" }); midiChord(null);
    curDeg = -1; drawPads();
  }

  // ------------------------------------------------------------------------------------------ the pads ---
  const padsEl = $("pads"), flavEl = $("flavours");
  const FINGERS = ["fist", "1", "2", "3", "4", "open"];
  flavEl.innerHTML = T.FLAVOURS.map((f, i) => `<button type="button" class="flav" role="radio" data-f="${i}" aria-checked="false"><b>${f.name}</b><i aria-hidden="true">${i === 0 ? "&#9679;" : i === 5 ? "&#9995;" : "&#8226;".repeat(i)}</i></button>`).join("");
  padsEl.innerHTML = [0, 1, 2, 3, 4, 5, 6].map((d) => `<button type="button" class="pad" data-d="${d}" style="--h:${hue(d)}"><small></small><b></b></button>`).join("");
  function drawPads() {
    padsEl.querySelectorAll(".pad").forEach((p) => {
      const d = +p.dataset.d, c = build(d, S.flavour, 0);
      p.querySelector("small").textContent = c.numeral; p.querySelector("b").textContent = c.name;
      p.classList.toggle("is-on", d === curDeg);
      p.setAttribute("aria-label", `${c.numeral}: ${c.name}`);
    });
    flavEl.querySelectorAll(".flav").forEach((b) => b.setAttribute("aria-checked", String(+b.dataset.f === S.flavour)));
  }
  function drawNow() {
    $("nowName").textContent = cur ? cur.name : "—";
    $("nowNum").textContent = cur ? cur.numeral + " · " + T.NAMES[S.key] + " " + T.SCALES[S.scale].name.toLowerCase() : "tap a pad";
  }
  function setFlavour(f, fromHand) {
    if (f === S.flavour) return;
    S.flavour = f; save(); drawPads();
    if (curDeg >= 0 && (fromHand || padDown.size)) play(curDeg);   // (a held chord takes the new flavour)
  }
  flavEl.addEventListener("click", (e) => { const b = e.target.closest(".flav"); if (b) setFlavour(+b.dataset.f); });
  // the pads: a finger down plays; slide to another pad to change chord; up lets go (unless Hold)
  const padDown = new Map();
  const padAt = (x, y) => { const el = document.elementFromPoint(x, y); return el && el.closest ? el.closest(".pad") : null; };
  padsEl.addEventListener("pointerdown", (e) => {
    const p = e.target.closest(".pad"); if (!p) return;
    e.preventDefault(); try { padsEl.setPointerCapture(e.pointerId); } catch {}
    const d = +p.dataset.d; padDown.set(e.pointerId, d);
    const r = p.getBoundingClientRect(), vel = clamp(0.55 + (1 - (e.clientY - r.top) / r.height) * 0.45, 0.4, 1);   // (higher on the pad, louder)
    play(d, { vel });
  });
  padsEl.addEventListener("pointermove", (e) => {
    if (!padDown.has(e.pointerId)) return;
    const p = padAt(e.clientX, e.clientY); if (!p) return;
    const d = +p.dataset.d; if (d === padDown.get(e.pointerId)) return;
    padDown.set(e.pointerId, d); play(d, { vel: 0.75, dir: d > curDeg ? 1 : -1 });
  });
  const padUp = (e) => { if (!padDown.has(e.pointerId)) return; padDown.delete(e.pointerId); if (!padDown.size) release(); };
  padsEl.addEventListener("pointerup", padUp); padsEl.addEventListener("pointercancel", padUp);
  // the keyboard: 1 to 7 the chords, Q W E R T Y the flavours, Space plays
  const keyDeg = { Digit1: 0, Digit2: 1, Digit3: 2, Digit4: 3, Digit5: 4, Digit6: 5, Digit7: 6 }, keyFl = { KeyQ: 0, KeyW: 1, KeyE: 2, KeyR: 3, KeyT: 4, KeyY: 5 };
  const keysDown = new Set();
  addEventListener("keydown", (e) => {
    if (e.repeat || e.metaKey || e.ctrlKey || e.target.closest("input, select, dialog")) return;
    if (e.code in keyDeg) { keysDown.add(e.code); play(keyDeg[e.code]); e.preventDefault(); }
    else if (e.code in keyFl) { setFlavour(keyFl[e.code], true); e.preventDefault(); }
    else if (e.code === "Space") { setPlaying(!playing); e.preventDefault(); }
  });
  addEventListener("keyup", (e) => { if (e.code in keyDeg) { keysDown.delete(e.code); if (!keysDown.size) release(); } });

  // ------------------------------------------------------------------------------- the bar and the sheets ---
  let playing = false;
  function setPlaying(on) {
    audio().then(() => { playing = on; post({ type: "play", on }); $("play").setAttribute("aria-pressed", String(on)); $("play").querySelector("span").textContent = on ? "Stop" : "Play"; });
  }
  $("play").addEventListener("click", () => setPlaying(!playing));
  document.querySelectorAll("[data-tempo]").forEach((b) => b.addEventListener("click", () => { S.tempo = clamp(S.tempo + +b.dataset.tempo, 60, 180); $("tempo").textContent = S.tempo; sendParams(); save(); }));
  { // tempo: drag up or down too
    const el = document.querySelector(".tempo span"); let y0 = null, t0 = 0;
    el.addEventListener("pointerdown", (e) => { y0 = e.clientY; t0 = S.tempo; el.setPointerCapture(e.pointerId); });
    el.addEventListener("pointermove", (e) => { if (y0 == null) return; S.tempo = clamp(Math.round(t0 + (y0 - e.clientY) / 4), 60, 180); $("tempo").textContent = S.tempo; sendParams(); });
    el.addEventListener("pointerup", () => { y0 = null; save(); });
  }
  const show = (d) => { if (!d.open) d.showModal(); };
  for (const d of document.querySelectorAll("dialog")) d.addEventListener("click", (e) => { if (e.target === d) d.close(); });
  $("keyBtn").addEventListener("click", () => show($("keySheet")));
  $("soundBtn").addEventListener("click", () => show($("soundSheet")));
  $("grooveBtn").addEventListener("click", () => show($("grooveSheet")));
  $("arpBtn").addEventListener("click", () => show($("arpSheet")));
  $("driftBtn").addEventListener("click", () => show($("driftSheet")));
  $("menuBtn").addEventListener("click", () => show($("menuSheet")));
  $("helpBtn").addEventListener("click", () => { $("menuSheet").close(); show($("helpSheet")); });
  $("keyGrid").innerHTML = T.NAMES.map((n, i) => `<button type="button" data-key="${i}">${n}</button>`).join("");
  $("scaleGrid").innerHTML = Object.entries(T.SCALES).map(([id, s]) => `<button type="button" data-scale="${id}">${s.name}</button>`).join("");
  $("keyGrid").addEventListener("click", (e) => { const b = e.target.closest("button"); if (!b) return; S.key = +b.dataset.key; lastNotes = null; save(); drawAll(); });
  $("scaleGrid").addEventListener("click", (e) => { const b = e.target.closest("button"); if (!b) return; S.scale = b.dataset.scale; lastNotes = null; save(); drawAll(); });
  // the segments (data-set) and the sliders (data-p)
  const SOUNDS = { saw: "Pad", keys: "Keys", organ: "Organ", pluck: "Pluck" }, GROOVES = { off: "Off", deep: "Deep", dub: "Dub", garage: "Garage", breaks: "Breaks", halftime: "Half-time" };
  const ARPS = { off: "Off", up: "Up", down: "Down", updown: "Up-down" }, TEXTURES = { none: "None", vinyl: "Vinyl", rain: "Rain", ocean: "Ocean", birds: "Birds" };
  const driftName = () => (S.p.drift <= 0 ? "Off" : TEXTURES[S.p.texture] && S.p.texture !== "none" ? TEXTURES[S.p.texture] : "On");
  if (!ARPS[S.p.arp]) S.p.arp = "up";
  if (![8, 16, 24].includes(S.p.arpRate)) S.p.arpRate = 16;
  document.querySelectorAll("[data-set]").forEach((sg) => sg.addEventListener("click", (e) => {
    const b = e.target.closest("button"); if (!b) return;
    const k = sg.dataset.set, v = b.dataset.v;
    S.p[k] = k === "arpRate" ? +v : k === "bells" ? v === "on" : v;
    if (k === "texture" && v !== "none" && S.p.drift <= 0) S.p.drift = 0.6;   // (a texture: Drift on)
    sendParams(); save(); drawAll();
    if (k === "sound" && curDeg >= 0) play(curDeg);
  }));
  document.querySelectorAll("input[data-p]").forEach((i) => i.addEventListener("input", () => { S.p[i.dataset.p] = +i.value; sendParams(); save(); if (i.dataset.p === "drift") drawAll(); }));
  $("holdBtn").addEventListener("click", () => { S.hold = !S.hold; save(); drawAll(); if (!S.hold && !padDown.size && !keysDown.size && !handPlaying) release(true); });
  function drawAll() {
    $("keyName").textContent = T.NAMES[S.key] + " " + T.SCALES[S.scale].name.toLowerCase();
    $("keyShort").textContent = T.NAMES[S.key] + ({ major: "", minor: "m", dorian: " dor", harmonic: " hm", hijaz: " hij" }[S.scale] || "");
    $("soundName").textContent = SOUNDS[S.p.sound]; $("grooveName").textContent = GROOVES[S.p.drums]; $("arpName").textContent = ARPS[S.p.arp];
    $("tempo").textContent = S.tempo;
    $("holdBtn").setAttribute("aria-pressed", String(S.hold));
    $("driftName").textContent = driftName(); $("driftBtn").dataset.on = S.p.drift > 0 ? "1" : "";
    $("keyGrid").querySelectorAll("button").forEach((b) => b.setAttribute("aria-pressed", String(+b.dataset.key === S.key)));
    $("scaleGrid").querySelectorAll("button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.scale === S.scale)));
    document.querySelectorAll("[data-set]").forEach((sg) => sg.querySelectorAll("button").forEach((b) => {
      const k = sg.dataset.set, v = k === "bells" ? (S.p.bells ? "on" : "off") : S.p[k];
      b.setAttribute("aria-pressed", String(String(v) === b.dataset.v));
    }));
    document.querySelectorAll("input[data-p]").forEach((i) => { if (document.activeElement !== i) i.value = S.p[i.dataset.p]; });
    drawPads(); drawNow(); drawSlots();
  }

  // -------------------------------------------------------------------------------------- chord memory ---
  // Rec: each chord played goes into the next slot; Loop: the slots, a bar each, round and round (the groove starts)
  let memRec = false, recAt = 0, progNow = -1;
  const slotsEl = $("slots");
  slotsEl.innerHTML = S.memory.map((_, i) => `<button type="button" class="slot" data-i="${i}"></button>`).join("");
  function drawSlots() {
    slotsEl.querySelectorAll(".slot").forEach((b) => {
      const i = +b.dataset.i, m = S.memory[i];
      b.textContent = m ? m.name : String(i + 1); b.classList.toggle("is-set", !!m);
      b.classList.toggle("is-next", memRec && i === recAt); b.classList.toggle("is-now", i === progNow);
      b.setAttribute("aria-label", "Slot " + (i + 1) + (m ? ": " + m.name : ", empty"));
    });
    $("memRec").setAttribute("aria-pressed", String(memRec)); $("memLoop").setAttribute("aria-pressed", String(!!S.loop));
  }
  function record(c, deg) {
    S.memory[recAt] = { notes: c.notes, root: c.root, name: c.name, deg };
    recAt = (recAt + 1) % 8; if (recAt === 0) { memRec = false; toast("Eight chords in memory: tap Loop to play them"); }
    save(); drawSlots(); sendProg();
  }
  const sendProg = () => post({ type: "prog", on: !!S.loop, slots: S.memory.map((m) => (m ? { notes: m.notes, root: m.root } : null)) });
  $("memRec").addEventListener("click", () => {
    memRec = !memRec;
    if (memRec) { const e = S.memory.findIndex((m) => !m); recAt = e < 0 ? 0 : e; toast("Recording: each chord you play goes into the next slot"); }
    drawSlots();
  });
  $("memLoop").addEventListener("click", () => {
    if (!S.memory.some(Boolean)) { toast("Nothing in memory yet: tap Rec, then play some chords"); return; }
    S.loop = !S.loop; save(); sendProg(); drawSlots();
    if (S.loop && !playing) setPlaying(true);
    if (!S.loop) { progNow = -1; drawSlots(); }
  });
  $("memClear").addEventListener("click", () => {
    if (!S.memory.some(Boolean)) return;
    const was = S.memory.slice(); S.memory = Array(8).fill(null); S.loop = false; progNow = -1; recAt = 0; save(); sendProg(); drawSlots();
    toast("Memory cleared", "Undo", () => { S.memory = was; save(); sendProg(); drawSlots(); });
  });
  slotsEl.addEventListener("click", (e) => {             // a slot: in Rec, the next to fill; otherwise, play it
    const b = e.target.closest(".slot"); if (!b) return; const i = +b.dataset.i, m = S.memory[i];
    if (memRec) { recAt = i; drawSlots(); return; }
    if (m) { play(m.deg, { chord: { notes: m.notes, root: m.root, name: m.name, numeral: T.chord(S.key, S.scale, m.deg, 0).numeral }, fromMemory: true }); setTimeout(() => { if (!padDown.size && !handPlaying && !keysDown.size) release(); }, 900); }
  });

  // --------------------------------------------------------------------------------------- the stage ---
  // no picture: a slow aurora in the chord's colours (breathing with the sound, a pulse on the kick), Drift's bells as
  // motes rising, a ripple for each chord played (from the pinch, with hands), and the hands themselves in neon
  const cv = $("stage"), g = cv.getContext("2d"), video = $("cam");
  let W = 0, H = 0, dpr = 1, viz = { step: -1, level: 0, kick: false, voices: [], drift: [], bells: [] }, kickT = 0, rings = [], motes = [];
  function fit() { const r = cv.getBoundingClientRect(); dpr = Math.min(2, devicePixelRatio || 1); W = Math.max(2, Math.round(r.width * dpr)); H = Math.max(2, Math.round(r.height * dpr)); cv.width = W; cv.height = H; }
  new ResizeObserver(fit).observe($("stageBox")); fit();
  function onViz(m) {
    viz = m; if (m.kick) kickT = performance.now();
    for (const n of m.bells || []) motes.push({ x: (0.08 + ((n % 12) / 12) * 0.84 + (Math.random() - 0.5) * 0.06) * W, y: H * (0.7 + Math.random() * 0.25), h: (n % 12) * 30, life: 1, r: (2 + Math.random() * 2.5) * dpr });
    if (motes.length > 80) motes.splice(0, motes.length - 80);
    if (m.prog !== progNow && S.loop) { progNow = m.prog; drawSlots(); const s = S.memory[m.prog]; if (s) { cur = { ...(cur || {}), name: s.name, numeral: T.chord(S.key, S.scale, s.deg, 0).numeral }; curDeg = s.deg; drawNow(); drawPads(); ripple(s.deg); setTimeout(() => { if (curDeg === s.deg && !padDown.size && !handPlaying && !keysDown.size) { curDeg = -1; drawPads(); } }, 300); } }
  }
  // a ripple: rings spreading from where the chord was played (the middle of the stage, from a pad or a key)
  function ripple(deg, at) {
    const [x, y] = at || [W / 2, H * 0.45];
    for (let k = 0; k < 3; k++) rings.push({ x, y, h: hue(deg), t: -k * 0.16 });
    if (rings.length > 30) rings.splice(0, rings.length - 30);
  }
  let tPrev = 0, auraH = 280;
  function frame(now) {
    const dt = Math.min(0.05, tPrev ? (now - tPrev) / 1000 : 0.016), t = now / 1000; tPrev = now;
    g.setTransform(1, 0, 0, 1, 0, 0); g.globalCompositeOperation = "source-over";
    const kick = Math.max(0, 1 - (now - kickT) / 400), lvl = Math.min(1, (viz.level || 0) * 4);
    // the colour drifts toward the chord's
    const want = curDeg >= 0 ? hue(curDeg) : auraH, dh = ((want - auraH + 540) % 360) - 180; auraH = (auraH + dh * Math.min(1, dt * 1.5) + 360) % 360;
    const bg = g.createLinearGradient(0, 0, 0, H); bg.addColorStop(0, "#04030c"); bg.addColorStop(0.6, `hsl(${auraH},45%,7%)`); bg.addColorStop(1, "#020208");
    g.fillStyle = bg; g.fillRect(0, 0, W, H);
    // the aurora: three slow ribbons
    g.globalCompositeOperation = "lighter";
    const breathe = 0.5 + 0.5 * Math.sin(t * 0.4), driftOn = (viz.drift || []).length > 0;
    for (let k = 0; k < 3; k++) {
      const hh = auraH + (k - 1) * 28, base = H * (0.28 + k * 0.13), amp = H * (0.07 + lvl * 0.05), a = (0.07 + lvl * 0.12 + kick * 0.05 + (driftOn ? 0.05 : 0)) * (0.7 + 0.3 * breathe);
      const gr = g.createLinearGradient(0, base - H * 0.25, 0, base + H * 0.12);
      gr.addColorStop(0, `hsla(${hh},90%,60%,0)`); gr.addColorStop(0.7, `hsla(${hh},90%,62%,${a})`); gr.addColorStop(1, `hsla(${hh + 20},90%,55%,0)`);
      g.fillStyle = gr; g.beginPath(); g.moveTo(0, H);
      for (let x = 0; x <= W + 1; x += W / 24) { const y = base + Math.sin(x / W * 5 + t * (0.15 + k * 0.07) + k * 2) * amp + Math.sin(x / W * 11 - t * 0.2 + k) * amp * 0.35; g.lineTo(x, y); }
      g.lineTo(W, H); g.closePath(); g.fill();
    }
    // the bells: motes rising, fading
    for (const m of motes) { m.life -= dt * 0.22; m.y -= dt * H * 0.05; m.x += Math.sin(t + m.h) * dt * 4 * dpr; }
    motes = motes.filter((m) => m.life > 0);
    for (const m of motes) { const rg = g.createRadialGradient(m.x, m.y, 0, m.x, m.y, m.r * 5); rg.addColorStop(0, `hsla(${m.h},100%,80%,${m.life})`); rg.addColorStop(1, `hsla(${m.h},100%,60%,0)`); g.fillStyle = rg; g.fillRect(m.x - m.r * 5, m.y - m.r * 5, m.r * 10, m.r * 10); }
    // the ripples
    for (const r of rings) r.t += dt;
    rings = rings.filter((r) => r.t < 1.8);
    for (const r of rings) { if (r.t < 0) continue; const f = r.t / 1.8; g.strokeStyle = `hsla(${r.h},100%,70%,${(1 - f) * 0.7})`; g.lineWidth = (3 - f * 2) * dpr; g.beginPath(); g.arc(r.x, r.y, 12 * dpr + f * Math.min(W, H) * 0.45, 0, 6.283); g.stroke(); }
    // the notes sounding: a soft glow along the bottom
    const lo = 36, hi = 96, kw = W / (hi - lo);
    for (const n of viz.voices || []) { const x = (n - lo) * kw; g.fillStyle = `hsla(${(n % 12) * 30},100%,65%,.6)`; g.fillRect(x, H - 4 * dpr, kw * 0.9, 4 * dpr); }
    g.globalCompositeOperation = "source-over";
    if (handsOn || demoT) drawHands(now);
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  // ------------------------------------------------------------------------------------------- the hands ---
  // the camera's picture, mirrored (as a mirror would show you); the hand on the right picks the chord with its height
  // and plays it with a pinch; the hand on the left picks the flavour with its fingers and brightens with its height
  const TIP = [4, 8, 12, 16, 20], BONES = [[0, 1], [1, 2], [2, 3], [3, 4], [0, 5], [5, 6], [6, 7], [7, 8], [5, 9], [9, 10], [10, 11], [11, 12], [9, 13], [13, 14], [14, 15], [15, 16], [13, 17], [17, 18], [18, 19], [19, 20], [0, 17]];
  const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  // one hand, read: where (mirrored), how big, pinched or not, how many fingers up
  function readHand(lm) {
    const size = dist(lm[0], lm[9]) || 0.1, ext = (tip, pip) => dist(lm[0], lm[tip]) > dist(lm[0], lm[pip]) * 1.18;
    let fingers = [[8, 6], [12, 10], [16, 14], [20, 18]].filter(([t, p]) => ext(t, p)).length;
    if (dist(lm[4], lm[9]) > size * 0.82 && dist(lm[4], lm[5]) > size * 0.45) fingers++;   // (the thumb, out to the side)
    return { x: 1 - lm[9].x, y: lm[9].y, size, pinch: dist(lm[4], lm[8]) / size, fingers, lm };
  }
  // the hands to the controls (pure: the tests feed it made-up hands): { chord: {deg, voicing, pinch} | null, flav: {fingers, y} | null }
  const HS = { deg: -1, pinched: false, fl: -1, flN: 0, flCand: -1 };
  function handsToControl(hands, st = HS) {
    const hs = hands.map(readHand).sort((a, b) => a.x - b.x);
    let ch = null, fl = null;
    if (hs.length >= 2) { fl = hs[0]; ch = hs[hs.length - 1]; } else if (hs.length === 1) { if (hs[0].x > 0.42) ch = hs[0]; else fl = hs[0]; }
    const out = { chord: null, flav: null };
    if (ch) {
      const z = clamp((1 - (ch.y - 0.12) / 0.76) * 7, 0, 6.999), near = Math.floor(z);
      if (st.deg < 0 || Math.abs(z - (st.deg + 0.5)) > 0.62) st.deg = near;   // (a little stickiness at the borders)
      if (!st.pinched && ch.pinch < 0.36) st.pinched = true; else if (st.pinched && ch.pinch > 0.55) st.pinched = false;
      const vz = clamp(Math.floor(((ch.x - 0.5) / 0.5) * 3), 0, 2);
      out.chord = { deg: st.deg, pinch: st.pinched, voicing: vz, x: ch.x, y: ch.y, lm: ch.lm };
    } else st.pinched = false;
    if (fl) {
      const f = clamp(fl.fingers, 0, 5);
      if (f === st.flCand) st.flN++; else { st.flCand = f; st.flN = 1; }
      if (st.flN >= 3) st.fl = f;                         // (three frames the same: a real change, not a flicker)
      out.flav = { flavour: st.fl < 0 ? null : st.fl, y: fl.y, x: fl.x, lm: fl.lm, fingers: f };
    }
    return out;
  }
  let camOn = false, handsOn = false, lastHands = { chord: null, flav: null }, handPlaying = false, prevY = 0, demoT = 0;
  // a point the camera saw (0..1) to the stage, mirrored (as a mirror shows you)
  const toC = (p) => [(1 - p.x) * W, p.y * H];
  const pinchAt = (c) => { if (!c.lm) return null; const [x1, y1] = toC(c.lm[4]), [x2, y2] = toC(c.lm[8]); return [(x1 + x2) / 2, (y1 + y2) / 2]; };
  function applyHands(ctl) {
    lastHands = ctl;
    if (ctl.flav) {
      if (ctl.flav.flavour != null) setFlavour(ctl.flav.flavour, true);
      S.p.cutoff = clamp(1.05 - ctl.flav.y, 0.25, 1); sendParams();
    }
    const c = ctl.chord;
    if (c && c.pinch) {
      const dir = c.y < prevY ? -1 : 1;
      if (!handPlaying || c.deg !== curDeg) { handPlaying = true; play(c.deg, { vel: 0.85, dir, at: pinchAt(c) }); }
    } else if (handPlaying) { handPlaying = false; if (!padDown.size && !keysDown.size) release(); }
    if (c) prevY = c.y;
    $("hint").textContent = !ctl.chord && !ctl.flav ? (handsOn ? "Raise your hands in front of the camera" : "")
      : ctl.chord && !ctl.chord.pinch ? "Pinch to play · move up or down for another chord" : ctl.chord ? "Let go to stop · left hand: fingers for the flavour" : "Right hand: pinch to play";
  }
  // the hands, in neon: the chord hand cyan, the flavour hand violet; the chord's name by the right hand (bright when
  // it plays), the flavour's by the left; the seven chord heights as faint ticks down the right edge
  function drawHands(now) {
    const fs = Math.round(13 * dpr), z0 = 0.12 * H, zh = (0.76 * H) / 7, c = lastHands.chord, f = lastHands.flav;
    g.textBaseline = "middle"; g.lineCap = "round"; g.lineJoin = "round";
    g.font = `600 ${Math.round(11 * dpr)}px ui-rounded, system-ui, sans-serif`; g.textAlign = "right";
    for (let d = 0; d < 7; d++) {
      const y = z0 + (6 - d) * zh + zh / 2, on = c && c.deg === d;
      g.fillStyle = on ? `hsla(${hue(d)},100%,75%,.95)` : "rgba(255,255,255,.22)";
      g.fillRect(W - (on ? 22 : 12) * dpr, y - 1 * dpr, (on ? 18 : 8) * dpr, 2 * dpr);
      g.fillText(build(d, S.flavour, 0).numeral, W - 28 * dpr, y);
    }
    for (const h of [c, f]) {
      if (!h || !h.lm) continue;
      const P = (k) => toC(h.lm[k]), isC = h === c, pin = isC && h.pinch, col = isC ? (pin ? `hsl(${hue(h.deg)},100%,68%)` : "#2bf0ff") : "#c48cff";
      g.save(); g.globalCompositeOperation = "lighter"; g.shadowColor = col; g.shadowBlur = (pin ? 22 : 12) * dpr;
      g.strokeStyle = col; g.lineWidth = (pin ? 4 : 3) * dpr; g.beginPath();
      for (const [a, b] of BONES) { const [x1, y1] = P(a), [x2, y2] = P(b); g.moveTo(x1, y1); g.lineTo(x2, y2); } g.stroke();
      g.fillStyle = "#fff"; for (const k of TIP) { const [x, y] = P(k); g.beginPath(); g.arc(x, y, 3.5 * dpr, 0, 6.283); g.fill(); }
      g.restore();
      // the label above the hand
      const pts = h.lm.map(toC), top = Math.min(...pts.map((q) => q[1])), xs = pts.map((q) => q[0]), cx = clamp((Math.min(...xs) + Math.max(...xs)) / 2, 70 * dpr, W - 70 * dpr);
      const ly = Math.max(fs * 1.6, top - fs * 2.6);
      g.textAlign = "center";
      if (isC) {
        const ch = build(h.deg, S.flavour, 0);
        g.font = `800 ${Math.round(fs * (pin ? 1.9 : 1.5))}px ui-rounded, system-ui, sans-serif`; g.fillStyle = pin ? "#fff" : "rgba(255,255,255,.6)";
        g.fillText(ch.name, cx, ly); g.font = `600 ${fs}px ui-rounded, system-ui, sans-serif`; g.fillStyle = pin ? `hsl(${hue(h.deg)},100%,75%)` : "rgba(43,240,255,.75)";
        g.fillText(pin ? ch.numeral : ch.numeral + " · pinch to play", cx, ly + fs * 1.5);
        // the pinch: a ring between thumb and finger
        const [x1, y1] = P(4), [x2, y2] = P(8); g.strokeStyle = pin ? "#fff" : "rgba(255,255,255,.35)"; g.lineWidth = (pin ? 3 : 1.5) * dpr;
        g.beginPath(); g.arc((x1 + x2) / 2, (y1 + y2) / 2, (pin ? 14 + 3 * Math.sin(now / 120) : 9) * dpr, 0, 6.283); g.stroke();
      } else {
        const fl = T.FLAVOURS[S.flavour], n = h.fingers;
        g.font = `800 ${Math.round(fs * 1.4)}px ui-rounded, system-ui, sans-serif`; g.fillStyle = "#e3ccff"; g.fillText(fl.name, cx, ly);
        g.font = `600 ${fs}px ui-rounded, system-ui, sans-serif`; g.fillStyle = "rgba(196,140,255,.8)";
        g.fillText((n === 0 ? "fist" : n >= 5 ? "open hand" : n + " up") + " · higher is brighter", cx, ly + fs * 1.5);
      }
    }
    if (demoT) { g.font = `700 ${fs}px ui-rounded, system-ui, sans-serif`; g.fillStyle = "rgba(255,210,63,.9)"; g.textAlign = "center"; g.fillText("DEMO", W / 2, 14 * dpr); }
    g.textAlign = "left";
  }
  // the camera, only to see the hands (never shown, never kept); MediaPipe's hand tracker from a CDN the first time (then
  // the browser keeps it)
  const MP = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14";
  const MODELS = "https://storage.googleapis.com/mediapipe-models/";
  let vision = null, files = null, handTr = null, camLoop = 0;
  async function visionLib() {
    if (!vision) { toast("Loading the hand tracker (the first time takes a moment)…"); vision = await import(/* webpackIgnore: true */ MP + "/vision_bundle.mjs"); files = await vision.FilesetResolver.forVisionTasks(MP + "/wasm"); }
    return vision;
  }
  async function cameraOn() {
    if (camOn) return;
    const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user", width: { ideal: 640 }, height: { ideal: 480 } }, audio: false });
    video.srcObject = stream; await video.play(); camOn = true;
    let lastT = -1; const me = ++camLoop;
    const loop = () => {
      if (!camOn || me !== camLoop) return;
      if (video.readyState >= 2 && video.currentTime !== lastT) {
        lastT = video.currentTime;
        if (handsOn && handTr) applyHands(handsToControl(handTr.detectForVideo(video, performance.now()).landmarks || []));
      }
      requestAnimationFrame(loop);
    };
    loop();
  }
  function cameraOff() { camOn = false; const st = video.srcObject; if (st) st.getTracks().forEach((t) => t.stop()); video.srcObject = null; }
  const camErr = (err) => toast(err && err.name === "NotAllowedError" ? "The camera wasn't allowed: allow it in the browser's settings to play with your hands" : "The camera couldn't start: " + (err.message || err), null, null, 7000);
  async function startHands() {
    try {
      toast("Starting the camera (only to see your hands)…");
      await cameraOn();
      const v = await visionLib();
      if (!handTr) handTr = await v.HandLandmarker.createFromOptions(files, { baseOptions: { modelAssetPath: MODELS + "hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task", delegate: "GPU" }, runningMode: "VIDEO", numHands: 2 });
      handsOn = true; $("handsBtn").setAttribute("aria-pressed", "true");
      toast("Hands on: right hand pinches to play, left hand's fingers pick the flavour");
    } catch (err) { stopHands(); camErr(err); }
  }
  function stopHands() {
    handsOn = false; $("handsBtn").setAttribute("aria-pressed", "false");
    if (handPlaying) { handPlaying = false; release(); }
    lastHands = { chord: null, flav: null }; $("hint").textContent = "";
    cameraOff();
  }
  $("handsBtn").addEventListener("click", () => (handsOn ? stopHands() : startHands()));
  document.addEventListener("visibilitychange", () => { if (document.hidden && camOn) stopHands(); });
  // made-up hands (the demo, and the tests): a hand at (x, y) on the camera's picture, pinching or not, so many fingers up
  function makeHand(x, y, { pinch = false, fingers = 4, s = 0.22 } = {}) {
    const lm = Array.from({ length: 21 }, () => ({ x: 0, y: 0, z: 0 })), P = (k, dx, dy) => { lm[k] = { x: x + dx * s, y: y + dy * s, z: 0 }; };
    P(0, 0, 0.55); P(9, 0, 0);
    const cols = [[5, -0.28], [9, -0.05], [13, 0.16], [17, 0.34]];
    cols.forEach(([b, dx], i) => {
      const up = i < Math.min(4, fingers - (fingers >= 5 ? 1 : 0)) || (fingers >= 5);
      P(b, dx, i === 1 ? 0 : 0.03 * Math.abs(i - 1));
      if (up) { P(b + 1, dx * 1.05, -0.32); P(b + 2, dx * 1.08, -0.5); P(b + 3, dx * 1.1, -0.66); }
      else { P(b + 1, dx, -0.18); P(b + 2, dx * 0.9, -0.02); P(b + 3, dx * 0.8, 0.1); }
    });
    // the thumb: out to the side (a fifth finger), tucked in, or touching the index's tip (a pinch)
    P(1, -0.32, 0.42); P(2, -0.48, 0.28); P(3, -0.58, 0.14);
    if (pinch) lm[4] = { ...lm[8] };
    else if (fingers >= 5) P(4, -0.86, -0.02); else P(4, -0.3, 0.12);
    return lm;
  }
  // the demo: the hands play I, vi, IV, V, changing flavour on the way
  function runDemo() {
    $("menuSheet").close(); $("helpSheet").close();
    audio(); if (demoT) return;
    demoT = performance.now(); toast("The demo: watch the hands (it plays by itself)");
    const steps = [[0, 0], [5, 1], [3, 2], [4, 4], [0, 1], [5, 0], [3, 5], [4, 1]];
    const tick = () => {
      if (!demoT) return;
      const t = (performance.now() - demoT) / 1000, i = Math.floor(t / 1.6);
      if (i >= steps.length) { demoT = 0; applyHands({ chord: null, flav: null }); toast("Your turn: tap the pads, or turn on Hands"); return; }
      const [deg, fl] = steps[i], ph = (t % 1.6) / 1.6, pinch = ph > 0.15 && ph < 0.85;
      const yy = 0.12 + (1 - (deg + 0.5) / 7) * 0.76;
      const right = makeHand(0.25, yy, { pinch }), left = makeHand(0.78, 0.35 + Math.sin(t) * 0.1, { fingers: fl });
      applyHands(handsToControl([right, left]));
      requestAnimationFrame(tick);
    };
    tick();
  }
  $("demoBtn").addEventListener("click", runDemo); $("helpDemo").addEventListener("click", runDemo);

  // -------------------------------------------------------------------------------------------- MIDI ---
  let midiOut = null, midiNotes = [];
  function midiChord(notes, vel = 0.85) {
    if (!midiOut) return;
    for (const n of midiNotes) midiOut.send([0x80, n, 0]);
    midiNotes = notes ? notes.slice() : [];
    for (const n of midiNotes) midiOut.send([0x90, n, Math.round(clamp(vel, 0.1, 1) * 127)]);
  }
  $("midiBtn").addEventListener("click", async () => {
    if (!navigator.requestMIDIAccess) { $("midiMsg").textContent = "This browser has no MIDI (try Chrome or Edge)."; return; }
    try {
      const acc = await navigator.requestMIDIAccess();
      const held = new Map();
      const hook = () => {
        for (const inp of acc.inputs.values()) inp.onmidimessage = (e) => {
          const [st, n, v] = e.data, cmd = st & 0xf0;
          if (cmd === 0x90 && v > 0) { const d = T.degreeOf(S.key, S.scale, n); held.set(n, d); play(d, { vel: v / 127 }); }
          else if (cmd === 0x80 || (cmd === 0x90 && v === 0)) { held.delete(n); if (!held.size) release(); else { const last = [...held.values()].pop(); if (last !== curDeg) play(last); } }
        };
        const sel = $("midiOut"), was = sel.value;
        sel.innerHTML = '<option value="">Nowhere</option>' + [...acc.outputs.values()].map((o) => `<option value="${o.id}">${o.name.replace(/[<>&"]/g, "")}</option>`).join("");
        sel.value = was; $("midiOutRow").hidden = false;
      };
      hook(); acc.onstatechange = hook;
      $("midiOut").onchange = () => { midiOut = acc.outputs.get($("midiOut").value) || null; };
      $("midiMsg").textContent = (acc.inputs.size ? acc.inputs.size + " keyboard" + (acc.inputs.size > 1 ? "s" : "") + " in: every key plays a chord in key." : "No keyboard found yet: plug one in.");
    } catch (err) { $("midiMsg").textContent = "MIDI wasn't allowed: " + err.message; }
  });

  // ------------------------------------------------------------------------------------------ the toast ---
  let toastT = 0;
  function toast(text, label, f, ms = 3200) {
    const el = $("toast"); el.textContent = text; el.hidden = false; clearTimeout(toastT);
    if (label && f) { const b = document.createElement("button"); b.textContent = label; b.style.cssText = "margin-left:12px;color:#2bf0ff;pointer-events:auto"; b.onclick = () => { f(); el.hidden = true; }; el.appendChild(b); el.style.pointerEvents = "auto"; }
    else el.style.pointerEvents = "none";
    toastT = setTimeout(() => { el.hidden = true; }, ms);
  }

  // ------------------------------------------------------------------------------------------- the fold ---
  // a foldable, half-folded: the Viewport Segments API says where its two screens are (handwave.css measures them); a
  // browser that only knows the Device Posture API ("folded") gets the screen's halves: across when it is held wide
  // (tabletop), down the middle when held tall (book)
  const foldMQ = { tb: matchMedia("(vertical-viewport-segments: 2)"), lr: matchMedia("(horizontal-viewport-segments: 2)") };
  const applyFold = () => {
    let tb = foldMQ.tb.matches, lr = foldMQ.lr.matches;
    if (!tb && !lr && navigator.devicePosture && navigator.devicePosture.type === "folded") { if (innerWidth >= innerHeight) tb = true; else lr = true; }
    document.documentElement.classList.toggle("fold-tb", tb); document.documentElement.classList.toggle("fold-lr", lr);
  };
  for (const m of Object.values(foldMQ)) m.addEventListener("change", applyFold);
  if (navigator.devicePosture && navigator.devicePosture.addEventListener) navigator.devicePosture.addEventListener("change", applyFold);
  addEventListener("resize", applyFold); applyFold();

  // -------------------------------------------------------------------------------------------- start ---
  drawAll();
  try { if (!localStorage.getItem("handwave-seen")) { localStorage.setItem("handwave-seen", "1"); setTimeout(() => show($("helpSheet")), 400); } } catch {}
  // (browser only: an old install's service worker, and its cache, let go)
  if ("serviceWorker" in navigator) navigator.serviceWorker.getRegistrations().then((rs) => rs.forEach((r) => { if (/\/handwave\//.test(r.scope)) r.unregister(); })).catch(() => {});
  if (window.caches) caches.keys().then((ks) => ks.forEach((k) => { if (/^handwave/.test(k)) caches.delete(k); })).catch(() => {});
  // (for the tests)
  window.handwave = { S, play, release, setFlavour, handsToControl, applyHands, makeHand, readHand, runDemo, ctx: () => ctx, viz: () => viz, cur: () => cur, curDeg: () => curDeg, HS,
    camOn: () => camOn, handsOn: () => handsOn, rings: () => rings.length, motes: () => motes.length };
})();
