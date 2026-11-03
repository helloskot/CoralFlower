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
  // the pixel rave is rave.js; here: the playhead on the editor, the queued pattern taking over at the bar, the drums'
  // names lighting as they hit
  const markStep = (s) => {
    cols.forEach((c, i) => c.el.classList.toggle("is-now", i === s));
    cells.forEach((row) => row.forEach((d, i) => d.classList.toggle("is-now", i === s)));
  };
  let viz = { step: -1 }, lastStep = -2;
  const rave = new globalThis.AcidRave($("viz"), { pattern: () => pat(), params: () => S.params, slot: () => S.cur, playing: () => playing });
  const onViz = (m) => {
    viz = m;
    rave.event(m);
    if (m.step !== lastStep) {
      lastStep = m.step; markStep(m.step);
      if (m.step === 0 && nextSlot >= 0) { S.cur = nextSlot; nextSlot = -1; save(); drawAll(); }
    }
    for (let l = 0; l < LANES.length; l++) if (m.hits & (1 << l)) {
      const n = drumsEl.querySelector(`.dr__name[data-lane="${l}"]`);
      n.classList.add("is-hit"); setTimeout(() => n.classList.remove("is-hit"), 90);
    }
  };
  rave.start();
  // rave mode: the display fills the screen, and the whole of it is the squelch pad
  const setRave = (on) => {
    app.classList.toggle("is-rave", on);
    $("raveBtn").setAttribute("aria-pressed", String(on));
    rave.setPad(null);
  };
  const onPress = (el, f) => {   // (on the touch itself; a keyboard's click too)
    el.addEventListener("pointerdown", (e) => { e.preventDefault(); e.stopPropagation(); f(); });
    el.addEventListener("click", (e) => { if (e.detail === 0) f(); });
  };
  onPress($("raveBtn"), () => setRave(!app.classList.contains("is-rave")));
  onPress($("raveExit"), () => setRave(false));
  onPress($("raveScene"), () => rave.next());
  onPress($("ravePlay"), () => setPlaying(!playing));
  const vizEl = $("viz");
  vizEl.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    const raving = app.classList.contains("is-rave");
    const at = (ev) => { const r = vizEl.getBoundingClientRect(); return [clamp01((ev.clientX - r.left) / r.width), clamp01((ev.clientY - r.top) / r.height)]; };
    const p = { x0: e.clientX, y0: e.clientY, moved: false };
    const move = (ev) => {
      if (Math.abs(ev.clientX - p.x0) + Math.abs(ev.clientY - p.y0) > 6) p.moved = true;
      if (!raving) return;
      const [x, y] = at(ev);
      S.params.cutoff = x; S.params.reso = 1 - y; sendParams(); save(); drawXY(); rave.setPad(x, y);
    };
    const end = (ev) => {
      vizEl.removeEventListener("pointermove", move); vizEl.removeEventListener("pointerup", end); vizEl.removeEventListener("pointercancel", end);
      if (raving) rave.setPad(null);
      else if (!p.moved && ev.type === "pointerup") rave.next();   // a tap: the next scene
    };
    try { vizEl.setPointerCapture(e.pointerId); } catch {}
    vizEl.addEventListener("pointermove", move); vizEl.addEventListener("pointerup", end); vizEl.addEventListener("pointercancel", end);
    if (raving) move(e);
  });
  const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

  // -------------------------------------------------------------------------------------------- the menu ---
  const menu = $("menu"), msg = (t) => ($("msg").textContent = t);
  $("menuBtn").addEventListener("click", () => { msg(""); menu.showModal ? menu.showModal() : menu.setAttribute("open", ""); });
  menu.addEventListener("click", (e) => { if (e.target === menu) menu.close(); });
  const PREF_DEF = { latency: "interactive", scenes: "auto", motion: matchMedia("(prefers-reduced-motion: reduce)").matches ? "calm" : "full" };
  const applyPrefs = () => {
    document.querySelectorAll(".seg[data-pref]").forEach((s) => s.querySelectorAll("button").forEach((x) =>
      x.setAttribute("aria-pressed", String(x.dataset.v === pref(s.dataset.pref, PREF_DEF[s.dataset.pref])))));
    rave.auto = pref("scenes", PREF_DEF.scenes) === "auto";
    rave.calm = pref("motion", PREF_DEF.motion) === "calm";
  };
  document.querySelectorAll(".seg[data-pref]").forEach((s) => s.addEventListener("click", (e) => {
    const x = e.target.closest("button");
    if (x) { try { localStorage.setItem("acid-flower-" + s.dataset.pref, x.dataset.v); } catch {} applyPrefs(); }
  }));
  applyPrefs();
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
  window.acid = { state: () => S, playing: () => playing, viz: () => viz, rave };
})();
