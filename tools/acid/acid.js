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
  let ctx = null, node = null, playing = false, nextSlot = -1, nextAuto = false;
  const playHooks = [];                                   // (things that follow Play: the screen staying awake)
  const buzz = (ms = 8) => { try { if (navigator.vibrate) navigator.vibrate(ms); } catch {} };   // (a tick, where the device has one)
  const post = (m) => node && node.port.postMessage(m);
  const sendParams = () => post({ type: "params", params: S.params });
  const sendPattern = (atBar = false) => post({ type: "pattern", pattern: pat(), atBar });
  const wake = () => { if (ctx && ctx.state !== "running" && ctx.state !== "closed") ctx.resume().catch(() => {}); };
  for (const t of ["pointerdown", "keydown"]) addEventListener(t, wake, true);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) wake(); });
  const pref = (k, d) => { try { return localStorage.getItem("acid-flower-" + k) || d; } catch { return d; } };
  // the AudioContext: made by the first tap (Power, or Start), so iPadOS lets it sound; the boot's sounds and the machine
  // share it
  const makeCtx = () => {
    if (ctx) { ctx.resume().catch(() => {}); return ctx; }
    try { if (navigator.audioSession) navigator.audioSession.type = "playback"; } catch {}
    ctx = new AudioContext({ latencyHint: pref("latency", "interactive") === "playback" ? "playback" : "interactive" });
    ctx.resume().catch(() => {});
    return ctx;
  };
  const playBuf = ([l, r], offset = 0) => {
    const b = ctx.createBuffer(2, l.length, ctx.sampleRate);
    b.copyToChannel(l, 0); b.copyToChannel(r, 1);
    const src = ctx.createBufferSource(), g = ctx.createGain();
    src.buffer = b; g.gain.value = 0.8; src.connect(g); g.connect(ctx.destination);
    src.start(0, offset);
    return src;
  };
  // the boot's soundtrack: one buffer on the boot animation's clock; a skip jumps it to SYSTEM READY
  const bootSnd = { src: null, buf: null,
    play(offset) { try { this.stop(); this.buf = this.buf || globalThis.AcidBootSound.bootSound(ctx.sampleRate); this.src = playBuf(this.buf, offset); } catch {} },
    stop() { if (this.src) { try { this.src.stop(); } catch {} this.src = null; } } };
  const start = async () => {
    try {
      if (!window.AudioWorkletNode) throw new Error("this browser has no AudioWorklet: update iPadOS (16.4 or later)");
      try { if (navigator.audioSession) navigator.audioSession.type = "playback"; } catch {}
      makeCtx();
      bootSnd.stop();
      playBuf(globalThis.AcidBootSound.enterSound(ctx.sampleRate));   // (the Start button's zap and kick)
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
      boot.stop();
      fromLink();
      try { if (!localStorage.getItem("acid-flower-tour")) setTimeout(() => tour(0), 700); } catch {}
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
    if (!on && nextSlot >= 0) {
      if (nextAuto) { nextSlot = -1; nextAuto = false; sendPattern(); drawSlots(); }   // (a chain's next: stopping stays put)
      else { S.cur = nextSlot; nextSlot = -1; drawAll(); sendPattern(); }
    }
    if (!on) markStep(-1);
    playHooks.forEach((f) => f(on));
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
    $("xyVal").textContent = "CUT " + Math.round(S.params.cutoff * 100) + "  RES " + Math.round(S.params.reso * 100);
  };
  // a short trail behind the finger: where the filter has just been
  const TRAIL = 10, trail = [], trailEls = [];
  for (let i = 0; i < TRAIL; i++) { const d = document.createElement("i"); $("xyTrail").appendChild(d); trailEls.push(d); }
  const drawTrail = () => trailEls.forEach((d, i) => {
    const q = trail[trail.length - 1 - i];
    d.style.opacity = q ? String(0.55 * (1 - i / TRAIL)) : "0";
    if (q) { d.style.left = q[0] * 100 + "%"; d.style.top = (1 - q[1]) * 100 + "%"; }
  });
  const pushTrail = () => {
    trail.push([S.params.cutoff, S.params.reso]); if (trail.length > TRAIL) trail.shift();
    xy.classList.remove("is-trail-off"); drawTrail();
  };
  const endTrail = () => { xy.classList.add("is-trail-off"); trail.length = 0; trailEls.forEach((d) => (d.style.opacity = "0")); };   // (it fades: acid.css)

  // ------------------------------------------------------------------------------------------ the editor ---
  const bassEl = $("bass"), drumsEl = $("drums");
  const cols = [];
  // the rows' names, once at the start of the row (a second time where a phone breaks the 16 steps into two rows of 8)
  const label = (second) => {
    const d = document.createElement("div");
    d.className = "st st--lab" + (second ? " st--lab2" : "");
    d.setAttribute("aria-hidden", "true");
    d.innerHTML = `<b class="st__n">${second ? "9" : "1"}&#8594;</b><span class="st__l st__l--note"><i>Hi</i><i>Note</i><i>Lo</i></span>` +
                  `<span class="st__l">Oct</span><span class="st__l">Acc</span><span class="st__l">Slide</span>`;
    bassEl.appendChild(d);
  };
  for (let i = 0; i < 16; i++) {
    if (i === 0 || i === 8) label(i === 8);
    const c = document.createElement("div");
    c.className = "st";
    c.dataset.s = i;
    c.innerHTML = `<b class="st__n">${i + 1}</b><div class="st__note" data-s="${i}"><i class="st__pill"></i></div>` +
                  `<button type="button" class="st__t" data-t="oct" data-s="${i}" aria-label="Step ${i + 1} octave"></button>` +
                  `<button type="button" class="st__t" data-t="acc" data-s="${i}" aria-label="Step ${i + 1} accent"></button>` +
                  `<button type="button" class="st__t" data-t="slide" data-s="${i}" aria-label="Step ${i + 1} slide"></button>`;
    bassEl.appendChild(c);
    cols.push({ el: c, note: c.querySelector(".st__note"), pill: c.querySelector(".st__pill"), oct: c.querySelector('[data-t="oct"]'), acc: c.querySelector('[data-t="acc"]'), sld: c.querySelector('[data-t="slide"]') });
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
      c.pill.textContent = s.on ? NOTE[s.note] + (s.note === 12 ? "′" : "") : "rest";
      c.note.style.setProperty("--h", String(s.on ? s.note / 12 : 0.5));
      c.note.setAttribute("aria-label", "Step " + (i + 1) + ": " + (s.on ? NOTE[s.note] : "rest"));
      c.oct.textContent = s.oct > 0 ? "Up" : s.oct < 0 ? "Down" : "";
      c.oct.classList.toggle("is-up", s.oct > 0); c.oct.classList.toggle("is-dn", s.oct < 0);
      c.oct.setAttribute("aria-pressed", String(s.oct !== 0));
      c.acc.textContent = s.acc ? "Acc" : ""; c.acc.classList.toggle("is-acc", s.acc); c.acc.setAttribute("aria-pressed", String(s.acc));
      c.sld.textContent = s.slide ? "Slide" : ""; c.sld.classList.toggle("is-sld", s.slide); c.sld.setAttribute("aria-pressed", String(s.slide));
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
      const p = S.slots[i], nx = p.next == null ? -1 : p.next;
      e.dataset.next = nx >= 0 && nx !== i ? "\u2192" + (nx + 1) : "";
      e.title = (p.name ? p.name + ": " : "") + "pattern " + (i + 1) + (nx >= 0 && nx !== i ? ", then " + (nx + 1) : "") + " (hold for more)";
    });
  };
  const drawAll = () => {
    drawBass(); drawDrums(); drawSlots(); drawXY(); strips.forEach(drawStrip);
    $("len").textContent = pat().len;
    $("tune").textContent = (S.params.tune > 0 ? "+" : "") + (S.params.tune ? S.params.tune : "C");
    $("wave").querySelector("b").textContent = S.params.wave ? "Square" : "Saw";
  };
  for (let i = 0; i < 8; i++) {
    const e = document.createElement("button");
    e.type = "button"; e.className = "slot"; e.textContent = i + 1; e.dataset.slot = i;
    $("slots").appendChild(e);
  }
  const edited = () => { commit(); sendPattern(); save(); drawSlots(); };
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
    if (t.classList.contains("slot")) {                // a tap picks it; a hold opens its menu
      const i = +t.dataset.slot;
      pickSlot(i); buzz();
      ptr.set(e.pointerId, { kind: "slot", hold: setTimeout(() => { ptr.delete(e.pointerId); buzz(15); openSlot(i); }, 480) });
      try { app.setPointerCapture(e.pointerId); } catch {}
      return;
    }
    if (t.classList.contains("st__t") || t.classList.contains("dr") || t.classList.contains("st__note")) begin();   // (one gesture, one undo)
    if (t.classList.contains("st__t")) {
      buzz();
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
      pat().drums[l][s] = v; buzz();
      ptr.set(e.pointerId, { kind: "dr", v, last: t });
      drawDrums(); edited();
      if (v && !playing) post({ type: "hit", lane: l });
    } else if (t.classList.contains("st__note")) {
      ptr.set(e.pointerId, { kind: "note", i: +t.dataset.s, y0: e.clientY, acc: 0, moved: false, px: Math.max(7, (t.clientHeight * 0.74) / 12) });
    } else if (t.classList.contains("xy")) {
      ptr.set(e.pointerId, { kind: "xy", el: t, x0: e.clientX, y0: e.clientY, moved: false });
      t.classList.add("is-on"); trail.length = 0;
      moveXY(t, e);
    } else {
      const p = { kind: "strip", el: t, k: t.dataset.p, x0: e.clientX, y0: e.clientY, y: e.clientY, acc: 0, moved: false, side: 0, t0: performance.now() };
      if (t.classList.contains("strip--bar")) {           // tempo and swing: their ends are arrows; hold one to keep going
        const r = t.getBoundingClientRect(), f = (e.clientX - r.left) / r.width;
        p.side = f < 0.3 ? -1 : f > 0.7 ? 1 : 0;
        if (p.side) {
          p.arrow = t.querySelector(p.side < 0 ? ".strip__l" : ".strip__r"); p.arrow.classList.add("is-press");
          p.hold = setTimeout(() => { p.rep = setInterval(() => { p.repeated = true; setParam(p.k, S.params[p.k] + p.side * spec(p.k).unit); drawStrip(t); }, 70); }, 380);
        }
      }
      ptr.set(e.pointerId, p);
      t.classList.add("is-turn");
    }
    try { app.setPointerCapture(e.pointerId); } catch {}
  });
  const moveXY = (t, e) => {
    const r = t.getBoundingClientRect();
    S.params.cutoff = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
    S.params.reso = Math.max(0, Math.min(1, 1 - (e.clientY - r.top) / r.height));
    sendParams(); save(); drawXY(); pushTrail();
  };
  app.addEventListener("pointermove", (e) => {
    const p = ptr.get(e.pointerId);
    if (!p) return;
    if (p.kind === "xy") { if (Math.abs(e.clientX - p.x0) + Math.abs(e.clientY - p.y0) > 10) p.moved = true; moveXY(p.el, e); }
    else if (p.kind === "dr") {                         // painting across the steps
      const el = document.elementFromPoint(e.clientX, e.clientY), d = el && el.closest && el.closest(".dr");
      if (d && d !== p.last) { p.last = d; pat().drums[+d.dataset.lane][+d.dataset.s] = p.v; drawDrums(); edited(); }
    } else if (p.kind === "note") {
      const dy = p.y0 - e.clientY;
      if (Math.abs(dy) > 8) p.moved = true;
      if (!p.moved) return;
      const steps = Math.trunc(dy / p.px);
      if (steps) {
        p.y0 -= steps * p.px;
        const s = pat().bass[p.i];
        s.on = true;
        s.note = Math.max(0, Math.min(12, s.note + steps));
        drawBass(); edited(); audition(p.i);
      }
    } else if (p.kind === "strip") {
      const sp = spec(p.k), d = p.y - e.clientY;
      p.y = e.clientY;
      if (Math.abs(e.clientY - p.y0) + Math.abs(e.clientX - p.x0) > 8 && !p.repeated) { p.moved = true; clearTimeout(p.hold); }
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
    if (p.kind === "slot") clearTimeout(p.hold);
    if (p.kind === "xy") {
      p.el.classList.remove("is-on"); endTrail();
      if (!p.moved && e.type === "pointerup") {          // a double tap: the filter back where it started
        const now = performance.now();
        if (now - lastPadTap < 350) { S.params.cutoff = DEF_PARAMS.cutoff; S.params.reso = DEF_PARAMS.reso; sendParams(); save(); drawXY(); toast("Filter back to the start"); lastPadTap = 0; }
        else lastPadTap = now;
      }
    }
    if (p.kind === "strip") {
      p.el.classList.remove("is-turn");
      clearTimeout(p.hold); clearInterval(p.rep);
      if (p.arrow) p.arrow.classList.remove("is-press");
      if (!p.moved && !p.repeated && e.type === "pointerup" && p.side) { setParam(p.k, S.params[p.k] + p.side * spec(p.k).unit); drawStrip(p.el); }   // the arrows step
      else if (!p.moved && e.type === "pointerup" && p.k === "tempo" && !p.side) tapTempo(p.t0, p.el);   // the middle: tap tempo
    }
    if (p.kind === "note" && !p.moved && e.type === "pointerup") {   // a tap: rest, or back on
      const s = pat().bass[p.i];
      s.on = !s.on;
      drawBass(); edited(); audition(p.i);
    }
  };
  for (const t of ["pointerup", "pointercancel"]) app.addEventListener(t, up);
  app.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    const sl = e.target.closest && e.target.closest(".slot");
    if (sl && e.pointerType !== "touch") openSlot(+sl.dataset.slot);   // (a right-click is a hold)
  });
  for (const t of ["gesturestart", "gesturechange", "dblclick"]) document.addEventListener(t, (e) => e.preventDefault(), { passive: false });
  // a keyboard: Space plays, 1 to 8 pick a pattern, the arrows the tempo, R the rave, Cmd/Ctrl Z undo (Shift: redo);
  // the punch-ins are Shift with the number row (below)
  addEventListener("keydown", (e) => {
    if ($("menu").open || $("slotMenu").open || !$("gate").hidden) return;
    if (e.target && e.target.closest && e.target.closest("input, textarea")) return;
    const mod = e.metaKey || e.ctrlKey;
    if (mod && e.code === "KeyZ") { e.preventDefault(); if (e.shiftKey) redo(); else undo(); return; }
    if (mod || e.altKey) return;
    if (e.code === "Space") { e.preventDefault(); setPlaying(!playing); }
    else if (!e.shiftKey && /^Digit[1-8]$/.test(e.code)) { e.preventDefault(); pickSlot(+e.code.slice(5) - 1); }
    else if (e.code === "ArrowLeft" || e.code === "ArrowRight") {
      e.preventDefault(); setParam("tempo", S.params.tempo + (e.code === "ArrowRight" ? 1 : -1) * (e.shiftKey ? 5 : 1)); strips.forEach(drawStrip);
    } else if (e.code === "KeyR" && !e.repeat) setRave(!app.classList.contains("is-rave"));
    else if (e.code === "Escape" && app.classList.contains("is-rave")) setRave(false);
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
    $("punch").hidden = t.dataset.tab !== "punch";
    $("latch").hidden = t.dataset.tab !== "punch";
    app.classList.toggle("is-tab-filter", t.dataset.tab === "filter");   // (short phones: the filter has its own tab)
    document.querySelector(".tools").style.visibility = t.dataset.tab === "punch" || t.dataset.tab === "filter" ? "hidden" : "";
  });
  // the Filter tab only shows on short phones: on a bigger screen (a turn, an unfold) it hands back to the bass line
  addEventListener("resize", () => {
    const f = document.querySelector('[data-tab="filter"]');
    if (app.classList.contains("is-tab-filter") && !f.getClientRects().length) runAct(document.querySelector('[data-tab="bass"]'));
  });
  const tab = () => (!bassEl.hidden ? "bass" : "drums");
  act("#wave", () => { begin(); S.params.wave = S.params.wave ? 0 : 1; commit(); sendParams(); save(); drawAll(); });
  act("[data-tune]", (x) => { begin(); S.params.tune = Math.max(-12, Math.min(12, S.params.tune + +x.dataset.tune)); commit(); sendParams(); save(); drawAll(); });
  act("[data-len]", (x) => { begin(); pat().len = Math.max(1, Math.min(16, pat().len + +x.dataset.len)); edited(); drawAll(); });
  act("#undo", () => undo());
  act("#redo", () => redo());
  act("#latch", () => setLatch(!latch));
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
    begin();
    if (tab() === "bass") {
      const sc = pick(SCALES);
      pat().bass = ALL16.map(() => randStep(sc));
      pat().bass[0] = { on: true, note: 0, oct: 0, acc: true, slide: false };
    } else pat().drums = randomDrums();
    edited(); drawAll(); toast("A new " + (tab() === "bass" ? "bass line" : "beat"), "Undo", undo);
  });
  act("#mutate", () => {
    begin();
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
  let clearT = 0;
  act("#clear", (el) => {
    if (!el.classList.contains("is-armed")) {           // the first tap asks; the second, within 2.5 s, clears
      el.classList.add("is-armed"); el.querySelector("span").textContent = "Sure?";
      clearTimeout(clearT); clearT = setTimeout(() => { el.classList.remove("is-armed"); el.querySelector("span").textContent = "Clear"; }, 2500);
      return;
    }
    clearTimeout(clearT); el.classList.remove("is-armed"); el.querySelector("span").textContent = "Clear";
    begin();
    if (tab() === "bass") pat().bass = ALL16.map(rest);
    else pat().drums = grid([]);
    edited(); drawAll(); toast("Cleared", "Undo", undo);
  });

  // ------------------------------------------------------------------------------------------ the punch-ins ---
  // twelve effects on the whole mix, each on while a finger (or a key) holds it; a finger can slide from pad to pad
  const FXS = [["Repeat", "1/8", "#FFE100"], ["Repeat", "1/16", "#FFE100"], ["Roll", "1/32", "#FFE100"], ["Reverse", "back", "#2BF0FF"],
               ["Tape", "stop", "#2BF0FF"], ["Lowpass", "sweep", "#FF2FB4"], ["Highpass", "sweep", "#FF2FB4"], ["Crush", "bits", "#FF8A1F"],
               ["Gate", "1/16", "#FF8A1F"], ["Echo", "throw", "#B4FF2B"], ["Bass", "out", "#B4FF2B"], ["Drums", "out", "#B4FF2B"]];
  const FXKEYS = ["Digit1", "Digit2", "Digit3", "Digit4", "Digit5", "Digit6", "Digit7", "Digit8", "Digit9", "Digit0", "Minus", "Equal"];
  const fxSrc = FXS.map(() => new Set()), fxEls = FXS.map(() => []);
  let fxSent = -1;
  const fxPublish = () => {
    let m = 0;
    fxSrc.forEach((s, i) => s.size && (m |= 1 << i));
    if (m !== fxSent) { fxSent = m; post({ type: "fx", mask: m }); }
    fxEls.forEach((list, i) => list.forEach((e) => e.classList.toggle("is-on", fxSrc[i].size > 0)));
  };
  const fxHold = (i, src, down) => { if (!fxSrc[i]) return; down ? fxSrc[i].add(src) : fxSrc[i].delete(src); fxPublish(); };
  for (const box of [$("punch"), $("ravePunch")]) {
    FXS.forEach(([a, b2, c], i) => {
      const d = document.createElement("div");
      d.className = "fxp"; d.dataset.fx = i; d.style.setProperty("--c", c); d.setAttribute("role", "button"); d.setAttribute("aria-label", a + " " + b2);
      d.innerHTML = `<kbd>\u21e7${["1", "2", "3", "4", "5", "6", "7", "8", "9", "0", "-", "="][i]}</kbd><b>${a}</b><small>${b2}</small>`;
      box.appendChild(d); fxEls[i].push(d);
    });
    const held = new Map();
    box.addEventListener("pointerdown", (e) => {
      const d = e.target.closest(".fxp");
      if (!d) return;
      e.preventDefault(); e.stopPropagation(); buzz();
      if (latch) { const i = +d.dataset.fx; if (fxSrc[i].has("L")) fxSrc[i].delete("L"); else fxSrc[i].add("L"); fxPublish(); return; }   // (latched: a tap on, a tap off)
      held.set(e.pointerId, +d.dataset.fx); fxHold(+d.dataset.fx, "p" + e.pointerId, true);
      try { box.setPointerCapture(e.pointerId); } catch {}
    });
    box.addEventListener("pointermove", (e) => {
      if (!held.has(e.pointerId)) return;
      const el = document.elementFromPoint(e.clientX, e.clientY), d = el && el.closest && el.closest(".fxp");
      if (!d || !box.contains(d) || +d.dataset.fx === held.get(e.pointerId)) return;
      fxHold(held.get(e.pointerId), "p" + e.pointerId, false); held.set(e.pointerId, +d.dataset.fx); fxHold(+d.dataset.fx, "p" + e.pointerId, true);
    });
    const end = (e) => { if (!held.has(e.pointerId)) return; fxHold(held.get(e.pointerId), "p" + e.pointerId, false); held.delete(e.pointerId); };
    box.addEventListener("pointerup", end); box.addEventListener("pointercancel", end);
  }
  addEventListener("keydown", (e) => {
    const i = FXKEYS.indexOf(e.code);
    if (i < 0 || e.repeat || !e.shiftKey || e.metaKey || e.ctrlKey || $("menu").open || $("slotMenu").open) return;
    e.preventDefault();
    if (latch) { if (fxSrc[i].has("L")) fxSrc[i].delete("L"); else fxSrc[i].add("L"); fxPublish(); }
    else fxHold(i, "k", true);
  });
  addEventListener("keyup", (e) => { const i = FXKEYS.indexOf(e.code); if (i >= 0) fxHold(i, "k", false); });
  addEventListener("blur", () => { fxSrc.forEach((s) => s.clear()); fxPublish(); });
  document.addEventListener("visibilitychange", () => { if (document.hidden) { fxSrc.forEach((s) => s.clear()); fxPublish(); } });

  // ------------------------------------------------------------------------------------------ the display ---
  // the pixel rave is rave.js; here: the playhead on the editor, the queued pattern taking over at the bar, the drums'
  // names lighting as they hit
  const markStep = (s) => {
    cols.forEach((c, i) => c.el.classList.toggle("is-now", i === s));
    cells.forEach((row) => row.forEach((d, i) => d.classList.toggle("is-now", i === s)));
  };
  let viz = { step: -1 }, lastStep = -2;
  const rave = new globalThis.AcidRave($("viz"), { pattern: () => pat(), params: () => S.params, slot: () => S.cur, playing: () => playing, name: () => pat().name || "" });
  const onViz = (m) => {
    viz = m;
    rave.event(m);
    if (m.step !== lastStep) {
      lastStep = m.step; markStep(m.step);
      // the Play buttons pulse on the beat, harder on the bar's first
      if (m.step >= 0 && m.step % 4 === 0) for (const b of [$("play"), $("ravePlay")]) {
        b.classList.remove("beat", "down"); void b.offsetWidth; b.classList.add("beat"); if (m.step === 0) b.classList.add("down");
      }
      if (m.step === 0 && nextSlot >= 0) { S.cur = nextSlot; nextSlot = -1; nextAuto = false; save(); drawAll(); }
      if (m.step === 0) queueFollow();
    }
    for (let l = 0; l < LANES.length; l++) if (m.hits & (1 << l)) {
      const n = drumsEl.querySelector(`.dr__name[data-lane="${l}"]`);
      n.classList.add("is-hit"); setTimeout(() => n.classList.remove("is-hit"), 90);
    }
  };
  rave.start();
  // the display fills its box: the picture is 150 pixels tall and as wide as the box asks (240 to 560), so a wide
  // screen gets more rave instead of black bars; past that it is fitted, never cropped
  const vizEl = $("viz");
  const fitViz = () => {
    vizEl.style.width = ""; vizEl.style.height = "";
    const r = vizEl.getBoundingClientRect();
    if (r.width < 8 || r.height < 8) return;
    rave.setWidth((150 * r.width) / r.height);
    const k = Math.min(r.width / rave.W, r.height / 150);
    vizEl.style.width = Math.floor(rave.W * k) + "px"; vizEl.style.height = Math.floor(150 * k) + "px";
  };
  if (window.ResizeObserver) new ResizeObserver(() => requestAnimationFrame(fitViz)).observe(document.querySelector(".rave"));
  addEventListener("resize", () => requestAnimationFrame(fitViz));
  fitViz();
  // rave mode: the display fills the screen, and the whole of it is the squelch pad
  const setRave = (on) => {
    app.classList.toggle("is-rave", on);
    $("raveBtn").setAttribute("aria-pressed", String(on));
    rave.setPad(null);
    requestAnimationFrame(fitViz);
  };
  const onPress = (el, f) => {   // (on the touch itself; a keyboard's click too)
    el.addEventListener("pointerdown", (e) => { e.preventDefault(); e.stopPropagation(); f(); });
    el.addEventListener("click", (e) => { if (e.detail === 0) f(); });
  };
  onPress($("raveBtn"), () => setRave(!app.classList.contains("is-rave")));
  onPress($("raveExit"), () => setRave(false));
  onPress($("raveScene"), () => rave.next());
  onPress($("ravePlay"), () => setPlaying(!playing));
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
    app.classList.toggle("is-calm", rave.calm);
  };
  document.querySelectorAll(".seg[data-pref]").forEach((s) => s.addEventListener("click", (e) => {
    const x = e.target.closest("button");
    if (x) { try { localStorage.setItem("acid-flower-" + s.dataset.pref, x.dataset.v); } catch {} applyPrefs(); }
  }));
  applyPrefs();
  const stamp = () => { const d = new Date(), z = (v) => String(v).padStart(2, "0"); return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}`; };
  // a file to keep: the share sheet where there is one (Save to Files, AirDrop, Messages...), else a download
  const saveFile = async (file, title) => {
    try {
      if (navigator.canShare && navigator.canShare({ files: [file] })) { await navigator.share({ files: [file], title }); return true; }
    } catch (err) { if (err && err.name === "AbortError") return false; }
    const a = document.createElement("a");
    a.href = URL.createObjectURL(file); a.download = file.name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    return true;
  };
  $("export").onclick = async () => {
    const name = `acid-flower-${stamp()}.json`;
    const file = new File([JSON.stringify({ app: "acid-flower", version: 1, ...S }, null, 1)], name, { type: "application/json" });
    if (await saveFile(file, "Acid Flower patterns")) msg("Saved: " + name);
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
    begin();
    S = { slots: d.slots, cur: Math.max(0, Math.min(7, d.cur | 0)), params: { ...DEF_PARAMS, ...d.params } };
    commit(); save(); sendParams(); sendPattern(); drawAll(); msg("Loaded " + f.name);
  };
  $("reset").onclick = () => {
    if (!confirm("Go back to the starter patterns and knobs? Your own patterns will be gone (save them first if you want them).")) return;
    begin(); S = fresh(); commit(); save(); sendParams(); sendPattern(); drawAll(); msg("Back to the starter patterns.");
  };

  const standalone = navigator.standalone || matchMedia("(display-mode: standalone), (display-mode: fullscreen)").matches;
  if (!standalone && navigator.maxTouchPoints > 0) $("a2hs").hidden = false;
  if ("serviceWorker" in navigator && location.protocol === "https:") navigator.serviceWorker.register("sw.js").catch(() => {});
  drawAll();
  // ------------------------------------------------------------------------------------------- the icons ---
  // pixel icons, 12 x 12, drawn as crisp SVG: the bass line a squelching saw, the drums a drum and its sticks, the
  // punch-ins a lightning bolt, the rave a smiley, the tilt an iPad leaning
  const ICONS = {
    bass: [["............", "............", "....L.....L.", "...LL....LL.", "..L.L...L.L.", ".L..L..L..L.", "L...L.L...L.", "....GG....GG", "....G.....G.", "............", "............", "............"], { L: "#B4FF2B", G: "#5FA81A" }],
    drums: [["S.........S.", ".S.......S..", "..S.....S...", "...S...S....", "..RRRRRRRR..", ".RWWWWWWWWR.", ".RRRRRRRRRR.", ".YYOYYOYYOY.", ".YOYYOYYOYY.", ".YYOYYOYYOY.", ".RRRRRRRRRR.", "............"], { S: "#E8D6B0", R: "#FF8A1F", W: "#FFFFFF", Y: "#FFE100", O: "#FF8A1F" }],
    filter: [["............", ".....C......", ".....C......", ".....C......", ".....C......", "CCCC.LL.CCCC", ".....LL.....", ".....C......", ".....C......", ".....C......", ".....C......", "............"], { C: "#2BF0FF", L: "#B4FF2B" }],
    punch: [["......PPPP..", ".....PPPP...", "....PPPP....", "...PPPP.....", "..PPPPPPPP..", ".....PPPP...", "....PPPP....", "...PPPP.....", "..PPP.......", "..PP........", ".P..........", "............"], { P: "#FF2FB4" }],
    rave: [["...YYYYYY...", "..YYYYYYYY..", ".YYYYYYYYYY.", "YYYKYYYYKYYY", "YYYKYYYYKYYY", "YYYYYYYYYYYY", "YYKYYYYYYKYY", "YYYKYYYYKYYY", ".YYYKKKKYYY.", "..YYYYYYYY..", "...YYYYYY...", "............"], { Y: "#FFE100", K: "#110A02" }],
    random: [["............", ".WWWWWWWWW..", ".W.......WW.", ".W.P...P.WW.", ".W.......WW.", ".W...P...WW.", ".W.......WW.", ".W.P...P.WW.", ".W.......WW.", ".WWWWWWWWWW.", "..WWWWWWWWW.", "............"], { W: "#F4F1FF", P: "#FF2FB4" }],
    mutate: [["............", ".....Y......", ".....Y......", "...Y.Y.Y....", "....YYY.....", "..YYYWYYY...", "....YYY.....", "...Y.Y.Y.L..", ".....Y...L..", ".....Y.LLLLL", ".........L..", ".........L.."], { Y: "#FFE100", W: "#FFFFFF", L: "#B4FF2B" }],
    clear: [["............", ".PP......PP.", ".PPP....PPP.", "..PPP..PPP..", "...PPPPPP...", "....PPPP....", "....PPPP....", "...PPPPPP...", "..PPP..PPP..", ".PPP....PPP.", ".PP......PP.", "............"], { P: "#FF6FAE" }],
    undo: [["............", "...C........", "..CC........", ".CCCCCCCC...", "..CC.....C..", "...C......C.", "..........C.", "..........C.", ".........C..", "....CCCCC...", "............", "............"], { C: "#2BF0FF" }],
    redo: [["............", "........C...", "........CC..", "...CCCCCCCC.", "..C.....CC..", ".C......C...", ".C..........", ".C..........", "..C.........", "...CCCCC....", "............", "............"], { C: "#2BF0FF" }],
    tilt: [["..AAAAAA....", ".A......A...", "A........A.A", "A.........AA", "........AAA.", "............", ".CCCCCCCCCC.", ".C........C.", ".C.DDDDDD.CC", ".C........C.", ".CCCCCCCCCC.", "............"], { C: "#2BF0FF", A: "#9FF8FF", D: "#1A8F99" }],
  };
  const iconSvg = (name) => {
    const [g, col] = ICONS[name];
    let r = "";
    g.forEach((row, y) => [...row].forEach((ch, x) => { if (col[ch]) r += `<rect x="${x}" y="${y}" width="1" height="1" fill="${col[ch]}"/>`; }));
    return `<svg class="pix" viewBox="0 0 12 12" width="20" height="20" shape-rendering="crispEdges" aria-hidden="true">${r}</svg>`;
  };
  for (const [sel, name] of [['[data-tab="bass"]', "bass"], ['[data-tab="drums"]', "drums"], ['[data-tab="punch"]', "punch"], ['[data-tab="filter"]', "filter"], ["#raveBtn", "rave"], ["#tiltBtn", "tilt"], ["#random", "random"], ["#mutate", "mutate"], ["#clear", "clear"], ["#undo", "undo"], ["#redo", "redo"]]) {
    const el = document.querySelector(sel);
    el.innerHTML = iconSvg(name) + `<span>${el.textContent}</span>`;
  }

  // ------------------------------------------------------------------------------------------- the boot ---
  // the start screen: the machine powering on (rave.js bootScene), then its button; a tap skips ahead
  const boot = new globalThis.AcidRave($("boot"), { pattern: () => pat(), params: () => S.params, slot: () => S.cur, playing: () => false,
                                                    onReady: () => $("gate").classList.add("is-ready") }, { boot: true });
  boot.calm = rave.calm;
  boot.start();
  // Power: the tap that lets the iPad sound; the boot animation and its sounds start together
  $("power").addEventListener("click", () => {
    makeCtx();
    $("gate").classList.add("is-on");
    boot.power();
    bootSnd.play(boot.calm ? globalThis.AcidBootSound.READY - 0.02 : 0);
  });
  // the start screen, booting: a tap skips to SYSTEM READY (its chord too); ready: a toy (rave.js) with notes from here
  const gateTouch = new Map();
  const gatePt = (e) => {                                 // a touch on the boot picture: 0..1 across it (it is fitted, not cropped)
    const r = $("boot").getBoundingClientRect(), k = Math.min(r.width / 240, r.height / 150), w = 240 * k, h = 150 * k;
    return [(e.clientX - r.left - (r.width - w) / 2) / w, (e.clientY - r.top - (r.height - h) / 2) / h];
  };
  const PENTA = [0, 3, 5, 7, 10];
  const pluck = (x, y, low) => {                          // an acid pluck: a saw through a resonant filter that snaps shut
    if (!ctx) return;
    const now = ctx.currentTime, step = Math.round(Math.max(0, Math.min(1, x)) * 10), midi = (low ? 33 : 45) + PENTA[step % 5] + 12 * Math.floor(step / 5);
    const o = ctx.createOscillator(), f = ctx.createBiquadFilter(), g = ctx.createGain();
    o.type = "sawtooth"; o.frequency.value = 440 * Math.pow(2, (midi - 69) / 12);
    f.type = "lowpass"; f.Q.value = 14;
    const top = 400 + (1 - Math.max(0, Math.min(1, y))) * 4600;
    f.frequency.setValueAtTime(top, now); f.frequency.exponentialRampToValueAtTime(140, now + 0.32);
    g.gain.setValueAtTime(0.0001, now); g.gain.exponentialRampToValueAtTime(low ? 0.4 : 0.22, now + 0.006); g.gain.exponentialRampToValueAtTime(0.0001, now + (low ? 0.7 : 0.4));
    o.connect(f); f.connect(g); g.connect(ctx.destination);
    o.start(now); o.stop(now + 0.75);
  };
  $("gate").addEventListener("pointerdown", (e) => {
    if (e.target.closest("button") || !boot.powered) return;
    if (!boot.ready) { boot.skip(); bootSnd.play(globalThis.AcidBootSound.READY - 0.02); return; }   // (straight to SYSTEM READY)
    e.preventDefault();
    const [x, y] = gatePt(e);
    gateTouch.set(e.pointerId, { x, y, x0: x, y0: y, moved: false });
    try { $("gate").setPointerCapture(e.pointerId); } catch {}
    if (gateTouch.size === 2) { boot.burst(); pluck(0.2, 0.9, true); pluck(0.6, 0.9, true); }
    else boot.grab();
  });
  $("gate").addEventListener("pointermove", (e) => {
    const p = gateTouch.get(e.pointerId);
    if (!p) return;
    const [x, y] = gatePt(e);
    if (Math.abs(x - p.x0) + Math.abs(y - p.y0) > 0.02) p.moved = true;
    if (gateTouch.size === 1) boot.spinBy(x - p.x, y - p.y);
    p.x = x; p.y = y;
  });
  const gateUp = (e) => {
    const p = gateTouch.get(e.pointerId);
    if (!p) return;
    gateTouch.delete(e.pointerId);
    if (!gateTouch.size) boot.release();
    if (!p.moved && e.type === "pointerup" && gateTouch.size === 0) { boot.tap(p.x, p.y); pluck(p.x, p.y, false); }
  };
  $("gate").addEventListener("pointerup", gateUp); $("gate").addEventListener("pointercancel", gateUp);

  // ------------------------------------------------------------------------------------------- the tilt ---
  // lean the iPad to play the filter: left / right the cutoff, towards / away the resonance, about the way it was
  // held when Tilt went on; the picture leans with it. (iPadOS asks first: from the tap itself, a click.)
  let tiltOn = false, tiltZero = null, tiltS = [0, 0];
  const tiltAxes = (e) => {
    const ang = (screen.orientation && screen.orientation.angle != null ? screen.orientation.angle : window.orientation || 0) | 0;
    const b = e.beta || 0, g = e.gamma || 0;
    return ang === 90 ? [b, -g] : ang === -90 || ang === 270 ? [-b, g] : ang === 180 ? [-g, -b] : [g, b];
  };
  const onTilt = (e) => {
    if (!tiltOn || e.beta == null) return;
    const [x, y] = tiltAxes(e);
    if (!tiltZero) tiltZero = [x, y];
    const dx = clamp1((x - tiltZero[0]) / 28), dy = clamp1((y - tiltZero[1]) / 28);
    tiltS[0] += (dx - tiltS[0]) * 0.35; tiltS[1] += (dy - tiltS[1]) * 0.35;
    S.params.cutoff = clamp01(tiltBase[0] + tiltS[0] * 0.5); S.params.reso = clamp01(tiltBase[1] - tiltS[1] * 0.5);
    rave.tilt = [tiltS[0], tiltS[1]];
    sendParams(); save(); drawXY();
  };
  const clamp1 = (v) => (v < -1 ? -1 : v > 1 ? 1 : v);
  let tiltBase = [0.5, 0.5];
  const setTilt = (on) => {
    tiltOn = on; tiltZero = null; tiltS = [0, 0]; rave.tilt = [0, 0];
    tiltBase = [S.params.cutoff, S.params.reso];
    $("tiltBtn").setAttribute("aria-pressed", String(on));
  };
  $("tiltBtn").addEventListener("click", async () => {
    if (tiltOn) return setTilt(false);
    try {
      if (window.DeviceOrientationEvent && typeof DeviceOrientationEvent.requestPermission === "function") {
        const r = await DeviceOrientationEvent.requestPermission();
        if (r !== "granted") { alert("Tilt needs motion access: allow it when asked (or in Settings, Safari, Motion & Orientation Access)."); return; }
      } else if (!("DeviceOrientationEvent" in window)) { alert("This device has no tilt sensor."); return; }
    } catch (err) { alert("Tilt isn\u2019t available here: " + err.message); return; }
    if (!tiltListening) { addEventListener("deviceorientation", onTilt); tiltListening = true; }
    setTilt(true);
  });
  let tiltListening = false;

  // ------------------------------------------------------------------------------------------- the fold ---
  // a foldable, half-folded: the Viewport Segments API says where its two screens are (acid.css measures them); a
  // browser that only knows the Device Posture API ("folded") gets the halves of the screen: across when it is held
  // wide (tabletop), down the middle when held tall (book)
  const foldMQ = { tb: matchMedia("(vertical-viewport-segments: 2)"), lr: matchMedia("(horizontal-viewport-segments: 2)") };
  const posture = () => (navigator.devicePosture && navigator.devicePosture.type) || "continuous";
  const applyFold = () => {
    let tb = foldMQ.tb.matches, lr = foldMQ.lr.matches;
    if (!tb && !lr && posture() === "folded") { if (innerWidth >= innerHeight) tb = true; else lr = true; }
    document.documentElement.classList.toggle("fold-tb", tb);
    document.documentElement.classList.toggle("fold-lr", lr);
  };
  for (const m of Object.values(foldMQ)) (m.addEventListener ? m.addEventListener("change", applyFold) : m.addListener(applyFold));
  if (navigator.devicePosture && navigator.devicePosture.addEventListener) navigator.devicePosture.addEventListener("change", applyFold);
  addEventListener("resize", applyFold);
  applyFold();


  // =============================================================================================== comforts ===
  // ------------------------------------------------------------------------------------------- the toast ---
  let toastT = 0;
  const hideToast = () => { $("toast").hidden = true; };
  const toast = (text, label, f, ms) => {
    $("toastMsg").textContent = text;
    const b = $("toastBtn");
    b.hidden = !label;
    if (label) { b.textContent = label; b.onclick = () => { hideToast(); f(); }; }
    $("toast").hidden = false;
    clearTimeout(toastT); toastT = setTimeout(hideToast, ms || (label ? 4500 : 2200));
  };

  // -------------------------------------------------------------------------------------------- undo ---
  // every change to the patterns (and the key and the wave) can be undone: a gesture or a button is one step
  const hist = { undo: [], redo: [] };
  let pend = null;
  const snap = () => JSON.stringify({ slots: S.slots, tune: S.params.tune, wave: S.params.wave });
  function begin() { pend = snap(); }
  function commit() {
    if (pend == null) return;
    if (pend !== snap()) { hist.undo.push(pend); if (hist.undo.length > 100) hist.undo.shift(); hist.redo.length = 0; }
    pend = null; drawHist();
  }
  const restore = (j) => { const d = JSON.parse(j); S.slots = d.slots; S.params.tune = d.tune; S.params.wave = d.wave; sendParams(); sendPattern(); save(); drawAll(); };
  function undo() { if (!hist.undo.length) return; hist.redo.push(snap()); restore(hist.undo.pop()); drawHist(); toast("Undone", "Redo", redo); }
  function redo() { if (!hist.redo.length) return; hist.undo.push(snap()); restore(hist.redo.pop()); drawHist(); toast("Redone", "Undo", undo); }
  function drawHist() { $("undo").disabled = !hist.undo.length; $("redo").disabled = !hist.redo.length; }
  drawHist();

  // ------------------------------------------------------------------------------------- the patterns ---
  // a tap picks one (while it plays: at the bar's end); a hold opens its menu: a name, Then play (a chain: a song),
  // Copy to, Share as a link, Clear
  function pickSlot(i) {
    if (playing && i !== S.cur) { nextSlot = i; nextAuto = false; post({ type: "pattern", pattern: S.slots[i], atBar: true }); }
    else if (playing && nextSlot >= 0) { nextSlot = -1; nextAuto = false; post({ type: "pattern", pattern: pat(), atBar: true }); }   // (the current one again: stay)
    else { S.cur = i; nextSlot = -1; sendPattern(); }
    save(); drawAll();
  }
  function queueFollow() {                                // a bar begins: a chained pattern lines up its next
    const nx = pat().next;
    if (!playing || nextSlot >= 0 || nx == null || nx < 0 || nx > 7 || nx === S.cur) return;
    nextSlot = nx; nextAuto = true;
    post({ type: "pattern", pattern: S.slots[nx], atBar: true });
    drawSlots();
  }
  let sheetSlot = 0;
  const NUMS = [...Array(8).keys()];
  function openSlot(i) {
    sheetSlot = i;
    const p = S.slots[i];
    $("slotTitle").textContent = "Pattern " + (i + 1);
    $("slotName").value = p.name || ""; $("slotName").placeholder = "P" + (i + 1);
    drawSheet();
    const m = $("slotMenu");
    if (m.showModal) m.showModal(); else m.setAttribute("open", "");
  }
  const drawSheet = () => {
    const p = S.slots[sheetSlot], nx = p.next == null || p.next === sheetSlot ? -1 : p.next;
    $("slotNext").innerHTML = `<button type="button" data-next="-1" aria-pressed="${nx < 0}">Repeat</button>` +
      NUMS.filter((k) => k !== sheetSlot).map((k) => `<button type="button" data-next="${k}" aria-pressed="${nx === k}" class="${used(S.slots[k]) ? "is-used" : ""}">${k + 1}</button>`).join("");
    $("slotCopy").innerHTML = NUMS.filter((k) => k !== sheetSlot).map((k) => `<button type="button" data-copy="${k}" class="${used(S.slots[k]) ? "is-used" : ""}">${k + 1}</button>`).join("");
  };
  $("slotMenu").addEventListener("click", (e) => { if (e.target === $("slotMenu")) $("slotMenu").close(); });
  $("slotName").addEventListener("input", () => {
    S.slots[sheetSlot].name = $("slotName").value.replace(/\s+/g, " ").slice(0, 10);
    save(); drawSlots();
  });
  $("slotName").addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); $("slotMenu").close(); } });
  $("slotNext").addEventListener("click", (e) => {
    const b = e.target.closest("button"); if (!b) return;
    begin(); S.slots[sheetSlot].next = +b.dataset.next; commit(); save(); drawSheet(); drawSlots();
  });
  $("slotCopy").addEventListener("click", (e) => {
    const b = e.target.closest("button"); if (!b) return;
    const k = +b.dataset.copy;
    begin(); S.slots[k] = clone(S.slots[sheetSlot]); delete S.slots[k].next; commit();
    if (k === S.cur) sendPattern();
    save(); drawAll(); drawSheet(); buzz();
    toast("Pattern " + (sheetSlot + 1) + " copied to " + (k + 1), "Undo", undo);
  });
  $("slotClear").addEventListener("click", () => {
    const i = sheetSlot;
    begin(); S.slots[i] = { len: 16, bass: ALL16.map(rest), drums: grid([]), name: S.slots[i].name }; commit();
    if (i === S.cur) sendPattern();
    save(); drawAll(); $("slotMenu").close();
    toast("Pattern " + (i + 1) + " cleared", "Undo", undo);
  });

  // ---------------------------------------------------------------------------------------- share links ---
  // a pattern and the sound it was made with, in the link itself: #p=1.<bass>.<drums>.<len>.<tempo>.<swing>.<key>.
  // <wave>.<cutoff>.<reso>.<env>.<decay>.<accent>.<drive>.<delay>.<name>; opening it puts it in a free slot
  const KN = ["cutoff", "reso", "env", "decay", "accent", "drive", "delay"];
  const encode = (p) => {
    const P = S.params, h2 = (v) => v.toString(16).padStart(2, "0"), pc = (v) => Math.round(v * 100);
    const bass = p.bass.map((s) => h2(s.on ? 1 + s.note + 13 * (s.oct + 1) + (s.acc ? 40 : 0) + (s.slide ? 80 : 0) : 0)).join("");
    const drums = p.drums.map((r) => r.reduce((a, v, i) => a | (v ? 1 << i : 0), 0).toString(16).padStart(4, "0")).join("");
    return ["1", bass, drums, p.len, Math.round(P.tempo), pc(P.swing), P.tune, P.wave, ...KN.map((k) => pc(P[k])), encodeURIComponent(p.name || "")].join(".");
  };
  const decode = (c) => {
    const f = c.split(".");
    if (f[0] !== "1" || f.length < 15 || !/^[0-9a-f]{32}$/i.test(f[1]) || !/^[0-9a-f]{20}$/i.test(f[2])) return null;
    const bass = [];
    for (let i = 0; i < 16; i++) {
      let v = parseInt(f[1].substr(i * 2, 2), 16);
      if (!v) { bass.push(rest()); continue; }
      if (v > 159) return null;
      const slide = v >= 80; if (slide) v -= 80;
      const acc = v >= 40; if (acc) v -= 40;
      v -= 1;
      if (v < 0 || v > 38) return null;
      bass.push({ on: true, note: v % 13, oct: Math.floor(v / 13) - 1, acc, slide });
    }
    const drums = LANES.map((_, l) => { const m = parseInt(f[2].substr(l * 4, 4), 16); return ALL16.map((i) => !!(m & (1 << i))); });
    const n = (i, d, lo, hi) => { const v = Number(f[i]); return Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : d; };
    const params = { tempo: n(4, 124, 60, 180), swing: n(5, 54, 50, 75) / 100, tune: n(6, 0, -12, 12) | 0, wave: n(7, 0, 0, 1) | 0 };
    KN.forEach((k, j) => { params[k] = n(8 + j, DEF_PARAMS[k] * 100, 0, 100) / 100; });
    let name = "";
    try { name = decodeURIComponent(f.slice(15).join(".")).slice(0, 10); } catch {}
    return { pattern: { len: n(3, 16, 1, 16) | 0, bass, drums, name }, params };
  };
  function fromLink() {
    const m = location.hash.match(/^#p=(.+)$/);
    if (!m) return;
    let d = null;
    try { d = decode(m[1]); } catch { d = null; }
    try { history.replaceState(null, "", location.pathname + location.search); } catch {}
    if (!d) { toast("That link isn’t an Acid Flower pattern."); return; }
    begin();
    let i = S.slots.findIndex((p) => !used(p));
    if (i < 0) i = S.cur;
    S.slots[i] = d.pattern; S.cur = i; nextSlot = -1;
    Object.assign(S.params, d.params);
    commit(); sendParams(); sendPattern(); save(); drawAll();
    toast("A shared pattern" + (d.pattern.name ? " (" + d.pattern.name + ")" : "") + " is in slot " + (i + 1) + ": press Play", "Undo", undo, 7000);
  }
  addEventListener("hashchange", () => { if ($("gate").hidden) fromLink(); });
  $("slotShare").addEventListener("click", async () => {
    const p = S.slots[sheetSlot], url = location.origin + location.pathname + "#p=" + encode(p);
    const title = "Acid Flower: " + (p.name || "pattern " + (sheetSlot + 1));
    try { if (navigator.share) { await navigator.share({ title, text: "An acid line I made in Acid Flower:", url }); return; } }
    catch (err) { if (err && err.name === "AbortError") return; }
    try { await navigator.clipboard.writeText(url); toast("Link copied"); } catch { window.prompt("Copy this link:", url); }
  });

  // ---------------------------------------------------------------------------------------- recording ---
  // Rec: everything the machine plays (effects and all) into a file; when it stops, Save hands it to the share sheet
  let rec = null, recDest = null, recT = 0, recStart = 0;
  const recMime = () => ["audio/mp4", "audio/webm;codecs=opus", "audio/webm", "audio/ogg"].find((t) => window.MediaRecorder && MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(t)) || "";
  const clock = (s) => Math.floor(s / 60) + ":" + String(Math.floor(s % 60)).padStart(2, "0");
  const drawRec = () => {
    const on = !!(rec && rec.state === "recording"), t = on ? clock((performance.now() - recStart) / 1000) : "Rec";
    for (const id of ["rec", "raveRec"]) { const b = $(id); b.setAttribute("aria-pressed", String(on)); (b.querySelector("span") || b).textContent = t; }
  };
  const setRec = (on) => {
    if (on) {
      if (!node || !window.MediaRecorder) { toast("This browser can’t record. Try Safari 14.5 or later, or Chrome."); return; }
      if (!recDest) { recDest = ctx.createMediaStreamDestination(); node.connect(recDest); }
      const type = recMime(), chunks = [];
      let r;
      try { r = new MediaRecorder(recDest.stream, type ? { mimeType: type } : undefined); } catch (err) { toast("Can’t record: " + err.message); return; }
      r.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
      r.onstop = () => {
        const secs = (performance.now() - recStart) / 1000, t = r.mimeType || type || "audio/webm";
        const ext = /mp4|aac|m4a/.test(t) ? "m4a" : /ogg/.test(t) ? "ogg" : "webm";
        const file = new File([new Blob(chunks, { type: t })], `acid-flower-${stamp()}-${String(Date.now()).slice(-4)}.${ext}`, { type: t.split(";")[0] });
        drawRec();
        toast("Recorded " + clock(secs), "Save", () => saveFile(file, "Acid Flower recording"), 15000);
      };
      rec = r; r.start(1000); recStart = performance.now();
      if (!playing) setPlaying(true);
      clearInterval(recT); recT = setInterval(drawRec, 250);
    } else {
      if (rec && rec.state !== "inactive") rec.stop();
      clearInterval(recT);
    }
    drawRec(); buzz(12);
  };
  for (const id of ["rec", "raveRec"]) onPress($(id), () => setRec(!(rec && rec.state === "recording")));

  // ---------------------------------------------------------------------------------- latch, tap tempo ---
  let latch = false;
  function setLatch(on) {
    latch = on;
    for (const id of ["latch", "raveLatch"]) $(id).setAttribute("aria-pressed", String(on));
    if (!on) { fxSrc.forEach((s2) => s2.delete("L")); fxPublish(); }
  }
  onPress($("raveLatch"), () => setLatch(!latch));
  let taps = [], lastPadTap = 0;
  function tapTempo(t, el) {
    if (taps.length && t - taps[taps.length - 1] > 2000) taps = [];
    taps.push(t); if (taps.length > 5) taps.shift();
    el.classList.remove("is-tap"); void el.offsetWidth; el.classList.add("is-tap");
    if (taps.length < 2) return;
    setParam("tempo", Math.round(60000 / ((taps[taps.length - 1] - taps[0]) / (taps.length - 1))));
    drawStrip(el);
  }

  // ------------------------------------------------------------------------------ the screen stays on ---
  let lock = null;
  const keepAwake = async () => {
    try {
      if (playing && !lock && navigator.wakeLock && !document.hidden) { lock = await navigator.wakeLock.request("screen"); lock.addEventListener("release", () => { lock = null; }); }
      else if (!playing && lock) { const l = lock; lock = null; await l.release(); }
    } catch { lock = null; }
  };
  playHooks.push(keepAwake);
  document.addEventListener("visibilitychange", keepAwake);

  // --------------------------------------------------------------------------------------- the tour ---
  // the first time: four or five hints, each pointing at what it is about (anything not on this screen is skipped)
  const TOUR = [
    ['.st__note[data-s="0"]', "Drag a note up or down to change it. Tap it to rest it."],
    ['[data-tab="punch"]', "Punch: hold a pad to glitch the whole mix, let go to drop back in."],
    ["#xy", "The squelch pad: cutoff left to right, resonance bottom to top. Double-tap it to start over."],
    ["#tiltBtn", "Tilt: lean the device to bend the filter."],
    ['.slot[data-slot="0"]', "Hold a pattern number to name it, copy it, share it, or chain it into a song."],
    ["#rec", "Rec records what you play, to save or send. Have fun!"],
  ];
  let tourI = -1, tourEl = null;
  const endTour = () => {
    tourI = -1; $("tour").hidden = true;
    if (tourEl) tourEl.classList.remove("is-tour");
    tourEl = null;
    try { localStorage.setItem("acid-flower-tour", "1"); } catch {}
  };
  function tour(i) {
    if (tourEl) tourEl.classList.remove("is-tour");
    while (i < TOUR.length) {
      const el = document.querySelector(TOUR[i][0]);
      if (el && el.getClientRects().length && !app.classList.contains("is-rave")) break;
      i++;
    }
    if (i >= TOUR.length) return endTour();
    tourI = i; tourEl = document.querySelector(TOUR[i][0]); tourEl.classList.add("is-tour");
    $("tourMsg").textContent = TOUR[i][1];
    const left = TOUR.slice(i + 1).some(([sel]) => { const el = document.querySelector(sel); return el && el.getClientRects().length; });
    $("tourNext").textContent = left ? "Next" : "Got it";
    $("tourSkip").hidden = !left;
    const b = $("tour"); b.hidden = false;
    const r = tourEl.getBoundingClientRect(), w = Math.min(300, innerWidth - 24), h = b.offsetHeight;
    const below = r.bottom + h + 16 < innerHeight || r.top < h + 16;
    const x = Math.max(12, Math.min(innerWidth - w - 12, r.left + r.width / 2 - w / 2));
    b.style.width = w + "px"; b.style.left = x + "px";
    b.style.top = (below ? Math.min(innerHeight - h - 8, r.bottom + 12) : Math.max(8, r.top - h - 12)) + "px";
    b.classList.toggle("is-above", !below);
    $("tourArrow").style.left = Math.max(14, Math.min(w - 14, r.left + r.width / 2 - x)) + "px";
  }
  $("tourNext").addEventListener("click", () => tour(tourI + 1));
  $("tourSkip").addEventListener("click", endTour);
  $("tourAgain").addEventListener("click", () => { menu.close(); setTimeout(() => tour(0), 200); });
  addEventListener("resize", () => { if (tourI >= 0) tour(tourI); });

  window.acid = { state: () => S, undo, redo, encode: (i) => encode(S.slots[i == null ? S.cur : i]), latch: () => latch, nextSlot: () => nextSlot, playing: () => playing, viz: () => viz, rave, boot, tilt: () => tiltOn, fold: () => [...document.documentElement.classList].filter((c) => c.startsWith("fold")).join(" ") };
})();
