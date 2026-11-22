// SPDX-License-Identifier: GPL-3.0-only
// Handwave: a chord machine you play with your hands. The pads (seven chords, all in key), the flavours (what kind of
// chord), the groove and the arpeggiator (the sound engine: handwave-worklet.js), the chord memory, and the camera:
// MediaPipe's hand tracker, the right hand's height picking the chord and a pinch playing it, the left hand's fingers
// picking the flavour. MIDI in (any key plays a chord in key) and out (the chords to a synth), and a video of it all.
"use strict";
(() => {
  const T = globalThis.HWTheory, $ = (id) => document.getElementById(id), app = $("app");
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

  // ------------------------------------------------------------------------------------------- the state ---
  const KEY = "handwave-state";
  const DEF = { key: 9, scale: "minor", flavour: 0, hold: false, tempo: 122, memory: Array(8).fill(null), mask: "off", pic: "bright",
    p: { sound: "saw", cutoff: 0.72, reso: 0.25, attack: 0.04, release: 0.8, swing: 0.54, arp: "off", arpRate: 16, strum: 0, bass: "sub", drums: "house",
         pump: 0.45, delay: 0.22, verb: 0.32, vol: 0.8, chordVol: 0.8, bassVol: 0.8, drumVol: 0.75 } };
  const S = (() => { try { const s = JSON.parse(localStorage.getItem(KEY) || "null"); if (s) return { ...DEF, ...s, p: { ...DEF.p, ...(s.p || {}) }, memory: (s.memory || DEF.memory).slice(0, 8) }; } catch {} return structuredClone(DEF); })();
  if (!T.SCALES[S.scale]) S.scale = "minor";             // (a scale that's gone: minor)
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
      cur = c; curDeg = deg; lastNotes = c.notes; chordT = performance.now();
      post({ type: "chord", notes: c.notes, root: c.root, vel: opts.vel == null ? 0.85 : opts.vel, dir: opts.dir || 1 });
      midiChord(c.notes, opts.vel);
      drawNow(); drawPads();
      burstAt(deg);
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
  $("maskBtn").addEventListener("click", () => show($("maskSheet")));
  $("menuBtn").addEventListener("click", () => show($("menuSheet")));
  $("helpBtn").addEventListener("click", () => { $("menuSheet").close(); show($("helpSheet")); });
  $("keyGrid").innerHTML = T.NAMES.map((n, i) => `<button type="button" data-key="${i}">${n}</button>`).join("");
  $("scaleGrid").innerHTML = Object.entries(T.SCALES).map(([id, s]) => `<button type="button" data-scale="${id}">${s.name}</button>`).join("");
  $("keyGrid").addEventListener("click", (e) => { const b = e.target.closest("button"); if (!b) return; S.key = +b.dataset.key; lastNotes = null; save(); drawAll(); });
  $("scaleGrid").addEventListener("click", (e) => { const b = e.target.closest("button"); if (!b) return; S.scale = b.dataset.scale; lastNotes = null; save(); drawAll(); });
  // the segments (data-set) and the sliders (data-p)
  const SOUNDS = { saw: "Pad", pluck: "Pluck", stab: "Stab", keys: "Keys" }, GROOVES = { off: "Off", house: "House", garage: "Garage", techno: "Techno", breaks: "Breaks", halftime: "Half-time" };
  const ARPS = { off: "Off", up: "Up", down: "Down", updown: "Up-down" }, MASKS = { off: "Mask", wire: "Wireframe", visor: "Visor", outline: "Outline" };
  if (!ARPS[S.p.arp]) S.p.arp = "up";
  if (![8, 16, 24].includes(S.p.arpRate)) S.p.arpRate = 16;
  document.querySelectorAll("[data-set]").forEach((sg) => sg.addEventListener("click", (e) => {
    const b = e.target.closest("button"); if (!b) return;
    const k = sg.dataset.set, v = b.dataset.v;
    if (k === "mask") { S.mask = v; setMask(v); } else if (k === "pic") S.pic = v;
    else S.p[k] = k === "arpRate" ? +v : v;
    sendParams(); save(); drawAll();
    if (k === "sound" && curDeg >= 0) play(curDeg);
  }));
  document.querySelectorAll("input[data-p]").forEach((i) => i.addEventListener("input", () => { S.p[i.dataset.p] = +i.value; sendParams(); save(); }));
  $("holdBtn").addEventListener("click", () => { S.hold = !S.hold; save(); drawAll(); if (!S.hold && !padDown.size && !keysDown.size && !handPlaying) release(true); });
  function drawAll() {
    $("keyName").textContent = T.NAMES[S.key] + " " + T.SCALES[S.scale].name.toLowerCase();
    $("keyShort").textContent = T.NAMES[S.key] + ({ major: "", minor: "m", dorian: " dor", harmonic: " hm", hijaz: " hij" }[S.scale] || "");
    $("soundName").textContent = SOUNDS[S.p.sound]; $("grooveName").textContent = GROOVES[S.p.drums]; $("arpName").textContent = ARPS[S.p.arp];
    $("tempo").textContent = S.tempo;
    $("holdBtn").setAttribute("aria-pressed", String(S.hold));
    $("maskName").textContent = MASKS[S.mask]; $("maskBtn").dataset.on = S.mask !== "off" ? "1" : "";
    $("keyGrid").querySelectorAll("button").forEach((b) => b.setAttribute("aria-pressed", String(+b.dataset.key === S.key)));
    $("scaleGrid").querySelectorAll("button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.scale === S.scale)));
    document.querySelectorAll("[data-set]").forEach((sg) => sg.querySelectorAll("button").forEach((b) => {
      const k = sg.dataset.set, v = k === "mask" ? S.mask : k === "pic" ? S.pic : S.p[k];
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
  const cv = $("stage"), g = cv.getContext("2d"), video = $("cam");
  let W = 0, H = 0, dpr = 1, viz = { step: -1, level: 0, kick: false, voices: [] }, kickT = 0, parts = [];
  function fit() { const r = cv.getBoundingClientRect(); dpr = Math.min(2, devicePixelRatio || 1); W = Math.max(2, Math.round(r.width * dpr)); H = Math.max(2, Math.round(r.height * dpr)); cv.width = W; cv.height = H; }
  new ResizeObserver(fit).observe($("stageBox")); fit();
  function onViz(m) {
    viz = m; if (m.kick) kickT = performance.now();
    if (m.prog !== progNow && S.loop) { progNow = m.prog; drawSlots(); const s = S.memory[m.prog]; if (s) { cur = { ...(cur || {}), name: s.name, numeral: T.chord(S.key, S.scale, s.deg, 0).numeral }; curDeg = s.deg; drawNow(); drawPads(); burstAt(s.deg); setTimeout(() => { if (curDeg === s.deg && !padDown.size && !handPlaying && !keysDown.size) { curDeg = -1; drawPads(); } }, 300); } }
  }
  function burstAt(deg) {
    const h = hue(deg), n = 26;
    for (let i = 0; i < n; i++) { const a = (i / n) * Math.PI * 2 + Math.random() * 0.2, s = (0.25 + Math.random() * 0.5) * Math.min(W, H); parts.push({ x: W / 2, y: H * 0.42, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: 1, h }); }
    if (parts.length > 400) parts.splice(0, parts.length - 400);
  }
  let tPrev = 0;
  function frame(now) {
    const dt = Math.min(0.05, tPrev ? (now - tPrev) / 1000 : 0.016); tPrev = now;
    g.setTransform(1, 0, 0, 1, 0, 0);
    // the backdrop: the camera (mirrored, dark) or a horizon grid that pulses on the kick
    const kick = Math.max(0, 1 - (now - kickT) / 300);
    vfit = null;
    if (camOn && video.readyState >= 2) {
      g.save(); g.translate(W, 0); g.scale(-1, 1);
      const vr = video.videoWidth / video.videoHeight, cr = W / H; let sw = W, sh = H, sx = 0, sy = 0;
      if (vr > cr) { sw = H * vr; sx = (W - sw) / 2; } else { sh = W / vr; sy = (H - sh) / 2; }
      g.drawImage(video, sx, sy, sw, sh); g.restore();
      vfit = { sx, sy, sw, sh };
      g.fillStyle = `rgba(6,3,14,${S.pic === "dim" ? 0.62 : 0.2})`; g.fillRect(0, 0, W, H);
    } else {
      const grd = g.createLinearGradient(0, 0, 0, H); grd.addColorStop(0, "#0b0520"); grd.addColorStop(0.55, "#1a0838"); grd.addColorStop(1, "#05030b");
      g.fillStyle = grd; g.fillRect(0, 0, W, H);
      const hz = H * 0.62, t = now / 1000, ch = curDeg >= 0 ? hue(curDeg) : 280;
      g.strokeStyle = `hsla(${ch},90%,60%,${0.35 + kick * 0.4})`; g.lineWidth = 1.2 * dpr;
      for (let i = -12; i <= 12; i++) { g.beginPath(); g.moveTo(W / 2 + i * W * 0.02, hz); g.lineTo(W / 2 + i * W * 0.16, H); g.stroke(); }
      for (let k = 0; k < 10; k++) { const z = ((k + (t * (S.tempo / 60)) % 1) / 10), y = hz + (H - hz) * z * z; g.globalAlpha = z; g.beginPath(); g.moveTo(0, y); g.lineTo(W, y); g.stroke(); }
      g.globalAlpha = 1;
      const sunR = Math.min(W, H) * (0.16 + viz.level * 0.4 + kick * 0.02), sg = g.createLinearGradient(0, hz - sunR, 0, hz);
      sg.addColorStop(0, `hsl(${ch + 40},100%,65%)`); sg.addColorStop(1, `hsl(${ch},100%,55%)`);
      g.fillStyle = sg; g.beginPath(); g.arc(W / 2, hz, sunR, Math.PI, 0); g.fill();
    }
    // the notes sounding: a glowing keyboard along the bottom
    const lo = 36, hi = 96, kw = W / (hi - lo);
    for (const n of viz.voices || []) { const x = (n - lo) * kw; g.fillStyle = `hsla(${(n % 12) * 30},100%,65%,.85)`; g.fillRect(x, H - 6 * dpr, kw * 0.9, 6 * dpr); }
    // the bursts
    for (const p of parts) { p.life -= dt * 1.4; p.x += p.vx * dt; p.y += p.vy * dt; p.vx *= 0.96; p.vy *= 0.96; }
    parts = parts.filter((p) => p.life > 0);
    g.globalCompositeOperation = "lighter";
    for (const p of parts) { g.fillStyle = `hsla(${p.h},100%,65%,${p.life})`; g.beginPath(); g.arc(p.x, p.y, 2.2 * dpr, 0, 6.283); g.fill(); }
    g.globalCompositeOperation = "source-over";
    if (face && S.mask !== "off") drawFace(now, kick);
    if (handsOn || demoT) drawHands();
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
  let camOn = false, handsOn = false, lastHands = { chord: null, flav: null }, handPlaying = false, prevY = 0, demoT = 0, vfit = null, face = null, chordT = 0;
  // a point on the camera's picture (0..1) to the stage, mirrored, as the picture is drawn there
  const toC = (p) => (vfit && !demoT ? [W - (vfit.sx + p.x * vfit.sw), vfit.sy + p.y * vfit.sh] : [(1 - p.x) * W, p.y * H]);
  function applyHands(ctl) {
    lastHands = ctl;
    if (ctl.flav) {
      if (ctl.flav.flavour != null) setFlavour(ctl.flav.flavour, true);
      S.p.cutoff = clamp(1.05 - ctl.flav.y, 0.25, 1); sendParams();
    }
    const c = ctl.chord;
    if (c && c.pinch) {
      const dir = c.y < prevY ? -1 : 1;
      if (!handPlaying || c.deg !== curDeg) { handPlaying = true; play(c.deg, { vel: 0.85, dir }); }
    } else if (handPlaying) { handPlaying = false; if (!padDown.size && !keysDown.size) release(); }
    if (c) prevY = c.y;
    $("hint").textContent = !ctl.chord && !ctl.flav ? (handsOn ? "Raise your hands into the picture" : "")
      : ctl.chord && !ctl.chord.pinch ? "Pinch to play · move up or down for another chord" : ctl.chord ? "Let go to stop · left hand: fingers for the flavour" : "Right hand: pinch to play";
  }
  function drawHands() {
    // the zones: on the right, the seven chords (low to high); on the left, the six flavours (by fingers)
    const zx = W * 0.5, zy = (v) => (vfit && !demoT ? vfit.sy + v * vfit.sh : v * H), zh = zy(0.88) / 7 - zy(0.12) / 7, z0 = zy(0.12);
    g.font = `${Math.round(12 * dpr)}px ui-rounded, system-ui, sans-serif`; g.textBaseline = "middle";
    for (let d = 0; d < 7; d++) {
      const y = z0 + (6 - d) * zh, on = lastHands.chord && lastHands.chord.deg === d, c = build(d, S.flavour, 0);
      g.fillStyle = on ? `hsla(${hue(d)},90%,55%,.35)` : `hsla(${hue(d)},70%,40%,.10)`; g.fillRect(zx, y + 1, W - zx, zh - 2);
      g.fillStyle = on ? "#fff" : "rgba(255,255,255,.55)"; g.textAlign = "right"; g.fillText(c.numeral + "  " + c.name, W - 10 * dpr, y + zh / 2);
    }
    g.textAlign = "left";
    T.FLAVOURS.forEach((f, i) => {
      const y = z0 + i * (H * 0.76 / 6) + 10 * dpr, on = i === S.flavour;
      g.fillStyle = on ? "#c9a6ff" : "rgba(255,255,255,.45)"; g.fillText((i === 0 ? "fist" : i === 5 ? "open" : i + " up") + "  " + f.name, 10 * dpr, y);
    });
    for (const h of [lastHands.chord, lastHands.flav]) {
      if (!h || !h.lm) continue;
      const P = (k) => toC(h.lm[k]), pin = h === lastHands.chord && h.pinch;
      g.strokeStyle = h === lastHands.chord ? "rgba(43,240,255,.9)" : "rgba(196,140,255,.9)"; g.lineWidth = 3 * dpr; g.lineCap = "round";
      for (const [a, b] of BONES) { const [x1, y1] = P(a), [x2, y2] = P(b); g.beginPath(); g.moveTo(x1, y1); g.lineTo(x2, y2); g.stroke(); }
      for (const k of TIP) { const [x, y] = P(k); g.fillStyle = "#fff"; g.beginPath(); g.arc(x, y, 4 * dpr, 0, 6.283); g.fill(); }
      if (h === lastHands.chord) { const [x, y] = P(4), [x2, y2] = P(8); g.strokeStyle = pin ? "#ff3da8" : "rgba(255,255,255,.4)"; g.lineWidth = (pin ? 4 : 2) * dpr; g.beginPath(); g.arc((x + x2) / 2, (y + y2) / 2, (pin ? 16 : 10) * dpr, 0, 6.283); g.stroke(); }
    }
    if (demoT) { g.fillStyle = "rgba(255,210,63,.9)"; g.textAlign = "center"; g.fillText("DEMO", W / 2, 14 * dpr); g.textAlign = "left"; }
  }
  // the camera, shared by the hands and the mask; MediaPipe's trackers from a CDN the first time (then the browser
  // keeps them): the hand landmarker, the face landmarker
  const MP = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14";
  const MODELS = "https://storage.googleapis.com/mediapipe-models/";
  let vision = null, files = null, handTr = null, faceTr = null, FACE = null, camLoop = 0, faceFake = null;   // (faceFake: the tests' made-up face)
  async function visionLib() {
    if (!vision) { toast("Loading the tracker (the first time takes a moment)…"); vision = await import(/* webpackIgnore: true */ MP + "/vision_bundle.mjs"); files = await vision.FilesetResolver.forVisionTasks(MP + "/wasm"); }
    return vision;
  }
  async function cameraOn() {
    if (camOn) return;
    const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user", width: { ideal: 640 }, height: { ideal: 480 } }, audio: false });
    video.srcObject = stream; await video.play(); camOn = true;
    let lastT = -1, n = 0; const me = ++camLoop;
    const loop = () => {
      if (!camOn || me !== camLoop) return;
      if (video.readyState >= 2 && video.currentTime !== lastT) {
        lastT = video.currentTime; n++;
        const ts = performance.now();
        if (handsOn && handTr) applyHands(handsToControl(handTr.detectForVideo(video, ts).landmarks || []));
        if (S.mask !== "off" && faceTr && (!TOUCH || handsOn === false || n % 2 === 0)) { const res = faceTr.detectForVideo(video, ts + 0.5); face = faceFake || (res.faceLandmarks && res.faceLandmarks[0]) || null; }
      }
      requestAnimationFrame(loop);
    };
    loop();
  }
  function cameraOffIfIdle() {
    if (handsOn || S.mask !== "off") return;
    camOn = false; const st = video.srcObject; if (st) st.getTracks().forEach((t) => t.stop()); video.srcObject = null;
  }
  const camErr = (err, what) => toast(err && err.name === "NotAllowedError" ? "The camera wasn't allowed: allow it in the browser's settings for " + what : "The camera couldn't start: " + (err.message || err), null, null, 7000);
  const TOUCH = matchMedia("(pointer: coarse)").matches;
  async function startHands() {
    try {
      toast("Starting the camera…");
      await cameraOn();
      const v = await visionLib();
      if (!handTr) handTr = await v.HandLandmarker.createFromOptions(files, { baseOptions: { modelAssetPath: MODELS + "hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task", delegate: "GPU" }, runningMode: "VIDEO", numHands: 2 });
      handsOn = true; $("handsBtn").setAttribute("aria-pressed", "true");
      toast("Hands on: right hand pinches to play, left hand's fingers pick the flavour");
    } catch (err) { stopHands(); camErr(err, "the hands"); }
  }
  function stopHands() {
    handsOn = false; $("handsBtn").setAttribute("aria-pressed", "false");
    if (handPlaying) { handPlaying = false; release(); }
    lastHands = { chord: null, flav: null }; $("hint").textContent = "";
    cameraOffIfIdle();
  }
  async function setMask(v) {
    if (v === "off") { face = null; cameraOffIfIdle(); drawAll(); return; }
    try {
      await cameraOn();
      const lib = await visionLib();
      if (!faceTr) {
        faceTr = await lib.FaceLandmarker.createFromOptions(files, { baseOptions: { modelAssetPath: MODELS + "face_landmarker/face_landmarker/float16/1/face_landmarker.task", delegate: "GPU" }, runningMode: "VIDEO", numFaces: 1 });
        const F = lib.FaceLandmarker, pairs = (a) => a.map((c) => [c.start, c.end]);
        FACE = { mesh: pairs(F.FACE_LANDMARKS_TESSELATION), oval: pairs(F.FACE_LANDMARKS_FACE_OVAL), lines: pairs([...F.FACE_LANDMARKS_LEFT_EYE, ...F.FACE_LANDMARKS_RIGHT_EYE, ...F.FACE_LANDMARKS_LEFT_EYEBROW, ...F.FACE_LANDMARKS_RIGHT_EYEBROW, ...F.FACE_LANDMARKS_LIPS]) };
      }
      toast("Mask on: it follows your face (the red button records it)");
    } catch (err) { S.mask = "off"; save(); drawAll(); camErr(err, "the mask"); }
  }
  // the masks: a glowing mesh, a visor over the eyes, an outline; coloured by the chord, pulsing on the kick, flashing
  // on a new chord
  function drawFace(now, kick) {
    if (!FACE) return;
    const h = curDeg >= 0 ? hue(curDeg) : 285, flash = Math.max(0, 1 - (now - chordT) / 450), P = (k) => toC(face[k]);
    g.save(); g.globalCompositeOperation = "lighter"; g.lineCap = "round"; g.lineJoin = "round";
    const edges = (list, w, a) => { g.lineWidth = w * dpr; g.strokeStyle = `hsla(${h},100%,${62 + flash * 20}%,${a})`; g.beginPath(); for (const [i, j] of list) { const [x1, y1] = P(i), [x2, y2] = P(j); g.moveTo(x1, y1); g.lineTo(x2, y2); } g.stroke(); };
    if (S.mask === "wire") { edges(FACE.mesh, 1, 0.32 + kick * 0.3 + flash * 0.3); edges(FACE.oval, 2.5, 0.8); }
    else if (S.mask === "outline") { g.shadowColor = `hsl(${h},100%,60%)`; g.shadowBlur = (10 + kick * 14) * dpr; edges(FACE.oval, 3.5, 0.95); edges(FACE.lines, 3, 0.95); }
    else if (S.mask === "visor") {                      // over the outer corners of the eyes, tilted with the head
      const [ax, ay] = P(33), [bx, by] = P(263), cx = (ax + bx) / 2, cy = (ay + by) / 2, d = Math.hypot(bx - ax, by - ay), ang = Math.atan2(by - ay, bx - ax);
      const w = d * 1.75, ht = d * 0.48;
      g.translate(cx, cy); g.rotate(ang); g.globalCompositeOperation = "source-over";
      const gr = g.createLinearGradient(-w / 2, 0, w / 2, 0); gr.addColorStop(0, `hsla(${h + 40},100%,55%,.88)`); gr.addColorStop(1, `hsla(${h - 40},100%,55%,.88)`);
      g.fillStyle = gr; g.beginPath(); g.roundRect(-w / 2, -ht / 2, w, ht, ht * 0.45); g.fill();
      g.save(); g.clip();
      g.fillStyle = "rgba(0,0,0,.25)"; for (let y = -ht / 2; y < ht / 2; y += 3 * dpr) g.fillRect(-w / 2, y, w, 1.2 * dpr);
      const label = (cur ? cur.name + "  ·  " : "") + "HANDWAVE  ·  ", fs = ht * 0.5; g.font = `800 ${fs}px ui-rounded, system-ui, sans-serif`; g.textBaseline = "middle";
      const tw = g.measureText(label).width, off = ((now / 1000) * fs * 2.2) % tw;
      g.fillStyle = "rgba(255,255,255,.92)"; for (let x = -w / 2 - off; x < w / 2; x += tw) g.fillText(label, x, 0);
      g.restore();
      g.strokeStyle = `hsla(${h},100%,80%,${0.7 + kick * 0.3})`; g.lineWidth = (2 + flash * 3) * dpr; g.shadowColor = `hsl(${h},100%,60%)`; g.shadowBlur = 14 * dpr;
      g.beginPath(); g.roundRect(-w / 2, -ht / 2, w, ht, ht * 0.45); g.stroke();
    }
    g.restore();
  }
  $("handsBtn").addEventListener("click", () => (handsOn ? stopHands() : startHands()));
  document.addEventListener("visibilitychange", () => { if (document.hidden && camOn) { stopHands(); if (S.mask !== "off") { S.mask = "off"; setMask("off"); } } });
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

  // --------------------------------------------------------------------------------------- recording ---
  // a video of the stage with the sound (or the sound alone where video can't be made)
  let rec = null, recChunks = [], recDest = null;
  $("recBtn").addEventListener("click", async () => {
    await audio();
    if (rec) { rec.stop(); return; }
    if (!window.MediaRecorder) { toast("This browser can't record"); return; }
    if (!recDest) { recDest = ctx.createMediaStreamDestination(); node.connect(recDest); }
    let stream = recDest.stream;
    if (cv.captureStream) { stream = cv.captureStream(30); recDest.stream.getAudioTracks().forEach((t) => stream.addTrack(t)); }
    const type = ["video/mp4", "video/webm;codecs=vp9,opus", "video/webm", "audio/mp4", "audio/webm"].find((t) => MediaRecorder.isTypeSupported(t)) || "";
    try { rec = new MediaRecorder(stream, type ? { mimeType: type } : undefined); } catch (err) { toast("Can't record: " + err.message); rec = null; return; }
    recChunks = [];
    rec.ondataavailable = (e) => { if (e.data.size) recChunks.push(e.data); };
    rec.onstop = async () => {
      const blob = new Blob(recChunks, { type: rec.mimeType }), ext = /mp4/.test(rec.mimeType) ? "mp4" : "webm";
      rec = null; $("recBtn").setAttribute("aria-pressed", "false");
      const file = new File([blob], `handwave-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}.${ext}`, { type: blob.type });
      try { if (navigator.canShare && navigator.canShare({ files: [file] })) { await navigator.share({ files: [file], title: "Handwave" }); return; } } catch (err) { if (err && err.name === "AbortError") return; }
      const a = document.createElement("a"); a.href = URL.createObjectURL(file); a.download = file.name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    };
    rec.start(500); $("recBtn").setAttribute("aria-pressed", "true"); toast("Recording: tap the red button again to stop");
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
  if (S.mask !== "off") { S.mask = "off"; save(); drawAll(); }   // (the camera only on a tap: a mask from last time waits)
  try { if (!localStorage.getItem("handwave-seen")) { localStorage.setItem("handwave-seen", "1"); setTimeout(() => show($("helpSheet")), 400); } } catch {}
  if ("serviceWorker" in navigator && location.protocol === "https:") navigator.serviceWorker.register("sw.js").catch(() => {});
  // (for the tests)
  window.handwave = { S, play, release, setFlavour, handsToControl, applyHands, makeHand, readHand, runDemo, ctx: () => ctx, viz: () => viz, cur: () => cur, curDeg: () => curDeg, HS,
    setFace: (lm) => { faceFake = lm; face = lm; }, face: () => face, faceReady: () => !!FACE, camOn: () => camOn };
})();
