// SPDX-License-Identifier: GPL-3.0-only
// Acid Flower: the touch surface. The sound and the clock are acid-worklet.js; this file keeps the eight patterns and the
// knobs (saved on the device), sends them to the worklet as they change, and draws the pixel rave from what the worklet
// sends back (the step, the filter's motion, the accents and drum hits, a scrap of the waveform).
"use strict";
(() => {
  const $ = (id) => document.getElementById(id);
  const NOTE = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B", "C"];
  const LANES = [["Kick", "#FFE100"], ["Snare", "#FF8A1F"], ["Clap", "#FF2FB4"], ["Hat", "#2BF0FF"], ["Open hat", "#B4FF2B"]];
  const STORE = "acid-flower-v1";

  // ------------------------------------------------------------------------------------------ the patterns ---
  const rest = () => ({ on: false, note: 0, oct: 0, acc: false, slide: false });
  const b = (note, oct = 0, f = "") => ({ on: true, note, oct, acc: f.includes("a"), slide: f.includes("s") });
  const grid = (spec) => LANES.map((_, l) => { const r = new Array(16).fill(false); for (const s of spec[l] || []) r[s] = true; return r; });
  const ALL16 = [...Array(16).keys()];
  const STARTERS = [   // (written for Acid Flower: originals)
    { len: 16, bass: [b(0, 0, "a"), b(0), b(0, 1, "s"), b(0), rest(), b(3, 0, "a"), b(0), b(7, 0, "s"), b(8), b(7), b(0, 1, "a"), rest(), b(0), b(10, -1, "s"), b(0), b(3, 0, "a")],
      drums: grid([[0, 4, 8, 12], [], [4, 12], ALL16.filter((s) => s % 4 !== 2), [2, 6, 10, 14]]) },
    { len: 16, bass: [b(0, 0, "a"), rest(), b(0), b(12, 0, "s"), b(10), rest(), b(7, 0, "a"), b(0), b(0, -1), b(0, 0, "s"), b(3), b(5, 0, "a"), rest(), b(0), b(7, 0, "as"), b(5)],
      drums: grid([[0, 4, 8, 12, 15], [4, 12], [], ALL16.filter((s) => s !== 6 && s !== 14), [6, 14]]) },
    { len: 16, bass: [b(0, -1, "a"), b(0, -1), b(0, 0, "s"), b(0, -1), b(0, -1, "a"), rest(), b(3, -1), b(5, -1, "s"), b(7, -1), b(0, -1, "a"), b(0), b(0, -1), b(10, -1, "s"), b(0), b(0, -1, "a"), b(1, -1)],
      drums: grid([[0, 4, 8, 12], [], [12], [2, 6, 10], [14]]) },
    { len: 16, bass: [b(0, 0, "s"), b(7, 0, "s"), b(0, 1, "a"), rest(), b(0), b(0, 0, "a"), b(12, 0, "s"), b(10), rest(), b(0, 0, "a"), b(3, 0, "s"), b(0), b(7, 0, "a"), b(0), b(5, 0, "s"), b(3)],
      drums: grid([[0, 6, 8, 14], [], [4, 12], ALL16, []]) },
  ];
  const blank = () => ({ len: 16, bass: ALL16.map(rest), drums: grid([[0, 4, 8, 12]]) });
  const clone = (o) => JSON.parse(JSON.stringify(o));
  const DEF_PARAMS = { cutoff: 0.32, reso: 0.72, env: 0.6, decay: 0.42, accent: 0.65, drive: 0.3, delay: 0.18, volume: 0.8,
                       drums: 0.8, wave: 0, tempo: 124, swing: 0.54, tune: 0 };
  const fresh = () => ({ slots: [...STARTERS.map(clone), blank(), blank(), blank(), blank()], cur: 0, params: { ...DEF_PARAMS } });
  const valid = (s) => s && Array.isArray(s.slots) && s.slots.length === 8 && s.slots.every((p) => p && Array.isArray(p.bass) && p.bass.length === 16 &&
                       Array.isArray(p.drums) && p.drums.length === LANES.length);
  let S;
  try { S = JSON.parse(localStorage.getItem(STORE)); } catch { S = null; }
  if (!valid(S)) S = fresh();
  S.params = { ...DEF_PARAMS, ...S.params };
  let saveT = 0;
  const save = () => { clearTimeout(saveT); saveT = setTimeout(() => { try { localStorage.setItem(STORE, JSON.stringify(S)); } catch {} }, 250); };
  const pat = () => S.slots[S.cur];
  const used = (p) => p.bass.some((s) => s.on) || p.drums.some((r, l) => r.some(Boolean) && !(l === 0 && r.filter(Boolean).length === 4 && [0, 4, 8, 12].every((i) => r[i])) );

  // --------------------------------------------------------------------------------------------- the sound ---
  let ctx = null, node = null, playing = false, nextSlot = -1;
  const post = (m) => node && node.port.postMessage(m);
  const sendParams = () => post({ type: "params", params: S.params });
  const sendPattern = (atBar = false) => post({ type: "pattern", pattern: pat(), atBar });
  const wake = () => { if (ctx && ctx.state !== "running" && ctx.state !== "closed") ctx.resume().catch(() => {}); };
  for (const t of ["pointerdown", "keydown"]) addEventListener(t, wake, true);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) wake(); });
  const pref = (k, d) => { try { return localStorage.getItem("acid-flower-" + k) || d; } catch { return d; } };
  const start = async () => {
    try {
      if (!window.AudioWorkletNode) throw new Error("this browser has no AudioWorklet: update iPadOS (16.4 or later)");
      try { if (navigator.audioSession) navigator.audioSession.type = "playback"; } catch {}
      ctx = new AudioContext({ latencyHint: pref("latency", "interactive") === "playback" ? "playback" : "interactive" });
      ctx.resume().catch(() => {});
      const code = await (await fetch("acid-worklet.js", { cache: "no-cache" })).text();   // (a blob: offline it comes from the cache)
      const url = URL.createObjectURL(new Blob([code], { type: "text/javascript" }));
      await ctx.audioWorklet.addModule(url);
      URL.revokeObjectURL(url);
      node = new AudioWorkletNode(ctx, "acid-flower", { numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [2] });
      node.connect(ctx.destination);
      node.port.onmessage = (e) => { if (e.data.type === "viz") onViz(e.data); };
      sendParams();
      sendPattern();
      await ctx.resume();
      $("gate").hidden = true;
    } catch (err) {
      $("start").textContent = "Couldn’t start: " + err.message;
    }
  };
  $("start").addEventListener("click", start);
  const setPlaying = (on) => {
    playing = on;
    $("play").setAttribute("aria-pressed", String(on));
    $("play").querySelector("span").textContent = on ? "Stop" : "Play";
    post({ type: on ? "play" : "stop" });
    if (!on && nextSlot >= 0) { S.cur = nextSlot; nextSlot = -1; drawAll(); sendPattern(); }
    if (!on) markStep(-1);
  };

  // ------------------------------------------------------------------------------------------ the strips ---
  const SPEC = {
    tempo: { min: 60, max: 180, px: 5, unit: 1, fmt: (v) => Math.round(v) },
    swing: { min: 0.5, max: 0.75, px: 6, unit: 0.01, fmt: (v) => Math.round(v * 100) + "%" },
  };
  const norm = { px: 1.6, unit: 0.01, min: 0, max: 1, fmt: (v) => Math.round(v * 100) };
  const spec = (k) => SPEC[k] || norm;
  const strips = [...document.querySelectorAll(".strip")];
  const drawStrip = (el) => {
    const k = el.dataset.p, sp = spec(k), v = S.params[k];
    el.querySelector("em").textContent = sp.fmt(v);
    el.style.setProperty("--v", (100 * (v - sp.min)) / (sp.max - sp.min) + "%");
    el.setAttribute("aria-valuetext", String(sp.fmt(v)));
  };
  const setParam = (k, v) => {
    const sp = spec(k);
    S.params[k] = Math.max(sp.min, Math.min(sp.max, v));
    sendParams();
    save();
  };

  // ------------------------------------------------------------------------------------- the squelch pad ---
  const xy = $("xy");
  const drawXY = () => {
    xy.style.setProperty("--x", S.params.cutoff * 100 + "%");
    xy.style.setProperty("--y", (1 - S.params.reso) * 100 + "%");
  };

  // ------------------------------------------------------------------------------------------ the editor ---
  const bassEl = $("bass"), drumsEl = $("drums");
  const cols = [];
  for (let i = 0; i < 16; i++) {
    const c = document.createElement("div");
    c.className = "st";
    c.dataset.s = i;
    c.innerHTML = `<b class="st__n">${i + 1}</b><div class="st__note" data-s="${i}"></div>` +
                  `<button type="button" class="st__t" data-t="oct" data-s="${i}"></button>` +
                  `<button type="button" class="st__t" data-t="acc" data-s="${i}">Acc</button>` +
                  `<button type="button" class="st__t" data-t="slide" data-s="${i}">Slide</button>`;
    bassEl.appendChild(c);
    cols.push({ el: c, note: c.querySelector(".st__note"), oct: c.querySelector('[data-t="oct"]'), acc: c.querySelector('[data-t="acc"]'), sld: c.querySelector('[data-t="slide"]') });
  }
  const cells = LANES.map(([name, col], l) => {
    const n = document.createElement("button");
    n.type = "button"; n.className = "dr__name"; n.dataset.lane = l; n.textContent = name; n.style.setProperty("--c", col);
    drumsEl.appendChild(n);
    return ALL16.map((s) => {
      const d = document.createElement("div");
      d.className = "dr" + (Math.floor(s / 4) % 2 ? " q" : "");
      d.dataset.lane = l; d.dataset.s = s; d.style.setProperty("--c", col);
      drumsEl.appendChild(d);
      return d;
    });
  });
  const drawBass = () => {
    const p = pat();
    cols.forEach((c, i) => {
      const s = p.bass[i];
      c.el.classList.toggle("is-on", s.on);
      c.el.classList.toggle("is-out", i >= p.len);
      c.note.textContent = s.on ? NOTE[s.note] + (s.note === 12 ? "′" : "") : "·";
      c.note.style.setProperty("--h", String(s.note / 12));
      c.oct.textContent = s.oct > 0 ? "Up" : s.oct < 0 ? "Down" : "Oct";
      c.oct.classList.toggle("is-up", s.oct > 0); c.oct.classList.toggle("is-dn", s.oct < 0);
      c.acc.classList.toggle("is-acc", s.acc);
      c.sld.classList.toggle("is-sld", s.slide);
    });
  };
  const drawDrums = () => {
    const p = pat();
    cells.forEach((row, l) => row.forEach((d, s) => { d.classList.toggle("is-on", p.drums[l][s]); d.classList.toggle("is-out", s >= p.len); }));
  };
  const drawSlots = () => {
    $("slots").querySelectorAll(".slot").forEach((e, i) => {
      e.classList.toggle("is-cur", i === S.cur);
      e.classList.toggle("is-next", i === nextSlot);
      e.classList.toggle("is-used", used(S.slots[i]));
    });
  };
  const drawAll = () => {
    drawBass(); drawDrums(); drawSlots(); drawXY(); strips.forEach(drawStrip);
    $("len").textContent = pat().len;
    $("tune").textContent = (S.params.tune > 0 ? "+" : "") + (S.params.tune ? S.params.tune : "C");
    $("wave").textContent = S.params.wave ? "Square" : "Saw";
  };
  for (let i = 0; i < 8; i++) {
    const e = document.createElement("button");
    e.type = "button"; e.className = "slot"; e.textContent = i + 1; e.dataset.slot = i;
    $("slots").appendChild(e);
  }
  const edited = () => { sendPattern(); save(); drawSlots(); };
  const audition = (i) => {
    if (playing) return;
    const s = pat().bass[i];
    if (s.on) post({ type: "audition", note: 36 + S.params.tune + s.note + 12 * s.oct, acc: s.acc });
  };

  // ---------------------------------------------------------------------------------------------- touch ---
  const app = $("app"), ptr = new Map();
  app.addEventListener("pointerdown", (e) => {
    const t = e.target.closest && e.target.closest(".strip, .xy, .st__note, .st__t, .dr, .dr__name, .slot, #play");
    if (!t) return;
    e.preventDefault();
    if (t.id === "play") return setPlaying(!playing);
    if (t.classList.contains("slot")) {
      const i = +t.dataset.slot;
      if (playing && i !== S.cur) { nextSlot = i; post({ type: "pattern", pattern: S.slots[i], atBar: true }); }
      else { S.cur = i; nextSlot = -1; sendPattern(); }
      save(); drawAll();
      return;
    }
    if (t.classList.contains("st__t")) {
      const s = pat().bass[+t.dataset.s];
      if (t.dataset.t === "oct") s.oct = s.oct === 0 ? 1 : s.oct === 1 ? -1 : 0;
      else s[t.dataset.t] = !s[t.dataset.t];
      if (!s.on) s.on = true;
      drawBass(); edited(); audition(+t.dataset.s);
      return;
    }
    if (t.classList.contains("dr__name")) { post({ type: "hit", lane: +t.dataset.lane }); return; }
    if (t.classList.contains("dr")) {
      const l = +t.dataset.lane, s = +t.dataset.s, v = !pat().drums[l][s];
      pat().drums[l][s] = v;
      ptr.set(e.pointerId, { kind: "dr", v, last: t });
      drawDrums(); edited();
      if (v && !playing) post({ type: "hit", lane: l });
    } else if (t.classList.contains("st__note")) {
      ptr.set(e.pointerId, { kind: "note", i: +t.dataset.s, y0: e.clientY, acc: 0, moved: false });
    } else if (t.classList.contains("xy")) {
      ptr.set(e.pointerId, { kind: "xy", el: t });
      t.classList.add("is-on");
      moveXY(t, e);
    } else {
      ptr.set(e.pointerId, { kind: "strip", el: t, k: t.dataset.p, x0: e.clientX, y0: e.clientY, y: e.clientY, acc: 0, moved: false });
      t.classList.add("is-turn");
    }
    try { app.setPointerCapture(e.pointerId); } catch {}
  });
  const moveXY = (t, e) => {
    const r = t.getBoundingClientRect();
    S.params.cutoff = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
    S.params.reso = Math.max(0, Math.min(1, 1 - (e.clientY - r.top) / r.height));
    sendParams(); save(); drawXY();
  };
  app.addEventListener("pointermove", (e) => {
    const p = ptr.get(e.pointerId);
    if (!p) return;
    if (p.kind === "xy") moveXY(p.el, e);
    else if (p.kind === "dr") {                         // painting across the steps
      const el = document.elementFromPoint(e.clientX, e.clientY), d = el && el.closest && el.closest(".dr");
      if (d && d !== p.last) { p.last = d; pat().drums[+d.dataset.lane][+d.dataset.s] = p.v; drawDrums(); edited(); }
    } else if (p.kind === "note") {
      const dy = p.y0 - e.clientY;
      if (Math.abs(dy) > 8) p.moved = true;
      if (!p.moved) return;
      const steps = Math.trunc(dy / 14);
      if (steps) {
        p.y0 -= steps * 14;
        const s = pat().bass[p.i];
        s.on = true;
        s.note = Math.max(0, Math.min(12, s.note + steps));
        drawBass(); edited(); audition(p.i);
      }
    } else if (p.kind === "strip") {
      const sp = spec(p.k), d = p.y - e.clientY;
      p.y = e.clientY;
      if (Math.abs(e.clientY - p.y0) + Math.abs(e.clientX - p.x0) > 8) p.moved = true;
      if (!p.moved) return;
      p.acc += d;
      const n = Math.trunc(p.acc / sp.px);
      if (n) { p.acc -= n * sp.px; setParam(p.k, S.params[p.k] + n * sp.unit); drawStrip(p.el); }
    }
  });
  const up = (e) => {
    const p = ptr.get(e.pointerId);
    if (!p) return;
    ptr.delete(e.pointerId);
    if (p.kind === "xy") p.el.classList.remove("is-on");
    if (p.kind === "strip") {
      p.el.classList.remove("is-turn");
      if (!p.moved && e.type === "pointerup" && (p.k === "tempo" || p.k === "swing")) {   // the arrows step
        const r = p.el.getBoundingClientRect(), f = (e.clientX - r.left) / r.width, sp = spec(p.k);
        if (f < 0.3 || f > 0.7) { setParam(p.k, S.params[p.k] + (f < 0.3 ? -1 : 1) * sp.unit); drawStrip(p.el); }
      }
    }
    if (p.kind === "note" && !p.moved && e.type === "pointerup") {   // a tap: rest, or back on
      const s = pat().bass[p.i];
      s.on = !s.on;
      drawBass(); edited(); audition(p.i);
    }
  };
  for (const t of ["pointerup", "pointercancel"]) app.addEventListener(t, up);
  app.addEventListener("contextmenu", (e) => e.preventDefault());
  for (const t of ["gesturestart", "gesturechange", "dblclick"]) document.addEventListener(t, (e) => e.preventDefault(), { passive: false });
  addEventListener("keydown", (e) => {
    if (e.code === "Space" && !$("menu").open && $("gate").hidden) { e.preventDefault(); setPlaying(!playing); }
  });
  document.addEventListener("visibilitychange", () => { ptr.clear(); });

  // tabs and tools: they act on the touch itself (an instrument's buttons: no waiting for a click), or on a
  // keyboard's click (Enter / Space on a focused button: a click with no pointer, detail 0)
  const ACT = [];
  const act = (sel, f) => ACT.push([sel, f]);
  const runAct = (el) => { for (const [sel, f] of ACT) if (el.matches(sel)) { f(el); return true; } return false; };
  app.addEventListener("pointerdown", (e) => {
    const el = e.target.closest && e.target.closest(".edit__head button");
    if (el && runAct(el)) e.preventDefault();
  });
  app.addEventListener("click", (e) => {
    const el = e.target.closest && e.target.closest(".edit__head button");
    if (el && e.detail === 0) runAct(el);
  });
  act("[data-tab]", (t) => {
    document.querySelectorAll("[data-tab]").forEach((x) => x.setAttribute("aria-selected", String(x === t)));
    bassEl.hidden = t.dataset.tab !== "bass";
    drumsEl.hidden = t.dataset.tab !== "drums";
  });
  const tab = () => (bassEl.hidden ? "drums" : "bass");
  act("#wave", () => { S.params.wave = S.params.wave ? 0 : 1; sendParams(); save(); drawAll(); });
  act("[data-tune]", (x) => { S.params.tune = Math.max(-12, Math.min(12, S.params.tune + +x.dataset.tune)); sendParams(); save(); drawAll(); });
  act("[data-len]", (x) => { pat().len = Math.max(1, Math.min(16, pat().len + +x.dataset.len)); edited(); drawAll(); });
  const pick = (a) => a[Math.floor(Math.random() * a.length)];
  const SCALES = [[0, 3, 5, 7, 10, 12], [0, 1, 3, 5, 7, 8, 10, 12], [0, 2, 3, 5, 7, 10, 12], [0, 3, 7, 10, 12]];
  const randStep = (scale) => {
    const r = Math.random();
    return { on: r < 0.78, note: Math.random() < 0.45 ? 0 : pick(scale), oct: Math.random() < 0.16 ? 1 : Math.random() < 0.12 ? -1 : 0,
             acc: Math.random() < 0.28, slide: Math.random() < 0.2 };
  };
  const randomDrums = () => {
    const kick = [0, 4, 8, 12]; if (Math.random() < 0.35) kick.push(pick([3, 7, 11, 14, 15]));
    const clap = Math.random() < 0.7 ? [4, 12] : [12];
    const open = Math.random() < 0.75 ? [2, 6, 10, 14] : [];
    const dens = Math.random();
    const hat = ALL16.filter((s) => !open.includes(s) && (dens < 0.4 ? s % 2 === 1 : Math.random() < 0.8));
    const snare = Math.random() < 0.3 ? [pick([7, 15]), 12].filter((s) => !clap.includes(s)) : [];
    return grid([kick, snare, clap, hat, open]);
  };
  act("#random", () => {
    if (tab() === "bass") {
      const sc = pick(SCALES);
      pat().bass = ALL16.map(() => randStep(sc));
      pat().bass[0] = { on: true, note: 0, oct: 0, acc: true, slide: false };
    } else pat().drums = randomDrums();
    edited(); drawAll();
  });
  act("#mutate", () => {
    if (tab() === "bass") {
      const sc = pick(SCALES);
      for (let n = 0; n < 3; n++) {
        const i = Math.floor(Math.random() * pat().len), s = pat().bass[i], r = randStep(sc), f = pick(["note", "oct", "acc", "slide", "on"]);
        s[f] = r[f];
        if (f === "note") s.on = true;
      }
    } else {
      for (let n = 0; n < 2; n++) { const l = pick([1, 3, 4, 2]), s = Math.floor(Math.random() * 16); pat().drums[l][s] = !pat().drums[l][s]; }
    }
    edited(); drawAll();
  });
  act("#clear", () => {
    if (tab() === "bass") pat().bass = ALL16.map(rest);
    else pat().drums = grid([]);
    edited(); drawAll();
  });

  // ------------------------------------------------------------------------------------------ the display ---
  const markStep = (s) => {
    cols.forEach((c, i) => c.el.classList.toggle("is-now", i === s));
    cells.forEach((row) => row.forEach((d, i) => d.classList.toggle("is-now", i === s)));
  };
  let viz = { step: -1, env: 0, acc: 0, cut: S.params.cutoff, reso: S.params.reso, amp: 0, wave: new Float32Array(64) };
  let lastStep = -2, bounce = 0, flash = 0, scroll = 0, accGlow = 0, hatPulse = 0;
  const onViz = (m) => {
    viz = m;
    if (m.step !== lastStep) {
      lastStep = m.step; markStep(m.step);
      if (m.step === 0 && nextSlot >= 0) { S.cur = nextSlot; nextSlot = -1; save(); drawAll(); }
    }
    if (m.hits & 1) bounce = 1;
    if (m.hits & 4) flash = Math.max(flash, 0.55);
    if (m.hits & 24) hatPulse = 1;
    if (m.accHit) { accGlow = 1; flash = Math.max(flash, 0.25 + 0.3 * S.params.accent); }
    for (let l = 0; l < LANES.length; l++) if (m.hits & (1 << l)) {
      const n = drumsEl.querySelector(`.dr__name[data-lane="${l}"]`);
      n.classList.add("is-hit"); setTimeout(() => n.classList.remove("is-hit"), 90);
    }
  };
  const cv = $("viz"), g = cv.getContext("2d"), W = 160, H = 100, img = g.createImageData(W, H), D = img.data;
  const put = (x, y, r, gg, bb) => { x |= 0; y |= 0; if (x < 0 || y < 0 || x >= W || y >= H) return; const i = 4 * (y * W + x); D[i] = r; D[i + 1] = gg; D[i + 2] = bb; };
  const add = (x, y, r, gg, bb, a) => { x |= 0; y |= 0; if (x < 0 || y < 0 || x >= W || y >= H) return; const i = 4 * (y * W + x); D[i] += r * a; D[i + 1] += gg * a; D[i + 2] += bb * a; };
  const line = (x0, y0, x1, y1, c, a) => {
    const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0)) | 0;
    for (let i = 0; i <= n; i++) { const t = n ? i / n : 0; add(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, c[0], c[1], c[2], a); }
  };
  // a 3 x 5 pixel face for the display's words and numbers
  const FONT = { 0: "111101101101111", 1: "010110010010111", 2: "111001111100111", 3: "111001111001111", 4: "101101111001001",
    5: "111100111001111", 6: "111100111101111", 7: "111001010010010", 8: "111101111101111", 9: "111101111001111",
    A: "010101111101101", B: "110101110101110", C: "011100100100011", D: "110101101101110", E: "111100110100111",
    I: "111010010010111", L: "100100100100111", M: "101111111101101", P: "110101110100100", R: "110101110101101",
    S: "011100010001110", T: "111010010010010", Y: "101101010010010", " ": "000000000000000", "%": "101001010100101" };
  const text = (s, x, y, c) => {
    for (const ch of String(s)) {
      const f = FONT[ch] || FONT[" "];
      for (let i = 0; i < 15; i++) if (f[i] === "1") put(x + (i % 3), y + ((i / 3) | 0), c[0], c[1], c[2]);
      x += 4;
    }
  };
  const YEL = [255, 225, 0], LIME = [180, 255, 43], PINK = [255, 47, 180], CYAN = [43, 240, 255], INK = [17, 10, 2];
  const SKY = [];
  for (let y = 0; y < H; y++) { const t = y / 64; SKY.push([10 + 26 * t, 2 + 4 * t, 24 + 38 * t]); }
  let tPrev = performance.now(), T = 0;
  const frame = (now) => {
    const dt = Math.min(0.1, (now - tPrev) / 1000); tPrev = now; T += dt;
    const bpm = S.params.tempo, beat = playing ? dt * (bpm / 60) : dt * 0.15;
    scroll += beat;
    bounce *= Math.pow(0.02, dt); flash *= Math.pow(0.002, dt); accGlow *= Math.pow(0.05, dt); hatPulse *= Math.pow(0.01, dt);
    const cut = viz.cut != null ? viz.cut : S.params.cutoff, reso = viz.reso != null ? viz.reso : S.params.reso;
    const env = viz.env || 0, acc = viz.acc || 0;
    // the sky, a warehouse dark
    for (let y = 0; y < H; y++) { const c = SKY[Math.min(63, y)]; for (let x = 0; x < W; x++) { const i = 4 * (y * W + x); D[i] = c[0]; D[i + 1] = c[1]; D[i + 2] = c[2]; D[i + 3] = 255; } }
    // a few stars in the roof, on the beat
    for (let k = 0; k < 18; k++) { const x = (k * 53 + 7) % W, y = (k * 29 + 3) % 40; add(x, y, 255, 255, 255, 0.15 + 0.4 * hatPulse * ((k & 1) ? 1 : 0.3)); }
    // the lasers: they sweep with the music, more and brighter with the filter and the accents
    const beams = 3 + Math.round(cut * 4) + (accGlow > 0.3 ? 3 : 0), inten = 0.18 + 0.35 * env + 0.45 * accGlow + 0.2 * cut;
    for (let k = 0; k < beams; k++) {
      const ox = k % 3 === 0 ? 4 : k % 3 === 1 ? W - 5 : W / 2, col = [LIME, CYAN, PINK][k % 3];
      const a = Math.PI / 2 + Math.sin(T * (0.7 + 0.25 * k) + k * 1.7 + scroll * 0.5) * (0.55 + 0.35 * reso) + (k % 3 === 0 ? -0.35 : k % 3 === 1 ? 0.35 : 0);
      line(ox, 0, ox + Math.cos(a) * 140, Math.sin(a) * 140, col, inten);
    }
    // the dance floor: a checkerboard rushing in, a step at a time, lit by the kick
    for (let y = 62; y < H; y++) {
      const d = y - 58, z = 60 / d, light = 0.45 + 0.55 * bounce, fade = Math.min(1, (y - 62) / 10 + 0.3);
      for (let x = 0; x < W; x++) {
        const u = ((x - 80) * 6) / d, par = (Math.floor(u) + Math.floor(z + scroll * 2)) & 1;
        const c = par ? PINK : [60, 10, 90];
        put(x, y, c[0] * light * fade, c[1] * light * fade, c[2] * light * fade);
      }
    }
    // the squelch: the bass's own waveform, across the floor's horizon
    const w = viz.wave || [];
    let pk = 0.05; for (let j = 0; j < w.length; j++) pk = Math.max(pk, Math.abs(w[j]));
    for (let j = 0; j < 63 && w.length === 64; j++) {
      const x0 = 16 + j * 2, x1 = x0 + 2, y0 = 66 - (w[j] / pk) * 9 * Math.min(1, viz.amp * 3 + 0.2), y1 = 66 - (w[j + 1] / pk) * 9 * Math.min(1, viz.amp * 3 + 0.2);
      line(x0, y0 + 1, x1, y1 + 1, [0, 0, 0], 0.6);
      line(x0, y0, x1, y1, LIME, 0.95);
    }
    // the smiley: bounces on the kick, grins wider as the filter opens, wobbles with the resonance, rave eyes on accents
    const cx = 80, cy = 36 - bounce * 5, r = 15 + Math.round(env * 2), sq = 1 - bounce * 0.12;
    // the petals (it is an acid flower): eight round ones, pink and lime, turning with the beat and opening out with
    // the filter's sweep; an outline first, then the colour
    const spin = scroll * 0.35, pr = 5.2 + env * 1.6, pd = r + 3 + env * 3 + bounce * 2;
    for (const pass of [0, 1]) for (let k = 0; k < 8; k++) {
      const a = spin + (k * Math.PI) / 4, px = cx + Math.cos(a) * pd, py = cy + Math.sin(a) * pd * sq;
      const rr = pass ? pr : pr + 1.2, c = pass ? (k % 2 ? LIME : PINK) : INK;
      for (let y = Math.floor(-rr); y <= rr; y++) for (let x = Math.floor(-rr); x <= rr; x++)
        if (x * x + y * y <= rr * rr) put(px + x, py + y, c[0], c[1], c[2]);
    }
    for (let y = -r - 1; y <= r + 1; y++) for (let x = -r - 1; x <= r + 1; x++) {
      const dd = (x * x) / ((r + 0.5) * (r + 0.5)) + (y * y) / ((r * sq + 0.5) * (r * sq + 0.5));
      if (dd <= 1) put(cx + x, cy + y, YEL[0], YEL[1] - 20 * (x + y > r ? 1 : 0), YEL[2]);
      else if (dd <= 1.18) put(cx + x, cy + y, INK[0], INK[1], INK[2]);
    }
    if (accGlow > 0.35) {                                // rave eyes: crosses
      for (const ex of [-6, 5]) for (let i = -2; i <= 2; i++) { put(cx + ex + i, cy - 5 + i, 17, 10, 2); put(cx + ex + i, cy - 5 - i, 17, 10, 2); }
    } else {
      for (const ex of [-6, 5]) for (let y = -2; y <= 2; y++) for (let x = 0; x <= 1; x++) put(cx + ex + x, cy - 5 + y, 17, 10, 2);
    }
    const grin = 0.35 + 0.6 * cut, mw = 8 + Math.round(cut * 3);
    for (let x = -mw; x <= mw; x++) {
      const t = x / mw, wob = Math.sin(T * 9 + x * 0.9) * reso * 1.3;
      const y = cy + 4 + Math.round((1 - t * t) * 5 * grin + wob);
      put(cx + x, y, 17, 10, 2); put(cx + x, y - 1 + (Math.abs(t) > 0.85 ? 1 : 0), 17, 10, 2);
    }
    if (accGlow > 0.2) for (const ex of [-10, 9]) for (let x = 0; x < 3; x++) add(cx + ex + x, cy + 3, 255, 47, 180, accGlow);
    // the words: the tempo, the pattern, the steps
    for (let x = 0; x < W; x++) for (let y = 0; y < 8; y++) { const i = 4 * (y * W + x); D[i] *= 0.4; D[i + 1] *= 0.4; D[i + 2] *= 0.4; }
    text(Math.round(bpm) + " BPM", 2, 1, CYAN);
    text("P" + (S.cur + 1), W - 10, 1, YEL);
    const p = pat();
    for (let s = 0; s < 16; s++) {
      const x = 44 + s * 5, on = p.bass[s].on, now = s === viz.step, c = now ? YEL : on ? (p.bass[s].acc ? PINK : LIME) : [70, 50, 90];
      if (s < p.len) for (let k = 0; k < 4; k++) { put(x + k, 2, c[0], c[1], c[2]); put(x + k, 3, c[0], c[1], c[2]); if (now) put(x + k, 4, c[0], c[1], c[2]); }
    }
    if (!playing && Math.floor(T * 2) % 2 === 0) text("PRESS PLAY", 60, 92, YEL);
    // the strobe
    if (flash > 0.02) for (let i = 0; i < D.length; i += 4) { D[i] += (255 - D[i]) * flash * 0.6; D[i + 1] += (255 - D[i + 1]) * flash * 0.6; D[i + 2] += (255 - D[i + 2]) * flash * 0.6; }
    g.putImageData(img, 0, 0);
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);

  // -------------------------------------------------------------------------------------------- the menu ---
  const menu = $("menu"), msg = (t) => ($("msg").textContent = t);
  $("menuBtn").addEventListener("click", () => { msg(""); menu.showModal ? menu.showModal() : menu.setAttribute("open", ""); });
  menu.addEventListener("click", (e) => { if (e.target === menu) menu.close(); });
  const drawPrefs = () => document.querySelectorAll(".seg[data-pref]").forEach((s) => s.querySelectorAll("button").forEach((x) =>
    x.setAttribute("aria-pressed", String(x.dataset.v === pref(s.dataset.pref, "interactive")))));
  document.querySelectorAll(".seg[data-pref]").forEach((s) => s.addEventListener("click", (e) => {
    const x = e.target.closest("button");
    if (x) { try { localStorage.setItem("acid-flower-" + s.dataset.pref, x.dataset.v); } catch {} drawPrefs(); }
  }));
  drawPrefs();
  $("export").onclick = async () => {
    const d = new Date(), name = `acid-flower-${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}.json`;
    const file = new File([JSON.stringify({ app: "acid-flower", version: 1, ...S }, null, 1)], name, { type: "application/json" });
    try {
      if (navigator.canShare && navigator.canShare({ files: [file] })) { await navigator.share({ files: [file], title: "Acid Flower patterns" }); return msg("Saved: " + name); }
    } catch (err) { if (err && err.name === "AbortError") return; }
    const a = document.createElement("a");
    a.href = URL.createObjectURL(file); a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    msg("Saved: " + name);
  };
  $("import").onclick = () => $("importFile").click();
  $("importFile").onchange = async (e) => {
    const f = e.target.files && e.target.files[0];
    e.target.value = "";
    if (!f) return;
    let d;
    try { d = JSON.parse(await f.text()); } catch { d = null; }
    if (!valid(d)) return msg("That file isn’t a set of Acid Flower patterns.");
    if (!confirm("Replace your 8 patterns and knobs with “" + f.name + "”?")) return;
    S = { slots: d.slots, cur: Math.max(0, Math.min(7, d.cur | 0)), params: { ...DEF_PARAMS, ...d.params } };
    save(); sendParams(); sendPattern(); drawAll(); msg("Loaded " + f.name);
  };
  $("reset").onclick = () => {
    if (!confirm("Go back to the starter patterns and knobs? Your own patterns will be gone (save them first if you want them).")) return;
    S = fresh(); save(); sendParams(); sendPattern(); drawAll(); msg("Back to the starter patterns.");
  };

  const standalone = navigator.standalone || matchMedia("(display-mode: standalone), (display-mode: fullscreen)").matches;
  if (!standalone && navigator.maxTouchPoints > 0) $("a2hs").hidden = false;
  if ("serviceWorker" in navigator && location.protocol === "https:") navigator.serviceWorker.register("sw.js").catch(() => {});
  drawAll();
  window.acid = { state: () => S, playing: () => playing, viz: () => viz };
})();
