// SPDX-License-Identifier: GPL-3.0-only
// Acid Flower: the touch surface. The sound and the clock are acid-worklet.js; this file keeps the eight patterns and the
// knobs (saved on the device), sends them to the worklet as they change, and draws the pixel rave from what the worklet
// sends back (the step, the filter's motion, the accents and drum hits, a scrap of the waveform).
"use strict";
(() => {
  const $ = (id) => document.getElementById(id);
  const NOTE = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B", "C"];
  const LANES = [["Kick", "#FFE100"], ["Snare", "#FF8A1F"], ["Clap", "#FF2FB4"], ["Hat", "#2BF0FF"], ["Open hat", "#B4FF2B"],
                 ["Tom", "#B98CFF"], ["Rim", "#FF9BD5"], ["Cowbell", "#FFC94D"]];
  const MAXS = 32;                                        // (steps in a pattern at most: two pages of 16)
  const STORE = "acid-flower-v1";

  // ------------------------------------------------------------------------------------------ the patterns ---
  const rest = () => ({ on: false, note: 0, oct: 0, acc: false, slide: false });
  const b = (note, oct = 0, f = "") => ({ on: true, note, oct, acc: f.includes("a"), slide: f.includes("s") });
  const grid = (spec) => LANES.map((_, l) => { const r = new Array(MAXS).fill(false); for (const s of spec[l] || []) { r[s] = true; if (s < 16) r[s + 16] = true; } return r; });
  const ALL16 = [...Array(16).keys()], ALL32 = [...Array(MAXS).keys()];
  // a pattern, filled out to today's shape: 32 steps of bass and lead (each with its chance and repeats), 8 drums with
  // their chance and repeats per step, each track's own length (0: the pattern's), the motion (knob moves)
  const cl = (v, a, b2, d) => { v = Number(v); return Number.isFinite(v) ? Math.max(a, Math.min(b2, Math.round(v))) : d; };
  const padA = (a, n, f) => { a = Array.isArray(a) ? a.slice(0, n) : []; while (a.length < n) a.push(f(a.length)); return a; };
  const stepOK = (x) => (x && typeof x === "object" ? { on: !!x.on, note: cl(x.note, 0, 12, 0), oct: cl(x.oct, -1, 1, 0), acc: !!x.acc, slide: !!x.slide,
    prob: cl(x.prob, 0, 100, 100), rat: cl(x.rat, 1, 4, 1) } : rest());
  const normPat = (p) => {
    p = p && typeof p === "object" ? p : {};
    const was = Array.isArray(p.bass) ? p.bass.length : 16;
    p.len = cl(p.len, 1, MAXS, 16);
    p.bass = padA(p.bass, MAXS, (i) => (was <= 16 && i >= 16 && Array.isArray(p.bass) ? rest() : rest())).map(stepOK);
    p.lead = padA(p.lead, MAXS, rest).map(stepOK);
    p.drums = padA(p.drums, LANES.length, () => []).map((r) => padA(r, MAXS, () => false).map(Boolean));
    p.dp = padA(p.dp, LANES.length, () => []).map((r) => padA(r, MAXS, () => 100).map((v) => cl(v, 0, 100, 100)));
    p.dr = padA(p.dr, LANES.length, () => []).map((r) => padA(r, MAXS, () => 1).map((v) => cl(v, 1, 4, 1)));
    p.dlen = padA(p.dlen, LANES.length, () => 0).map((v) => cl(v, 0, MAXS, 0));
    p.llen = cl(p.llen, 0, MAXS, 0);
    if (p.motion && typeof p.motion === "object") { for (const k of Object.keys(p.motion)) if (!Array.isArray(p.motion[k])) delete p.motion[k]; }
    else delete p.motion;
    return p;
  };
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
  const blank = () => normPat({ len: 16, drums: grid([[0, 4, 8, 12]]) });
  const empty = () => normPat({ len: 16 });
  const clone = (o) => JSON.parse(JSON.stringify(o));
  const DEF_PARAMS = { cutoff: 0.32, reso: 0.72, env: 0.6, decay: 0.42, accent: 0.65, drive: 0.3, delay: 0.18, volume: 0.8,
                       drums: 0.8, wave: 0, tempo: 124, swing: 0.54, tune: 0, verb: 0.12, pump: 0, lead: 0.6, leadWave: 1,
                       dk: LANES.map(() => [0, 0.5, 0.8]) };
  const fresh = () => ({ slots: [...STARTERS.map((p) => normPat(clone(p))), blank(), blank(), blank(), blank()], cur: 0, params: clone(DEF_PARAMS) });
  const valid = (s) => s && Array.isArray(s.slots) && s.slots.length === 8 && s.slots.every((p) => p && Array.isArray(p.bass) && Array.isArray(p.drums));
  const fixAll = (s) => {                                 // (patterns saved by an older version: filled out)
    s.slots = s.slots.map(normPat);
    s.cur = cl(s.cur, 0, 7, 0);
    s.params = { ...clone(DEF_PARAMS), ...s.params };
    s.params.dk = padA(s.params.dk, LANES.length, () => [0, 0.5, 0.8]).map((d) => [cl(d && d[0], -12, 12, 0), Math.max(0, Math.min(1, Number(d && d[1]) >= 0 ? +d[1] : 0.5)), Math.max(0, Math.min(1, Number(d && d[2]) >= 0 ? +d[2] : 0.8))]);
    if (!Array.isArray(s.song)) s.song = [];
    return s;
  };
  let S;
  try { S = JSON.parse(localStorage.getItem(STORE)); } catch { S = null; }
  if (!valid(S)) S = fresh();
  fixAll(S);
  let saveT = 0;
  const save = () => { clearTimeout(saveT); saveT = setTimeout(() => { try { localStorage.setItem(STORE, JSON.stringify(S)); } catch {} }, 250); };
  const pat = () => S.slots[S.cur];
  const used = (p) => p.bass.some((s) => s.on) || (p.lead || []).some((s) => s.on) ||
    p.drums.some((r, l) => r.slice(0, 16).some(Boolean) && !(l === 0 && r.slice(0, 16).filter(Boolean).length === 4 && [0, 4, 8, 12].every((i) => r[i])));
  // the editor's view: which melodic track (the bass or the lead), which page of 16 steps
  let track = "bass", page = 0, pageT = 0;
  let anchor = null, sel = null, clip = null;              // (the keyboard's place, its selection, what was copied)
  const trk = () => pat()[track];
  const trkLen = (p = pat()) => (track === "lead" ? p.llen || p.len : p.len);
  const laneLen = (l, p = pat()) => p.dlen[l] || p.len;
  const stp = (col) => page * 16 + col;                   // (a column's step on this page)

  // --------------------------------------------------------------------------------------------- the sound ---
  let lastKnobUp = null;
  let ctx = null, node = null, playing = false, nextSlot = -1, nextAuto = false, barN = 0;
  const playHooks = [];                                   // (things that follow Play: the screen staying awake)
  const buzz = (ms = 8) => { try { if (navigator.vibrate) navigator.vibrate(ms); } catch {} };   // (a tick, where the device has one)
  const post = (m) => node && node.port.postMessage(m);
  const sendParams = () => { post({ type: "params", params: S.params }); if (typeof recordMotion === "function") recordMotion(); };
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
    try { const id = localStorage.getItem("acid-flower-output"); if (id && ctx.setSinkId) ctx.setSinkId(id).catch(() => {}); } catch {}
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
      setTimeout(backupNudge, 4000);
      watchSound();
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
    $("ravePlay").querySelector("span").textContent = on ? "Stop" : "Play";
    if (on) barN = 0;
    post({ type: on ? "play" : "stop" });
    if (!on && nextSlot >= 0) {
      if (nextAuto) { nextSlot = -1; nextAuto = false; sendPattern(); drawSlots(); }   // (a chain's next: stopping stays put)
      else { S.cur = nextSlot; nextSlot = -1; drawAll(); sendPattern(); }
    }
    if (!on) markStep(null);
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
  const drawStrip = (el) => strips.forEach((x) => x.dataset.p === el.dataset.p && drawOne(x));   // (tempo has two: the bar's and the rave's)
  const drawKey = (k) => strips.forEach((x) => x.dataset.p === k && drawOne(x));
  const drawOne = (el) => {
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
  const bassEl = $("bass"), leadEl = $("lead"), drumsEl = $("drums");
  // studio view (a big desktop window, with a mouse or a trackpad): the bass, the lead, the drums and the punch-ins all
  // at once; the tools act on the one last touched. Anything smaller (phones, iPads) keeps the tabs.
  const studioMQ = matchMedia("(min-width: 1400px) and (min-height: 800px) and (hover: hover) and (pointer: fine)");
  let studio = studioMQ.matches, focusArea = "bass";
  const melOf = (t) => (t.closest(".bass") === leadEl ? "lead" : studio ? "bass" : track);
  const buildMel = (host) => {
  const cols = [];
  // the rows' names, once at the start of the row (a second time where a phone breaks the 16 steps into two rows of 8)
  const label = (second) => {
    const d = document.createElement("div");
    d.className = "st st--lab" + (second ? " st--lab2" : "");
    d.setAttribute("aria-hidden", "true");
    d.innerHTML = `<b class="st__n">${second ? "9" : "1"}&#8594;</b><span class="st__l st__l--note"><i>Hi</i><i>Note</i><i>Lo</i></span>` +
                  `<span class="st__l">Oct</span><span class="st__l">Acc</span><span class="st__l">Slide</span>`;
    host.appendChild(d);
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
    host.appendChild(c);
    cols.push({ el: c, note: c.querySelector(".st__note"), pill: c.querySelector(".st__pill"), oct: c.querySelector('[data-t="oct"]'), acc: c.querySelector('[data-t="acc"]'), sld: c.querySelector('[data-t="slide"]') });
  }
  return cols;
  };
  // the melodic editors: the tabs' one (the bass or the lead, whichever tab), and the studio's lead
  const eds = [{ el: bassEl, cols: buildMel(bassEl), fixed: "bass" }, { el: leadEl, cols: buildMel(leadEl), fixed: "lead" }];
  const edTrack = (ed) => (studio ? ed.fixed : track);
  const cols = eds[0].cols;
  const cells = LANES.map(([name, col], l) => {
    const n = document.createElement("button");
    n.type = "button"; n.className = "dr__name"; n.dataset.lane = l; n.textContent = name; n.style.setProperty("--c", col);
    drumsEl.appendChild(n);
    return ALL16.map((s) => {
      const d = document.createElement("div");
      d.className = "dr" + (Math.floor(s / 4) % 2 ? " q" : "");
      d.dataset.lane = l; d.dataset.s = s; d.style.setProperty("--c", col); d.setAttribute("role", "button");
      drumsEl.appendChild(d);
      return d;
    });
  });
  const drawBass = () => { for (const ed of eds) if (ed.el === bassEl || studio) drawMel(ed); };
  const drawMel = (ed) => {
    const p = pat(), track = edTrack(ed), steps = p[track], len = track === "lead" ? p.llen || p.len : p.len;
    ed.el.classList.toggle("is-lead", track === "lead");
    ed.el.classList.toggle("is-focus", studio && focusArea === track);
    if (studio) ed.el.querySelectorAll(".st--lab .st__n").forEach((n, k) => (n.textContent = (k ? "" : track === "lead" ? "LEAD" : "BASS")));
    ed.cols.forEach((c, col) => {
      const i = stp(col), s = steps[i];
      c.el.querySelector(".st__n").textContent = i + 1;
      c.el.classList.toggle("is-on", s.on);
      c.el.classList.toggle("is-out", i >= len);
      c.note.dataset.prob = s.on && s.prob < 100 ? s.prob + "%" : "";
      c.note.dataset.rat = s.on && s.rat > 1 ? "\u00d7" + s.rat : "";
      c.pill.textContent = s.on ? NOTE[s.note] + (s.note === 12 ? "′" : "") : "rest";
      c.note.style.setProperty("--h", String(s.on ? s.note / 12 : 0.5));
      c.note.setAttribute("aria-label", (track === "lead" ? "Lead" : "Bass") + " step " + (i + 1) + ": " + (s.on ? NOTE[s.note] + (s.acc ? ", accent" : "") + (s.slide ? ", slide" : "") + (s.prob < 100 ? ", " + s.prob + "% chance" : "") + (s.rat > 1 ? ", repeats " + s.rat : "") : "rest") + ". Drag to change, tap to rest, hold for more.");
      c.oct.textContent = s.oct > 0 ? "Up" : s.oct < 0 ? "Down" : "";
      c.oct.classList.toggle("is-up", s.oct > 0); c.oct.classList.toggle("is-dn", s.oct < 0);
      c.oct.setAttribute("aria-pressed", String(s.oct !== 0));
      c.acc.textContent = s.acc ? "Acc" : ""; c.acc.classList.toggle("is-acc", s.acc); c.acc.setAttribute("aria-pressed", String(s.acc));
      c.sld.textContent = s.slide ? "Slide" : ""; c.sld.classList.toggle("is-sld", s.slide); c.sld.setAttribute("aria-pressed", String(s.slide));
    });
  };
  const drawDrums = () => {
    const p = pat();
    cells.forEach((row, l) => row.forEach((d, col) => {
      const s = stp(col), v = p.drums[l][s];
      d.classList.toggle("is-on", v); d.classList.toggle("is-out", s >= laneLen(l, p));
      d.dataset.prob = v && p.dp[l][s] < 100 ? p.dp[l][s] + "%" : "";
      d.dataset.rat = v && p.dr[l][s] > 1 ? "\u00d7" + p.dr[l][s] : "";
      d.setAttribute("aria-pressed", String(v)); d.setAttribute("aria-label", LANES[l][0] + ", step " + (s + 1));
    }));
    drumsEl.querySelectorAll(".dr__name").forEach((n) => { const l = +n.dataset.lane; n.dataset.len = p.dlen[l] ? String(p.dlen[l]) : ""; });
    drumsEl.classList.toggle("is-focus", studio && focusArea === "drums");
  };
  // the pages: 1-16 and 17-32, when anything is longer than 16
  const drawPager = () => {
    const p = pat(), long = p.len > 16 || p.llen > 16 || p.dlen.some((v) => v > 16);
    $("pager").hidden = !long;
    if (!long && page) page = 0;
    $("pager").querySelectorAll("button").forEach((b2, i) => b2.setAttribute("aria-pressed", String(i === page)));
  };
  const drawSlots = () => {
    document.querySelectorAll(".slot[data-slot]").forEach((e) => {
      const i = +e.dataset.slot;
      e.classList.toggle("is-cur", i === S.cur);
      e.classList.toggle("is-next", i === nextSlot);
      e.classList.toggle("is-used", used(S.slots[i]));
      const p = S.slots[i], nx = p.next == null ? -1 : p.next;
      e.dataset.next = nx >= 0 && nx !== i ? "\u2192" + (nx + 1) : "";
      e.title = (p.name ? p.name + ": " : "") + "pattern " + (i + 1) + (nx >= 0 && nx !== i ? ", then " + (nx + 1) : "") + " (hold for more)";
    });
    drawStatus();
    drawTitle();
  };
  const drawAll = () => {
    drawPager(); drawBass(); drawDrums(); drawSlots(); drawXY(); strips.forEach(drawOne);
    const p = pat();
    $("len").textContent = tab() === "drums" ? (p.dlen.every((v) => v === p.dlen[0]) ? p.dlen[0] || p.len : "mix") : trkLen(p);
    $("tune").textContent = (S.params.tune > 0 ? "+" : "") + (S.params.tune ? S.params.tune : "C");
    $("wave").querySelector("b").textContent = (track === "lead" ? S.params.leadWave : S.params.wave) ? "Square" : "Saw";
    $("focusLbl").textContent = studio ? "Tools: " + (tab() === "drums" ? "Drums" : tab() === "lead" ? "Lead" : "Bass") : "";
    if (typeof drawSel === "function" && sel) drawSel();
  };
  for (const box of [$("slots"), $("raveSlots")]) for (let i = 0; i < 8; i++) {   // (the bar's, and rave mode's)
    const e = document.createElement("button");
    e.type = "button"; e.className = "slot"; e.textContent = i + 1; e.dataset.slot = i;
    box.appendChild(e);
  }
  const edited = () => { commit(); sendPattern(); save(); drawSlots(); };
  const audition = (i) => {
    if (playing) return;
    const s = trk()[i];
    if (s.on) post({ type: "audition", note: (track === "lead" ? 48 : 36) + S.params.tune + s.note + 12 * s.oct, acc: s.acc, voice: track });
  };

  // ---------------------------------------------------------------------------------------------- touch ---
  const app = $("app"), ptr = new Map();
  app.addEventListener("pointerdown", (e) => {
    const t = e.target.closest && e.target.closest(".strip, .xy, .st__note, .st__t, .dr, .dr__name, .slot, #play");
    if (!t) return;
    e.preventDefault();
    if (t.id === "play") return setPlaying(!playing);
    if (t.classList.contains("slot")) {                // a tap picks it; a hold (or a right-click) opens its menu
      const i = +t.dataset.slot;
      if (e.button === 2) { openSlot(i); return; }
      pickSlot(i); buzz();
      ptr.set(e.pointerId, { kind: "slot", i, x0: e.clientX, y0: e.clientY, mouse: e.pointerType === "mouse", hold: setTimeout(() => { ptr.delete(e.pointerId); buzz(15); openSlot(i); }, 480) });
      try { app.setPointerCapture(e.pointerId); } catch {}
      return;
    }
    if ((t.classList.contains("st__note") || t.classList.contains("dr")) && e.pointerType === "mouse") {
      if (e.shiftKey) { selectFrom(t, true); ptr.set(e.pointerId, { kind: "sel" }); try { app.setPointerCapture(e.pointerId); } catch {} return; }
      clearSel(); setAnchor(t); t.focus({ preventScroll: true });
    }
    if (t.classList.contains("st__t") || t.classList.contains("st__note")) { track = melOf(t); setFocus(track); }
    else if (t.classList.contains("dr") || t.classList.contains("dr__name")) setFocus("drums");
    if (t.classList.contains("st__t") || t.classList.contains("dr") || t.classList.contains("st__note")) begin();   // (one gesture, one undo)
    if (t.classList.contains("st__t")) {
      buzz();
      const i = stp(+t.dataset.s), s = trk()[i];
      if (t.dataset.t === "oct") s.oct = s.oct === 0 ? 1 : s.oct === 1 ? -1 : 0;
      else s[t.dataset.t] = !s[t.dataset.t];
      if (!s.on) s.on = true;
      drawBass(); edited(); audition(i);
      return;
    }
    if (t.classList.contains("dr__name")) {             // a tap hears it; a hold opens its knobs
      const l = +t.dataset.lane;
      post({ type: "hit", lane: l });
      ptr.set(e.pointerId, { kind: "slot", hold: setTimeout(() => { ptr.delete(e.pointerId); buzz(15); openLane(l); }, 480) });
      try { app.setPointerCapture(e.pointerId); } catch {}
      return;
    }
    if (t.classList.contains("dr")) {
      const l = +t.dataset.lane, s = stp(+t.dataset.s), v = !pat().drums[l][s];
      pat().drums[l][s] = v; buzz();
      const q = { kind: "dr", v, last: t };
      q.hold = setTimeout(() => {                         // a hold: the step stays on, and its menu opens
        if (q.last !== t) return;
        ptr.delete(e.pointerId); pat().drums[l][s] = true; drawDrums(); edited(); buzz(15); openStep("drum", l, s);
      }, 480);
      ptr.set(e.pointerId, q);
      drawDrums(); edited();
      if (v && !playing) post({ type: "hit", lane: l });
    } else if (t.classList.contains("st__note")) {
      const q = { kind: "note", i: stp(+t.dataset.s), y0: e.clientY, acc: 0, moved: false, px: Math.max(7, (t.clientHeight * 0.74) / 12) };
      q.hold = setTimeout(() => { if (q.moved) return; ptr.delete(e.pointerId); buzz(15); openStep(track, 0, q.i); }, 480);
      ptr.set(e.pointerId, q);
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
      if (d && d !== p.last) { p.last = d; clearTimeout(p.hold); pat().drums[+d.dataset.lane][stp(+d.dataset.s)] = p.v; drawDrums(); edited(); }
    } else if (p.kind === "note") {
      const dy = p.y0 - e.clientY;
      if (Math.abs(dy) > 8) { p.moved = true; clearTimeout(p.hold); }
      if (!p.moved) return;
      const steps = Math.trunc(dy / p.px);
      if (steps) {
        p.y0 -= steps * p.px;
        const s = trk()[p.i];
        s.on = true;
        s.note = Math.max(0, Math.min(12, s.note + steps));
        drawBass(); edited(); audition(p.i);
      }
    } else if (p.kind === "sel") {                       // (Shift-dragging a selection)
      const el = document.elementFromPoint(e.clientX, e.clientY), c = el && el.closest && el.closest(".st__note, .dr");
      if (c) selectFrom(c, true);
    } else if (p.kind === "slot" && p.mouse) {         // (a mouse dragging a pattern number: onto another copies it)
      if (!p.drag && Math.abs(e.clientX - p.x0) + Math.abs(e.clientY - p.y0) > 10) { p.drag = true; clearTimeout(p.hold); document.documentElement.classList.add("is-slotdrag"); }
      if (p.drag) {
        const el = document.elementFromPoint(e.clientX, e.clientY), d = el && el.closest && el.closest(".slot[data-slot]");
        document.querySelectorAll(".slot.is-drop").forEach((x) => x !== d && x.classList.remove("is-drop"));
        if (d && +d.dataset.slot !== p.i) d.classList.add("is-drop");
      }
    } else if (p.kind === "strip") {
      const sp = spec(p.k), d = p.y - e.clientY;
      p.y = e.clientY;
      if (Math.abs(e.clientY - p.y0) + Math.abs(e.clientX - p.x0) > 8 && !p.repeated) { p.moved = true; clearTimeout(p.hold); }
      if (!p.moved) return;
      p.acc += d;
      const px = sp.px * (e.shiftKey ? 5 : 1), n = Math.trunc(p.acc / px);   // (Shift: fine)
      if (n) { p.acc -= n * px; setParam(p.k, S.params[p.k] + n * sp.unit); drawStrip(p.el); }
    }
  });
  const up = (e) => {
    const p = ptr.get(e.pointerId);
    if (!p) return;
    ptr.delete(e.pointerId);
    if (p.kind === "slot") {
      clearTimeout(p.hold);
      if (p.drag) {
        document.documentElement.classList.remove("is-slotdrag");
        document.querySelectorAll(".slot.is-drop").forEach((x) => x.classList.remove("is-drop"));
        const el = document.elementFromPoint(e.clientX, e.clientY), d = el && el.closest && el.closest(".slot[data-slot]"), k = d ? +d.dataset.slot : -1;
        if (k >= 0 && k !== p.i && e.type === "pointerup") {
          begin(); S.slots[k] = clone(S.slots[p.i]); delete S.slots[k].next; commit();
          if (k === S.cur) sendPattern();
          save(); drawAll(); toast("Pattern " + (p.i + 1) + " copied to " + (k + 1), "Undo", undo);
        }
      }
    }
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
      // a mouse's double-click on a knob puts it back (not tempo: its middle is tap tempo; not a finger's double tap)
      if (!p.moved && e.type === "pointerup" && e.pointerType === "mouse" && p.k !== "tempo" && !p.side) {
        const now = performance.now();
        if (lastKnobUp && lastKnobUp.el === p.el && now - lastKnobUp.t < 400 && DEF_PARAMS[p.k] != null) {
          setParam(p.k, DEF_PARAMS[p.k]); drawStrip(p.el); toast(p.el.querySelector("b").textContent + " back to " + spec(p.k).fmt(DEF_PARAMS[p.k])); lastKnobUp = null;
        } else lastKnobUp = { el: p.el, t: now };
      }
    }
    if (p.kind === "dr" || p.kind === "note") clearTimeout(p.hold);
    if (p.kind === "note" && !p.moved && e.type === "pointerup") {   // a tap: rest, or back on
      const s = trk()[p.i];
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
  // a keyboard: Space plays, Shift with 1 to 8 picks a pattern, the arrows the tempo, R the rave, Cmd/Ctrl Z undo
  // (Shift: redo); the number row on its own holds the punch-ins (below)
  addEventListener("keydown", (e) => {
    if (document.querySelector("dialog[open]") || !$("gate").hidden) return;
    if (e.target && e.target.closest && e.target.closest("input, textarea, select")) return;
    const mod = e.metaKey || e.ctrlKey;
    if (mod && e.code === "KeyZ") { e.preventDefault(); if (e.shiftKey) redo(); else undo(); return; }
    if (mod && (e.code === "KeyC" || e.code === "KeyX" || e.code === "KeyV" || e.code === "KeyA")) { if (clipKey(e)) e.preventDefault(); return; }
    if (mod || e.altKey) return;
    if (e.key === "?") { e.preventDefault(); show($("keysMenu")); return; }
    if (e.code === "KeyF" && e.shiftKey) { e.preventDefault(); setFull(!fsNow()); return; }
    if (e.code === "Escape" && sel) { clearSel(); return; }
    if ((e.code === "Delete" || e.code === "Backspace") && sel) { e.preventDefault(); clearRange(); return; }
    if (pianoDown(e)) return;
    if (e.code === "Space") { e.preventDefault(); setPlaying(!playing); }
    else if (e.shiftKey && /^Digit[1-8]$/.test(e.code)) { e.preventDefault(); pickSlot(+e.code.slice(5) - 1); }
    else if (e.code === "ArrowLeft" || e.code === "ArrowRight") {
      e.preventDefault(); setParam("tempo", S.params.tempo + (e.code === "ArrowRight" ? 1 : -1) * (e.shiftKey ? 5 : 1)); drawKey("tempo");
    } else if (e.code === "BracketRight" || e.code === "BracketLeft") { if (e.code === "BracketRight") rave.next(); else rave.back(); drawScenes(); }
    else if (e.code === "KeyR" && !e.repeat) setRave(!app.classList.contains("is-rave"));
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
    if (t.dataset.tab === "lead" || t.dataset.tab === "bass") track = t.dataset.tab;
    bassEl.hidden = t.dataset.tab !== "bass" && t.dataset.tab !== "lead";
    drumsEl.hidden = t.dataset.tab !== "drums";
    $("punch").hidden = t.dataset.tab !== "punch";
    $("latch").hidden = t.dataset.tab !== "punch";
    app.classList.toggle("is-tab-filter", t.dataset.tab === "filter");   // (short phones: the filter has its own tab)
    document.querySelector(".tools").style.visibility = t.dataset.tab === "punch" || t.dataset.tab === "filter" ? "hidden" : "";
    drawAll();
  });
  act("[data-page]", (x) => { page = +x.dataset.page; pageT = performance.now(); drawAll(); markStep(viz); });
  // the Filter tab only shows on short phones: on a bigger screen (a turn, an unfold) it hands back to the bass line
  addEventListener("resize", () => {
    const f = document.querySelector('[data-tab="filter"]');
    if (app.classList.contains("is-tab-filter") && !f.getClientRects().length) runAct(document.querySelector('[data-tab="bass"]'));
  });
  function tab() { return studio ? (focusArea === "drums" ? "drums" : track) : !bassEl.hidden ? track : "drums"; }
  // the studio's focus: what the tools (wave, length, mutate, random, clear) act on
  function setFocus(area) {
    if (!studio || area === focusArea) return;
    focusArea = area; if (area !== "drums") track = area;
    drawAll();
  }
  const applyStudio = () => {
    studio = studioMQ.matches;
    document.documentElement.classList.toggle("studio", studio);
    if (studio) {
      bassEl.hidden = false; leadEl.hidden = false; drumsEl.hidden = false; $("punch").hidden = false; $("latch").hidden = false;
      app.classList.remove("is-tab-filter"); document.querySelector(".tools").style.visibility = "";
      focusArea = track;
    } else {
      leadEl.hidden = true;
      runAct(document.querySelector('[data-tab][aria-selected="true"]') || document.querySelector('[data-tab="bass"]'));
    }
    drawAll(); requestAnimationFrame(fitViz);
  };
  (studioMQ.addEventListener ? studioMQ.addEventListener("change", applyStudio) : studioMQ.addListener(applyStudio));
  act("#wave", () => { begin(); const k = track === "lead" ? "leadWave" : "wave"; S.params[k] = S.params[k] ? 0 : 1; commit(); sendParams(); save(); drawAll(); });
  act("[data-tune]", (x) => { begin(); S.params.tune = Math.max(-12, Math.min(12, S.params.tune + +x.dataset.tune)); commit(); sendParams(); save(); drawAll(); });
  // Len: the bass's is the pattern's (the bar it changes on); the lead's and the drums' are their own (all the drums at
  // once here; one drum's in its menu): different lengths drift against each other
  act("[data-len]", (x) => {
    begin();
    const p = pat(), d = +x.dataset.len;
    if (tab() === "drums") { const v = Math.max(1, Math.min(MAXS, (p.dlen[0] || p.len) + d)); p.dlen = p.dlen.map(() => (v === p.len ? 0 : v)); }
    else if (track === "lead") { const v = Math.max(1, Math.min(MAXS, (p.llen || p.len) + d)); p.llen = v === p.len ? 0 : v; }
    else p.len = Math.max(1, Math.min(MAXS, p.len + d));
    edited(); drawAll();
  });
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
    const tom = Math.random() < 0.3 ? [pick([10, 13, 14, 15])] : [], rim = Math.random() < 0.35 ? [pick([3, 7, 11]), pick([6, 14])] : [];
    const bell = Math.random() < 0.15 ? [pick([2, 10]), pick([5, 13])] : [];
    return grid([kick, snare, clap, hat, open, tom, rim, bell]);
  };
  const doRandom = () => {
    begin();
    if (tab() !== "drums") {
      const sc = pick(SCALES), half = ALL16.map(() => stepOK(randStep(sc)));
      if (track === "bass") half[0] = stepOK({ on: true, note: 0, oct: 0, acc: true, slide: false });
      else half.forEach((x, i) => { if (Math.random() < 0.45) x.on = false; x.oct = Math.min(1, x.oct); });
      pat()[track] = [...half, ...half.map((x) => ({ ...x }))];
    } else { const g = randomDrums(); pat().drums = g; }
    edited(); drawAll(); toast("A new " + (tab() === "drums" ? "beat" : tab() === "lead" ? "lead line" : "bass line") + " (hold Random for styles)", "Undo", undo);
  };
  act("#mutate", () => {
    begin();
    if (tab() !== "drums") {
      const sc = pick(SCALES);
      for (let n = 0; n < 3; n++) {
        const i = Math.floor(Math.random() * trkLen()), s = trk()[i], r = randStep(sc), f = pick(["note", "oct", "acc", "slide", "on"]);
        s[f] = r[f];
        if (f === "note") s.on = true;
      }
    } else {
      for (let n = 0; n < 2; n++) { const l = pick([1, 3, 4, 2, 5, 6, 7]), s = Math.floor(Math.random() * laneLen(l)); pat().drums[l][s] = !pat().drums[l][s]; }
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
    if (tab() !== "drums") pat()[track] = ALL32.map(rest);
    else { pat().drums = grid([]); pat().dp = pat().dp.map((r) => r.map(() => 100)); pat().dr = pat().dr.map((r) => r.map(() => 1)); }
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
      d.innerHTML = `<kbd>${["1", "2", "3", "4", "5", "6", "7", "8", "9", "0", "-", "="][i]}</kbd><b>${a}</b><small>${b2}</small>`;
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
    if (i < 0 || e.repeat || e.shiftKey || e.metaKey || e.ctrlKey || e.altKey || document.querySelector("dialog[open]")) return;
    if (e.target && e.target.closest && e.target.closest("input, textarea, select")) return;   // (typing in a field)
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
  // the playhead: the bass at the pattern's step; the lead and each drum at their own (their lengths can differ)
  function markStep(m) {
    const p = pat(), on = m && m.step >= 0, a = on ? (m.abs >= 0 ? m.abs : m.step) : -1;
    for (const ed of eds) {
      const tr = edTrack(ed), ps = !on ? -1 : tr === "lead" ? a % (p.llen || p.len) : m.step;
      ed.cols.forEach((c, col) => c.el.classList.toggle("is-now", stp(col) === ps));
    }
    cells.forEach((row, l) => { const dp = on ? a % laneLen(l, p) : -1; row.forEach((d, col) => d.classList.toggle("is-now", stp(col) === dp)); });
  }
  let viz = { step: -1 }, lastStep = -2;
  const rave = new globalThis.AcidRave($("viz"), { pattern: () => pat(), params: () => S.params, slot: () => S.cur, playing: () => playing, name: () => pat().name || "" });
  const onViz = (m) => {
    viz = m;
    if (m.p && playing && !motionOn && hasMotion() && !ptr.size) {   // (motion playing back: the knobs follow it)
      let ch = false;
      for (const k of ["cutoff", "reso", "env"]) if (Math.abs(S.params[k] - m.p[k]) > 1e-4) { S.params[k] = m.p[k]; ch = true; }
      if (ch) { drawXY(); drawKey("env"); }
    }
    rave.event(m);
    if (m.step !== lastStep) {
      lastStep = m.step;
      // the page follows the playhead (unless a page was picked in the last few seconds)
      if (m.step >= 0 && !$("pager").hidden && performance.now() - pageT > 4000) { const pg = m.step >= 16 ? 1 : 0; if (pg !== page) { page = pg; drawAll(); } }
      markStep(m);
      // the Play buttons pulse on the beat, harder on the bar's first
      if (m.step >= 0 && m.step % 4 === 0) for (const b of [$("play"), $("ravePlay")]) {
        b.classList.remove("beat", "down"); void b.offsetWidth; b.classList.add("beat"); if (m.step === 0) b.classList.add("down");
      }
      if (m.step === 0 && nextSlot >= 0) { S.cur = nextSlot; nextSlot = -1; nextAuto = false; save(); drawAll(); }
      if (m.step === 0) { queueFollow(); if (playing) { barN++; drawStatus(); } }
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
  // the VJ's settings (the panel is further down): saved on the device
  const VJS = (() => { const d = { ...globalThis.AcidRave.VJ0, fill: true, rec: "sound" }; try { return { ...d, ...JSON.parse(localStorage.getItem("acid-flower-vj") || "{}"), text: "" }; } catch { return d; } })();
  // rave mode, Fill: the picture covers the screen (cropped at the sides when the screen is narrower than 240 x 150;
  // the readouts move in to what shows); Fit, a fold, or the editor: the whole picture, fitted
  const fitViz = () => {
    vizEl.style.width = ""; vizEl.style.height = "";
    const r = vizEl.getBoundingClientRect();
    if (r.width < 8 || r.height < 8) return;
    rave.setWidth((150 * r.width) / r.height);
    const folded = /fold-/.test(document.documentElement.className), fill = app.classList.contains("is-rave") && VJS.fill && !folded;
    const k = fill ? Math.max(r.width / rave.W, r.height / 150) : Math.min(r.width / rave.W, r.height / 150);
    vizEl.style.width = (fill ? Math.ceil(rave.W * k) : Math.floor(rave.W * k)) + "px"; vizEl.style.height = (fill ? Math.ceil(150 * k) : Math.floor(150 * k)) + "px";
    if (fill) { const vis = r.width / k; rave.setView((rave.W - vis) / 2, (rave.W + vis) / 2); }
  };
  if (window.ResizeObserver) new ResizeObserver(() => requestAnimationFrame(fitViz)).observe(document.querySelector(".rave"));
  addEventListener("resize", () => requestAnimationFrame(fitViz));
  fitViz();
  // rave mode: the display fills the screen, and the whole of it is the squelch pad. Along the top: where the set is,
  // the patterns, the tempo, Tilt, Lock, full screen; along the bottom: the punch-ins, Play, Rec, Latch, the scene,
  // Done. Two fingers on the picture: swipe for a scene, pinch for the squelch (env mod), tap for Latch, swipe down to
  // leave. The controls fade after 3 s without a touch.
  const raving = () => app.classList.contains("is-rave");
  const raveEl = document.querySelector(".rave");
  let locked = false, idleT = 0;
  const vTouch = new Map();
  const poke = () => {
    app.classList.remove("rave-idle");
    clearTimeout(idleT);
    if (raving()) idleT = setTimeout(() => { if (!vTouch.size && $("raveScenes").hidden && $("vjPanel").hidden) app.classList.add("rave-idle"); else poke(); }, 3000);
  };
  for (const t of ["pointerdown", "pointermove"]) raveEl.addEventListener(t, () => { if (raving()) poke(); }, true);
  addEventListener("keydown", () => { if (raving()) poke(); }, true);
  const hint = (t) => { const h = $("raveHint"); h.textContent = t; h.classList.remove("is-on"); void h.offsetWidth; h.classList.add("is-on"); };
  function drawStatus() {
    if (!raving()) return;
    const p = pat();
    $("raveStatus").textContent = (songText() ? songText() + "  \u00b7  " : "") + (p.name || "P" + (S.cur + 1)).toUpperCase() + (playing ? "  \u00b7  BAR " + Math.max(1, barN) : "  \u00b7  STOPPED") +
      (nextSlot >= 0 ? "  \u00b7  NEXT " + (nextSlot + 1) : "");
  }
  // full screen, where the browser has it (not iPhone: there, Add to Home Screen is the full screen)
  const fsOK = !!(document.fullscreenEnabled || document.webkitFullscreenEnabled);
  const fsNow = () => document.fullscreenElement || document.webkitFullscreenElement;
  const setFull = (on) => {
    const d = document.documentElement;
    try {
      if (on && !fsNow()) { const r = (d.requestFullscreen || d.webkitRequestFullscreen).call(d); if (r && r.catch) r.catch(() => {}); }
      else if (!on && fsNow()) { const r = (document.exitFullscreen || document.webkitExitFullscreen).call(document); if (r && r.catch) r.catch(() => {}); }
    } catch {}
  };
  $("raveFull").hidden = !fsOK;
  for (const t of ["fullscreenchange", "webkitfullscreenchange"]) document.addEventListener(t, () => { $("raveFull").setAttribute("aria-pressed", String(!!fsNow())); requestAnimationFrame(fitViz); });
  const setLock = (on) => {
    locked = on;
    $("raveLock").setAttribute("aria-pressed", String(on));
    raveEl.classList.toggle("is-locked", on);
    hint(on ? "LOCKED" : "UNLOCKED");
  };
  // the scenes: hold Scene for all of them, and whether they change by themselves
  const SC = globalThis.AcidRave.SCENES;
  $("raveSceneList").innerHTML = SC.map((n, i) => `<button type="button" data-scene="${i}">${n}</button>`).join("");
  function drawScenes() { $("raveSceneList").querySelectorAll("button").forEach((b, i) => b.setAttribute("aria-pressed", String(i === rave.scene))); }
  const openScenes = () => { drawScenes(); $("raveScenes").hidden = false; poke(); };
  const closeScenes = () => { $("raveScenes").hidden = true; };
  $("raveSceneList").addEventListener("click", (e) => { const b = e.target.closest("button"); if (!b) return; rave.go(+b.dataset.scene); drawScenes(); closeScenes(); });
  const setRave = (on) => {
    app.classList.toggle("is-rave", on);
    $("raveBtn").setAttribute("aria-pressed", String(on));
    rave.setPad(null); closeScenes();
    if (on) poke(); else { setFull(false); clearTimeout(idleT); app.classList.remove("rave-idle"); $("vjPanel").hidden = true; $("raveVJ").setAttribute("aria-pressed", "false"); }
    drawStatus();
    requestAnimationFrame(fitViz);
  };
  const onPress = (el, f) => {   // (on the touch itself; a keyboard's click too)
    el.addEventListener("pointerdown", (e) => { e.preventDefault(); e.stopPropagation(); f(); });
    el.addEventListener("click", (e) => { if (e.detail === 0) f(); });
  };
  onPress($("raveBtn"), () => setRave(!app.classList.contains("is-rave")));
  onPress($("raveExit"), () => setRave(false));
  onPress($("ravePlay"), () => setPlaying(!playing));
  onPress($("raveLock"), () => setLock(!locked));
  onPress($("raveFull"), () => setFull(!fsNow()));
  // Scene: a tap the next one, a hold all of them
  { const sb = $("raveScene"); let hold = 0, held = false;
    sb.addEventListener("pointerdown", (e) => { e.preventDefault(); e.stopPropagation(); held = false; hold = setTimeout(() => { held = true; buzz(15); openScenes(); }, 450); });
    sb.addEventListener("pointerup", () => { clearTimeout(hold); if (held) return; if (!$("raveScenes").hidden) closeScenes(); else { rave.next(); drawScenes(); } });
    sb.addEventListener("pointercancel", () => clearTimeout(hold));
    sb.addEventListener("click", (e) => { if (e.detail === 0) rave.next(); }); }
  // the picture: one finger plays the filter (out of rave mode: a tap is the next scene); two fingers make a gesture,
  // decided when the first of them lifts
  let solo = null, g2 = null;
  const at = (ev) => { const r = (raving() && VJS.fill ? raveEl : vizEl).getBoundingClientRect(); return [clamp01((ev.clientX - r.left) / r.width), clamp01((ev.clientY - r.top) / r.height)]; };
  const padAt = (ev) => { const [x, y] = at(ev); S.params.cutoff = x; S.params.reso = 1 - y; sendParams(); save(); drawXY(); rave.setPad(x, y); };
  vizEl.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    if (!$("raveScenes").hidden) { closeScenes(); return; }
    try { vizEl.setPointerCapture(e.pointerId); } catch {}
    vTouch.set(e.pointerId, { x: e.clientX, y: e.clientY, x0: e.clientX, y0: e.clientY });
    if (!raving()) { solo = { id: e.pointerId, moved: false }; return; }
    if (locked) { hint("LOCKED \u00b7 TAP LOCK TO UNLOCK"); return; }
    if (vTouch.size === 2) {
      const [a, b] = [...vTouch.values()];
      g2 = { t0: performance.now(), d0: Math.hypot(a.x - b.x, a.y - b.y) || 1, c0: [(a.x + b.x) / 2, (a.y + b.y) / 2], c: null, env0: S.params.env, pinched: false, done: false };
      if (solo && performance.now() - solo.t < 180) { S.params.cutoff = solo.was[0]; S.params.reso = solo.was[1]; sendParams(); save(); drawXY(); }   // (two fingers landing: not a filter move)
      solo = null; rave.setPad(null);
    } else if (vTouch.size === 1 && !g2) { solo = { id: e.pointerId, t: performance.now(), was: [S.params.cutoff, S.params.reso] }; padAt(e); }
  });
  vizEl.addEventListener("pointermove", (e) => {
    const t = vTouch.get(e.pointerId);
    if (!t) return;
    t.x = e.clientX; t.y = e.clientY;
    if (!raving()) { if (solo && Math.abs(t.x - t.x0) + Math.abs(t.y - t.y0) > 6) solo.moved = true; return; }
    if (locked) return;
    if (g2 && !g2.done && vTouch.size >= 2) {
      const [a, b] = [...vTouch.values()], d = Math.hypot(a.x - b.x, a.y - b.y), r = d / g2.d0;
      g2.c = [(a.x + b.x) / 2, (a.y + b.y) / 2];
      // a pinch: the fingers part (or close) far more than they travel together; a swipe: they travel together
      if (!g2.pinched && Math.abs(r - 1) > 0.2 && Math.abs(d - g2.d0) > 2.5 * Math.hypot(g2.c[0] - g2.c0[0], g2.c[1] - g2.c0[1])) g2.pinched = true;
      if (g2.pinched) { setParam("env", g2.env0 + (r - 1) * 0.6); drawKey("env"); hint("ENV MOD " + Math.round(S.params.env * 100)); }
    } else if (solo && solo.id === e.pointerId && !g2) padAt(e);
  });
  const vEnd = (e) => {
    if (!vTouch.has(e.pointerId)) return;
    vTouch.delete(e.pointerId);
    if (!raving()) { if (solo && !solo.moved && e.type === "pointerup") rave.next(); solo = null; return; }
    if (g2 && !g2.done) {
      g2.done = true;
      const c = g2.c || g2.c0, dx = c[0] - g2.c0[0], dy = c[1] - g2.c0[1], quick = performance.now() - g2.t0 < 350;
      if (!g2.pinched && e.type === "pointerup") {
        if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.3) { if (dx < 0) rave.next(); else rave.back(); drawScenes(); }
        else if (dy > 80 && dy > Math.abs(dx) * 1.3) setRave(false);
        else if (quick && Math.abs(dx) + Math.abs(dy) < 24) { setLatch(!latch); hint(latch ? "LATCH ON" : "LATCH OFF"); }
      }
    }
    if (!vTouch.size) { g2 = null; solo = null; rave.setPad(null); }
    else if (solo && solo.id === e.pointerId) { solo = null; rave.setPad(null); }
  };
  vizEl.addEventListener("pointerup", vEnd); vizEl.addEventListener("pointercancel", vEnd);
  const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

  // -------------------------------------------------------------------------------------------- the menu ---
  const menu = $("menu"), msg = (t) => ($("msg").textContent = t);
  $("menuBtn").addEventListener("click", () => { msg(""); menu.showModal ? menu.showModal() : menu.setAttribute("open", ""); });
  menu.addEventListener("click", (e) => { if (e.target === menu) menu.close(); });
  const PREF_DEF = { latency: "interactive", scenes: "auto", motion: matchMedia("(prefers-reduced-motion: reduce)").matches ? "calm" : "full", text: "normal" };
  const applyPrefs = () => {
    document.querySelectorAll(".seg[data-pref]").forEach((s) => s.querySelectorAll("button").forEach((x) =>
      x.setAttribute("aria-pressed", String(x.dataset.v === pref(s.dataset.pref, PREF_DEF[s.dataset.pref])))));
    rave.auto = pref("scenes", PREF_DEF.scenes) === "auto";
    rave.calm = pref("motion", PREF_DEF.motion) === "calm";
    app.classList.toggle("is-calm", rave.calm);
    document.documentElement.classList.toggle("is-large", pref("text", PREF_DEF.text) === "large");
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
    if (await saveFile(file, "Acid Flower patterns")) { msg("Saved: " + name); S.edits = 0; S.backupAt = Date.now(); save(); }
  };
  $("import").onclick = () => $("importFile").click();
  const importFrom = async (f) => {
    let d;
    try { d = JSON.parse(await f.text()); } catch { d = null; }
    if (!valid(d)) { msg("That file isn’t a set of Acid Flower patterns."); toast("That file isn’t a set of Acid Flower patterns."); return; }
    if (!confirm("Replace your 8 patterns and knobs with “" + f.name + "”?")) return;
    begin();
    S = fixAll({ slots: d.slots, cur: d.cur, params: d.params || {}, song: d.song, songOn: !!d.songOn });
    commit(); save(); sendParams(); sendPattern(); drawAll(); msg("Loaded " + f.name); toast("Loaded " + f.name, "Undo", undo);
  };
  $("importFile").onchange = async (e) => {
    const f = e.target.files && e.target.files[0];
    e.target.value = "";
    if (f) importFrom(f);
  };
  $("reset").onclick = () => {
    if (!confirm("Go back to the starter patterns and knobs? Your own patterns will be gone (save them first if you want them).")) return;
    begin(); S = fresh(); commit(); save(); sendParams(); sendPattern(); drawAll(); msg("Back to the starter patterns.");
  };

  const standalone = navigator.standalone || matchMedia("(display-mode: standalone), (display-mode: fullscreen)").matches;
  if (!standalone && navigator.maxTouchPoints > 0) $("a2hs").hidden = false;
  if ("serviceWorker" in navigator && location.protocol === "https:") navigator.serviceWorker.register("sw.js").catch(() => {});
  drawAll();
  applyStudio();
  // the studio's split between the display and the editor: drag it (or use the arrow keys on it); remembered
  { const sp = $("splitter"), root = document.documentElement, KEY = "acid-flower-split";
    const setH = (h) => { h = Math.max(160, Math.min(innerHeight * 0.62, h)); root.style.setProperty("--top-h", Math.round(h) + "px"); try { localStorage.setItem(KEY, String(Math.round(h))); } catch {} requestAnimationFrame(fitViz); };
    try { const h = +localStorage.getItem(KEY); if (h) root.style.setProperty("--top-h", h + "px"); } catch {}
    sp.addEventListener("pointerdown", (e) => {
      e.preventDefault(); e.stopPropagation();
      const top = $("viz").closest(".rave").getBoundingClientRect().top, move = (ev) => setH(ev.clientY - top - 4);
      try { sp.setPointerCapture(e.pointerId); } catch {}
      sp.classList.add("is-drag");
      sp.addEventListener("pointermove", move);
      sp.addEventListener("pointerup", () => { sp.classList.remove("is-drag"); sp.removeEventListener("pointermove", move); }, { once: true });
    });
    sp.addEventListener("dblclick", () => { root.style.removeProperty("--top-h"); try { localStorage.removeItem(KEY); } catch {} requestAnimationFrame(fitViz); });
    sp.addEventListener("keydown", (e) => { if (e.key === "ArrowUp" || e.key === "ArrowDown") { e.preventDefault(); e.stopPropagation(); setH($("viz").closest(".rave").getBoundingClientRect().height + (e.key === "ArrowDown" ? 24 : -24)); } }); }
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
    lead: [["............", "........PP..", ".......P.P..", "......P..P..", ".....P...P..", "....P....P..", "...P.....P..", "..P......P..", ".P.......PPP", "P........PPP", ".........PP.", "............"], { P: "#FF2FB4" }],
    undo: [["............", "...C........", "..CC........", ".CCCCCCCC...", "..CC.....C..", "...C......C.", "..........C.", "..........C.", ".........C..", "....CCCCC...", "............", "............"], { C: "#2BF0FF" }],
    redo: [["............", "........C...", "........CC..", "...CCCCCCCC.", "..C.....CC..", ".C......C...", ".C..........", ".C..........", "..C.........", "...CCCCC....", "............", "............"], { C: "#2BF0FF" }],
    vj: [["............", ".M.......M..", ".MM.....MM..", ".M.M...M.M..", ".M..M.M..M..", ".M...M...M..", "............", "..CCCCCCCC..", ".C........C.", ".C.YY..YY.C.", ".C........C.", "..CCCCCCCC.."], { M: "#FF2FB4", C: "#2BF0FF", Y: "#FFE100" }],
    lock: [["............", "....YYYY....", "...Y....Y...", "...Y....Y...", "...Y....Y...", "..YYYYYYYY..", "..YYYYYYYY..", "..YYY..YYY..", "..YYY..YYY..", "..YYYYYYYY..", "..YYYYYYYY..", "............"], { Y: "#FFE100" }],
    full: [["............", ".WWWW..WWWW.", ".W........W.", ".W........W.", ".W........W.", "............", "............", ".W........W.", ".W........W.", ".W........W.", ".WWWW..WWWW.", "............"], { W: "#F4F1FF" }],
    tilt: [["..AAAAAA....", ".A......A...", "A........A.A", "A.........AA", "........AAA.", "............", ".CCCCCCCCCC.", ".C........C.", ".C.DDDDDD.CC", ".C........C.", ".CCCCCCCCCC.", "............"], { C: "#2BF0FF", A: "#9FF8FF", D: "#1A8F99" }],
  };
  const iconSvg = (name) => {
    const [g, col] = ICONS[name];
    let r = "";
    g.forEach((row, y) => [...row].forEach((ch, x) => { if (col[ch]) r += `<rect x="${x}" y="${y}" width="1" height="1" fill="${col[ch]}"/>`; }));
    return `<svg class="pix" viewBox="0 0 12 12" width="20" height="20" shape-rendering="crispEdges" aria-hidden="true">${r}</svg>`;
  };
  for (const [sel, name] of [['[data-tab="bass"]', "bass"], ['[data-tab="lead"]', "lead"], ['[data-tab="drums"]', "drums"], ['[data-tab="punch"]', "punch"], ['[data-tab="filter"]', "filter"], ["#raveBtn", "rave"], ["#tiltBtn", "tilt"], ["#random", "random"], ["#mutate", "mutate"], ["#clear", "clear"], ["#undo", "undo"], ["#redo", "redo"], ["#raveTilt", "tilt"], ["#raveLock", "lock"], ["#raveFull", "full"], ["#raveVJ", "vj"]]) {
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
    for (const id of ["tiltBtn", "raveTilt"]) $(id).setAttribute("aria-pressed", String(on));
  };
  const tiltClick = async () => {
    if (tiltOn) return setTilt(false);
    try {
      if (window.DeviceOrientationEvent && typeof DeviceOrientationEvent.requestPermission === "function") {
        const r = await DeviceOrientationEvent.requestPermission();
        if (r !== "granted") { alert("Tilt needs motion access: allow it when asked (or in Settings, Safari, Motion & Orientation Access)."); return; }
      } else if (!("DeviceOrientationEvent" in window)) { alert("This device has no tilt sensor."); return; }
    } catch (err) { alert("Tilt isn\u2019t available here: " + err.message); return; }
    if (!tiltListening) { addEventListener("deviceorientation", onTilt); tiltListening = true; }
    setTilt(true);
  };
  $("tiltBtn").addEventListener("click", tiltClick);
  $("raveTilt").addEventListener("click", tiltClick);
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




  // ------------------------------------------------------------------------------------------- motion ---
  // Motion on, while it plays: the knobs you move are written into the pattern at the step they move on, and play back
  // with it (the worklet sets them at each step). Hold Motion to clear them.
  const MOT = ["cutoff", "reso", "env", "decay", "accent", "drive", "delay"];
  let motionOn = false, motLast = null, motBegun = false;
  function recordMotion() {
    if (!motionOn || !playing || !viz || viz.step < 0) { motLast = null; return; }
    const p = pat(), st = viz.step;
    if (!motLast) { motLast = {}; MOT.forEach((k) => (motLast[k] = S.params[k])); return; }
    let ch = false;
    for (const k of MOT) if (Math.abs(S.params[k] - motLast[k]) > 1e-4) {
      if (!motBegun) { begin(); motBegun = true; }
      p.motion = p.motion || {};
      const lane = (p.motion[k] = p.motion[k] || new Array(MAXS).fill(null));
      lane[st] = Math.round(S.params[k] * 1000) / 1000; motLast[k] = S.params[k]; ch = true;
    }
    if (ch) { sendPattern(); save(); drawMotion(); }
  }
  const hasMotion = (p = pat()) => !!(p.motion && Object.values(p.motion).some((a) => a.some((v) => v != null)));
  function drawMotion() { const b2 = $("motionBtn"); b2.setAttribute("aria-pressed", String(motionOn)); b2.classList.toggle("has-motion", hasMotion()); }
  { const mb = $("motionBtn"); let hold = 0, held = false;
    mb.addEventListener("pointerdown", (e) => { e.preventDefault(); held = false; hold = setTimeout(() => {
      held = true; buzz(15);
      if (!hasMotion()) { toast("No motion in this pattern yet"); return; }
      begin(); delete pat().motion; commit(); sendPattern(); save(); drawMotion(); toast("Motion cleared", "Undo", undo);
    }, 550); });
    mb.addEventListener("pointerup", () => { clearTimeout(hold); if (held) return;
      motionOn = !motionOn; motLast = null; if (!motionOn && motBegun) { commit(); motBegun = false; }
      drawMotion(); toast(motionOn ? (playing ? "Motion: move the knobs, they're recorded" : "Motion: press Play, then move the knobs") : "Motion off" + (hasMotion() ? ": it plays back" : "")); });
    mb.addEventListener("pointercancel", () => clearTimeout(hold));
    mb.addEventListener("click", (e) => { if (e.detail === 0) { motionOn = !motionOn; drawMotion(); } }); }
  playHooks.push((on) => { motLast = null; if (!on && motBegun) { commit(); motBegun = false; } });
  drawMotion();

  // ------------------------------------------------------------------------------------------- sounds ---
  // presets for the knobs: built in, and four of yours (saved on this device)
  const SOUNDK = ["cutoff", "reso", "env", "decay", "accent", "drive", "delay", "verb", "pump", "lead", "wave", "leadWave"];
  const SOUNDS = [
    ["Classic", {}],
    ["Rubber", { cutoff: 0.22, reso: 0.6, env: 0.78, decay: 0.58, accent: 0.5, drive: 0.15, delay: 0.1, verb: 0.08, wave: 0 }],
    ["Screamer", { cutoff: 0.45, reso: 0.93, env: 0.92, decay: 0.33, accent: 0.92, drive: 0.78, delay: 0.22, verb: 0.1, wave: 0 }],
    ["Deep", { cutoff: 0.17, reso: 0.48, env: 0.34, decay: 0.72, accent: 0.3, drive: 0.08, delay: 0.32, verb: 0.38, pump: 0.45, wave: 1 }],
    ["Square", { cutoff: 0.3, reso: 0.82, env: 0.6, decay: 0.4, accent: 0.72, drive: 0.42, delay: 0.16, verb: 0.1, wave: 1 }],
    ["Pumping", { cutoff: 0.36, reso: 0.75, env: 0.62, decay: 0.45, accent: 0.6, drive: 0.35, delay: 0.25, verb: 0.2, pump: 0.75, wave: 0 }],
  ];
  const mine = () => { try { const a = JSON.parse(localStorage.getItem("acid-flower-sounds")); return Array.isArray(a) ? padA(a, 4, () => null) : [null, null, null, null]; } catch { return [null, null, null, null]; } };
  const grabSound = () => { const o = {}; SOUNDK.forEach((k) => (o[k] = S.params[k])); o.dk = clone(S.params.dk); return o; };
  const putSound = (o, name) => {
    const was = grabSound();
    SOUNDK.forEach((k) => { if (o[k] != null) S.params[k] = o[k]; });
    if (o.dk) S.params.dk = clone(o.dk);
    sendParams(); save(); drawAll();
    toast(name + " loaded", "Undo", () => putSound(was, "The sound before"));
  };
  function drawSounds() {
    $("soundBuilt").innerHTML = SOUNDS.map(([n], i) => `<button type="button" data-b="${i}">${n}</button>`).join("");
    $("soundMine").innerHTML = mine().map((o, i) => `<div class="lrow"><span>${o ? o.name : "Empty " + (i + 1)}</span><div class="menu__row">` +
      `<button type="button" data-load="${i}" ${o ? "" : "disabled"}>Load</button><button type="button" data-save="${i}">Save here</button></div></div>`).join("");
  }
  onPress($("soundBtn"), () => { drawSounds(); show($("soundMenu")); });
  $("soundMenu").addEventListener("click", (e) => {
    if (e.target === $("soundMenu")) return $("soundMenu").close();
    const b2 = e.target.closest("button"); if (!b2) return;
    if (b2.dataset.b != null) { const [n, o] = SOUNDS[+b2.dataset.b]; const base = {}; SOUNDK.forEach((k) => (base[k] = DEF_PARAMS[k])); putSound({ ...base, ...o, dk: o.dk || DEF_PARAMS.dk }, n); }
    else if (b2.dataset.load != null) { const o = mine()[+b2.dataset.load]; if (o) putSound(o, o.name); }
    else if (b2.dataset.save != null) {
      const i = +b2.dataset.save, a = mine(), name = (window.prompt("A name for this sound:", (a[i] && a[i].name) || "Sound " + (i + 1)) || "").slice(0, 16);
      if (!name) return;
      a[i] = { ...grabSound(), name }; try { localStorage.setItem("acid-flower-sounds", JSON.stringify(a)); } catch {}
      drawSounds(); toast("Saved as " + name);
    }
  });
  $("soundMenu").addEventListener("close", () => {});

  // ------------------------------------------------------------------------------------- a step's menu ---
  // hold a note or a drum step: its chance (how often it plays) and its repeats (a ratchet)
  const show = (m) => { if (m.showModal) m.showModal(); else m.setAttribute("open", ""); };
  for (const id of ["stepMenu", "laneMenu"]) $(id).addEventListener("click", (e) => { if (e.target === $(id)) $(id).close(); });
  let stepSel = null;
  function openStep(kind, lane, i) {
    stepSel = { kind, lane, i, slot: S.cur };
    $("stepTitle").textContent = (kind === "drum" ? LANES[lane][0] : kind === "lead" ? "Lead" : "Bass") + " · step " + (i + 1);
    drawStepSheet(); show($("stepMenu"));
  }
  const stepGet = () => { const p = S.slots[stepSel.slot], q = stepSel; return q.kind === "drum" ? { prob: p.dp[q.lane][q.i], rat: p.dr[q.lane][q.i] } : p[q.kind][q.i]; };
  const stepSet = (k, v) => {
    const p = S.slots[stepSel.slot], q = stepSel;
    begin();
    if (q.kind === "drum") { (k === "prob" ? p.dp : p.dr)[q.lane][q.i] = v; p.drums[q.lane][q.i] = true; }
    else { p[q.kind][q.i][k] = v; p[q.kind][q.i].on = true; }
    edited(); drawAll(); drawStepSheet();
  };
  function drawStepSheet() {
    const g = stepGet();
    $("stepProb").innerHTML = [100, 75, 50, 25, 10].map((v) => `<button type="button" data-v="${v}" aria-pressed="${g.prob === v}">${v === 100 ? "Always" : v + "%"}</button>`).join("");
    $("stepRat").innerHTML = [1, 2, 3, 4].map((v) => `<button type="button" data-v="${v}" aria-pressed="${g.rat === v}">${v === 1 ? "Once" : "×" + v}</button>`).join("");
  }
  $("stepProb").addEventListener("click", (e) => { const b2 = e.target.closest("button"); if (b2) stepSet("prob", +b2.dataset.v); });
  $("stepRat").addEventListener("click", (e) => { const b2 = e.target.closest("button"); if (b2) stepSet("rat", +b2.dataset.v); });

  // ------------------------------------------------------------------------------------- a drum's menu ---
  // hold a drum's name: its tune, decay and level (the kit's, in every pattern) and its length (this pattern's)
  let laneSel = 0;
  const LROWS = [["tune", "Tune"], ["decay", "Decay"], ["level", "Level"], ["len", "Length"]];
  function openLane(l) {
    laneSel = l;
    $("laneTitle").textContent = LANES[l][0]; $("laneTitle").style.color = LANES[l][1];
    drawLaneSheet(); show($("laneMenu"));
  }
  function drawLaneSheet() {
    const d = S.params.dk[laneSel], p = pat();
    const val = { tune: (d[0] > 0 ? "+" : "") + d[0], decay: Math.round(d[1] * 10), level: Math.round(d[2] * 10), len: p.dlen[laneSel] || p.len + " (the pattern's)" };
    $("laneRows").innerHTML = LROWS.map(([k, name]) => `<div class="lrow"><span>${name}</span><div class="stepper"><button type="button" data-k="${k}" data-d="-1" aria-label="${name} down">&minus;</button>` +
      `<span class="stepper__v"><b>${val[k]}</b></span><button type="button" data-k="${k}" data-d="1" aria-label="${name} up">+</button></div></div>`).join("");
  }
  $("laneRows").addEventListener("click", (e) => {
    const b2 = e.target.closest("button[data-k]"); if (!b2) return;
    const k = b2.dataset.k, dir = +b2.dataset.d, d = S.params.dk[laneSel], p = pat();
    if (k === "len") { begin(); const v = Math.max(1, Math.min(MAXS, (p.dlen[laneSel] || p.len) + dir)); p.dlen[laneSel] = v === p.len ? 0 : v; edited(); drawAll(); }
    else {
      if (k === "tune") d[0] = Math.max(-12, Math.min(12, d[0] + dir));
      else { const j = k === "decay" ? 1 : 2; d[j] = Math.max(0, Math.min(1, Math.round((d[j] + dir * 0.1) * 10) / 10)); }
      sendParams(); save(); post({ type: "hit", lane: laneSel });
    }
    drawLaneSheet();
  });
  $("laneHear").addEventListener("click", () => post({ type: "hit", lane: laneSel }));
  $("laneReset").addEventListener("click", () => { S.params.dk[laneSel] = [0, 0.5, 0.8]; sendParams(); save(); drawLaneSheet(); post({ type: "hit", lane: laneSel }); });

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
  const snap = () => JSON.stringify({ slots: S.slots, tune: S.params.tune, wave: S.params.wave, tempo: S.params.tempo, song: S.song });
  function begin() { pend = snap(); }
  function commit() {
    if (pend == null) return;
    if (pend !== snap()) { hist.undo.push(pend); if (hist.undo.length > 100) hist.undo.shift(); hist.redo.length = 0; S.edits = (S.edits || 0) + 1; }
    pend = null; drawHist();
  }
  const restore = (j) => { const d = JSON.parse(j); S.slots = d.slots; S.params.tune = d.tune; S.params.wave = d.wave; if (d.tempo) S.params.tempo = d.tempo; if (d.song) S.song = d.song; sendParams(); sendPattern(); save(); drawAll(); };
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
    if (S.songOn && S.song.length) return songStep();
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
    begin(); S.slots[i] = Object.assign(empty(), { name: S.slots[i].name }); commit();
    if (i === S.cur) sendPattern();
    save(); drawAll(); $("slotMenu").close();
    toast("Pattern " + (i + 1) + " cleared", "Undo", undo);
  });

  // ---------------------------------------------------------------------------------------- share links ---
  // a pattern and the sound it was made with, in the link itself: #p=1.<bass>.<drums>.<len>.<tempo>.<swing>.<key>.
  // <wave>.<cutoff>.<reso>.<env>.<decay>.<accent>.<drive>.<delay>.<name>; opening it puts it in a free slot
  const KN = ["cutoff", "reso", "env", "decay", "accent", "drive", "delay"];
  const h2 = (v) => v.toString(16).padStart(2, "0"), pc = (v) => Math.round(v * 100);
  const stepCode = (x) => h2(x.on ? 1 + x.note + 13 * (x.oct + 1) + (x.acc ? 40 : 0) + (x.slide ? 80 : 0) : 0);
  const stepFrom = (v) => {
    if (!v) return rest();
    if (v > 159) throw new Error("step");
    const slide = v >= 80; if (slide) v -= 80;
    const acc = v >= 40; if (acc) v -= 40;
    v -= 1;
    if (v < 0 || v > 38) throw new Error("step");
    return { on: true, note: v % 13, oct: Math.floor(v / 13) - 1, acc, slide };
  };
  // version 2 (today's patterns: 32 steps, the lead, eight drums, chance, repeats, lengths, the drums' knobs):
  // #p=2z.<base64url of deflated JSON>, or 2.<base64url of JSON> where the browser can't deflate
  const b64 = (u8) => { let t = ""; for (const c of u8) t += String.fromCharCode(c); return btoa(t).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""); };
  const unb64 = (t) => Uint8Array.from(atob(t.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));
  const pipe = async (u8, how) => new Uint8Array(await new Response(new Blob([u8]).stream().pipeThrough(how)).arrayBuffer());
  const encode = async (p) => {
    const P = S.params, sparse = (rows, dflt) => { const o = []; rows.forEach((r, l) => r.forEach((v, i) => { if (v !== dflt && i < MAXS) o.push(l, i, v); })); return o; };
    const pr = (steps) => { const o = []; steps.forEach((x, i) => { if (x.on && (x.prob < 100 || x.rat > 1)) o.push(i, x.prob, x.rat); }); return o; };
    const d = { l: p.len, ll: p.llen, b: p.bass.map(stepCode).join(""), bp: pr(p.bass), d: p.lead.map(stepCode).join(""), dq: pr(p.lead),
      k: p.drums.map((r) => (r.reduce((a, v, i) => (v ? a + 2 ** i : a), 0)).toString(36)), kp: sparse(p.dp, 100), kr: sparse(p.dr, 1), kl: p.dlen,
      n: p.name || "", P: [Math.round(P.tempo), pc(P.swing), P.tune, P.wave, P.leadWave, ...KN.map((k) => pc(P[k])), pc(P.verb), pc(P.pump), pc(P.lead)], K: P.dk };
    const u8 = new TextEncoder().encode(JSON.stringify(d));
    try { if (window.CompressionStream) return "2z." + b64(await pipe(u8, new CompressionStream("deflate-raw"))); } catch {}
    return "2." + b64(u8);
  };
  const decode2 = async (c) => {
    const [v, body] = [c.slice(0, c.indexOf(".")), c.slice(c.indexOf(".") + 1)];
    let u8 = unb64(body);
    if (v === "2z") u8 = await pipe(u8, new DecompressionStream("deflate-raw"));
    const d = JSON.parse(new TextDecoder().decode(u8));
    const steps = (str, pr) => { const o = []; for (let i = 0; i < MAXS; i++) o.push(stepFrom(parseInt(str.substr(i * 2, 2), 16) || 0)); for (let j = 0; j + 2 < (pr || []).length; j += 3) if (o[pr[j]]) { o[pr[j]].prob = pr[j + 1]; o[pr[j]].rat = pr[j + 2]; } return o; };
    const rows = (dflt, sp) => { const r = LANES.map(() => new Array(MAXS).fill(dflt)); for (let j = 0; j + 2 < (sp || []).length; j += 3) if (r[sp[j]]) r[sp[j]][sp[j + 1]] = sp[j + 2]; return r; };
    const pattern = { len: d.l, llen: d.ll, bass: steps(d.b, d.bp), lead: steps(d.d, d.dq), drums: LANES.map((_, l) => { const m = parseInt((d.k || [])[l] || "0", 36); return ALL32.map((i) => Math.floor(m / 2 ** i) % 2 === 1); }),
      dp: rows(100, d.kp), dr: rows(1, d.kr), dlen: d.kl, name: String(d.n || "").slice(0, 10) };
    const q = d.P || [], n = (i, df, lo, hi) => { const x = Number(q[i]); return Number.isFinite(x) ? Math.max(lo, Math.min(hi, x)) : df; };
    const params = { tempo: n(0, 124, 60, 180), swing: n(1, 54, 50, 75) / 100, tune: n(2, 0, -12, 12) | 0, wave: n(3, 0, 0, 1) | 0, leadWave: n(4, 1, 0, 1) | 0 };
    KN.forEach((k, j) => { params[k] = n(5 + j, DEF_PARAMS[k] * 100, 0, 100) / 100; });
    params.verb = n(12, 12, 0, 100) / 100; params.pump = n(13, 0, 0, 100) / 100; params.lead = n(14, 60, 0, 100) / 100;
    if (Array.isArray(d.K)) params.dk = fixAll({ slots: [], params: { dk: d.K } }).params.dk;
    return { pattern: normPat(pattern), params };
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
  async function fromLink() {
    const m = location.hash.match(/^#p=(.+)$/);
    if (!m) return;
    let d = null;
    try { d = /^2z?\./.test(m[1]) ? await decode2(m[1]) : decode(m[1]); } catch { d = null; }
    try { history.replaceState(null, "", location.pathname + location.search); } catch {}
    if (!d) { toast("That link isn’t an Acid Flower pattern."); return; }
    begin();
    let i = S.slots.findIndex((p) => !used(p));
    if (i < 0) i = S.cur;
    S.slots[i] = normPat(d.pattern); S.cur = i; nextSlot = -1;
    Object.assign(S.params, d.params);
    commit(); sendParams(); sendPattern(); save(); drawAll();
    toast("A shared pattern" + (d.pattern.name ? " (" + d.pattern.name + ")" : "") + " is in slot " + (i + 1) + ": press Play", "Undo", undo, 7000);
  }
  addEventListener("hashchange", () => { if ($("gate").hidden) fromLink(); });
  $("slotShare").addEventListener("click", async () => {
    const p = S.slots[sheetSlot], url = location.origin + location.pathname + "#p=" + (await encode(p));
    const title = "Acid Flower: " + (p.name || "pattern " + (sheetSlot + 1));
    try { if (navigator.share) { await navigator.share({ title, text: "An acid line I made in Acid Flower:", url }); return; } }
    catch (err) { if (err && err.name === "AbortError") return; }
    try { await navigator.clipboard.writeText(url); toast("Link copied"); } catch { window.prompt("Copy this link:", url); }
  });

  // ---------------------------------------------------------------------------------------- recording ---
  // Rec: everything the machine plays (effects and all) into a file; when it stops, Save hands it to the share sheet
  let rec = null, recDest = null, recT = 0, recStart = 0, recVideo = null;
  const recMime = () => ["audio/mp4", "audio/webm;codecs=opus", "audio/webm", "audio/ogg"].find((t) => window.MediaRecorder && MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(t)) || "";
  const clock = (s) => Math.floor(s / 60) + ":" + String(Math.floor(s % 60)).padStart(2, "0");
  const drawRec = () => {
    const on = !!(rec && rec.state === "recording"), t = on ? clock((performance.now() - recStart) / 1000) : "Rec";
    for (const id of ["rec", "raveRec"]) { const b = $(id); b.setAttribute("aria-pressed", String(on)); (b.querySelector("span") || b).textContent = t; }
    $("raveRecDot").hidden = !on; $("raveRecDot").textContent = "\u25cf REC " + t;
  };
  const setRec = (on) => {
    if (on) {
      if (!node || !window.MediaRecorder) { toast("This browser can’t record. Try Safari 14.5 or later, or Chrome."); return; }
      if (!recDest) { recDest = ctx.createMediaStreamDestination(); node.connect(recDest); }
      // with the picture: the rave, drawn big with crisp pixels into a canvas that is filmed, with the sound alongside
      const video = VJS.rec === "video" && HTMLCanvasElement.prototype.captureStream;
      let stream = recDest.stream, type = recMime();
      if (video) {
        const vc = document.createElement("canvas"), sc = Math.max(1, Math.round(1280 / rave.W));
        vc.width = (rave.W * sc) & ~1; vc.height = (150 * sc) & ~1;
        const g = vc.getContext("2d");
        recVideo = vc;
        const draw = () => { if (recVideo !== vc) return; g.imageSmoothingEnabled = false; g.drawImage(vizEl, 0, 0, vc.width, vc.height); requestAnimationFrame(draw); };
        draw();
        stream = vc.captureStream(30); recDest.stream.getAudioTracks().forEach((t) => stream.addTrack(t));
        type = ["video/mp4;codecs=avc1,mp4a.40.2", "video/mp4", "video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm"].find((t) => MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(t)) || "";
      }
      const chunks = [];
      let r;
      try { r = new MediaRecorder(stream, type ? { mimeType: type, videoBitsPerSecond: 6e6 } : undefined); } catch (err) { recVideo = null; toast("Can’t record: " + err.message); return; }
      r.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
      r.onstop = () => {
        const secs = (performance.now() - recStart) / 1000, t = r.mimeType || type || "audio/webm";
        const vid = /^video/.test(t), ext = vid ? (/mp4/.test(t) ? "mp4" : "webm") : /mp4|aac|m4a/.test(t) ? "m4a" : /ogg/.test(t) ? "ogg" : "webm";
        recVideo = null;
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


  // ------------------------------------------------------------------------------------------- styles ---
  // hold Random: a whole pattern in a style (the bass, sometimes a lead, the drums with their chances and rolls, a tempo)
  const STYLES = [
    ["chicago", "Classic Chicago", "Warm and bouncy, 122 BPM, the one that started it"],
    ["hard", "Hard acid", "Fast and relentless: accents, octave jumps, rolls"],
    ["minimal", "Minimal", "Few notes, lots of space, hats by chance"],
    ["deep", "Deep", "Low, sliding, a lead on top, a pumping kick"],
    ["wonky", "Wonky", "Tracks of different lengths drifting against each other"],
  ];
  const gen = (style) => {
    const R = Math.random, P = { chicago: { d: 0.7, a: 0.3, sl: 0.22, o: 0.15, bpm: [120, 126] }, hard: { d: 0.9, a: 0.45, sl: 0.25, o: 0.3, bpm: [138, 150] },
      minimal: { d: 0.4, a: 0.22, sl: 0.15, o: 0.08, bpm: [122, 128] }, deep: { d: 0.55, a: 0.2, sl: 0.38, o: 0.05, bpm: [116, 122] }, wonky: { d: 0.65, a: 0.35, sl: 0.25, o: 0.2, bpm: [124, 132] } }[style];
    const sc = style === "minimal" ? [0, 0, 0, 7, 12] : style === "deep" ? [0, 3, 5, 7, 10] : pick(SCALES);
    const line = (dens, lo) => ALL16.map((i) => stepOK({ on: i === 0 || R() < dens, note: i === 0 || R() < 0.4 ? 0 : pick(sc), oct: R() < P.o ? 1 : lo && R() < 0.35 ? -1 : 0,
      acc: i % 4 === 0 ? R() < P.a * 1.6 : R() < P.a, slide: R() < P.sl }));
    const bass = line(P.d, style === "deep");
    const k = [0, 4, 8, 12], hat = [], open = [2, 6, 10, 14], clap = [4, 12], snare = [], tom = [], rim = [], bell = [];
    if (style === "hard") { k.push(pick([3, 7, 11, 14, 15])); ALL16.forEach((i) => hat.push(i)); snare.push(15); }
    else if (style === "minimal") { ALL16.forEach((i) => { if (i % 2) hat.push(i); }); rim.push(pick([3, 7]), pick([10, 11, 14])); clap.length = 0; clap.push(12); }
    else if (style === "deep") { ALL16.forEach((i) => { if (i % 4 !== 0) hat.push(i); }); clap.length = 0; clap.push(12); tom.push(pick([13, 14, 15])); }
    else { ALL16.forEach((i) => { if (i % 4 !== 2 && R() < 0.85) hat.push(i); }); if (R() < 0.3) bell.push(pick([3, 11]), pick([6, 14])); }
    const p = normPat({ len: 16, bass: [...bass, ...bass.map((x) => ({ ...x }))], drums: grid([k, snare, clap, hat, style === "minimal" ? [] : open, tom, rim, bell]) });
    if (style === "hard") { p.dr[1][15] = 4; p.dr[1][31] = 4; p.dr[3].forEach((_, i) => { if (i % 8 === 7) p.dr[3][i] = 2; }); }
    if (style === "minimal") p.dp[3].forEach((_, i) => { p.dp[3][i] = i % 4 === 3 ? 100 : 50; });
    if (style === "deep") { const ld = line(0.3, false); ld.forEach((x) => { x.slide = R() < 0.5; x.acc = false; }); p.lead = [...ld, ...ld.map((x) => ({ ...x }))]; p.dp[3].forEach((_, i) => { p.dp[3][i] = 75; }); }
    if (style === "wonky") { p.dlen[3] = pick([12, 10, 14]); p.dlen[6] = pick([5, 7]); p.drums[6][0] = p.drums[6][3] = true; p.llen = 0; const ld = line(0.4, false); p.lead = [...ld, ...ld.map((x) => ({ ...x }))]; p.llen = pick([12, 13, 15]); }
    p.bass.forEach((x, i) => { if (style === "minimal" && i % 4 && R() < 0.4) x.prob = 50; });
    return { p, tempo: Math.round(P.bpm[0] + R() * (P.bpm[1] - P.bpm[0])) };
  };
  $("genList").innerHTML = STYLES.map(([id, name, what]) => `<button type="button" data-style="${id}"><b>${name}</b><small>${what}</small></button>`).join("");
  $("genList").addEventListener("click", (e) => {
    const b2 = e.target.closest("button[data-style]"); if (!b2) return;
    const { p, tempo } = gen(b2.dataset.style), name = pat().name, next = pat().next;
    begin(); S.slots[S.cur] = Object.assign(p, { name, next }); S.params.tempo = tempo; commit();
    sendParams(); sendPattern(); save(); drawAll(); $("genMenu").close();
    toast(STYLES.find((x) => x[0] === b2.dataset.style)[1] + " at " + tempo + " BPM", "Undo", undo);
  });
  $("genMenu").addEventListener("click", (e) => { if (e.target === $("genMenu")) $("genMenu").close(); });
  { const rb = $("random"); let hold = 0, held = false;
    rb.addEventListener("pointerdown", (e) => { e.preventDefault(); e.stopPropagation(); held = false; if (e.button === 2) { held = true; show($("genMenu")); return; } hold = setTimeout(() => { held = true; buzz(15); show($("genMenu")); }, 480); });
    rb.addEventListener("pointerup", () => { clearTimeout(hold); if (!held) doRandom(); });
    rb.addEventListener("pointercancel", () => clearTimeout(hold));
    rb.addEventListener("click", (e) => { if (e.detail === 0) doRandom(); });
    rb.addEventListener("contextmenu", (e) => { e.preventDefault(); e.stopPropagation(); if (e.pointerType !== "touch") show($("genMenu")); }); }

  // --------------------------------------------------------------------------------------------- song ---
  // patterns in order, each a number of times, round and round; Play starts it from the top
  let songI = 0, songLoop = 0, songPend = -1;
  function songStep() {                                   // (a pattern's loop begins)
    if (songPend >= 0 && S.song[songPend] && S.cur === S.song[songPend].slot) { songI = songPend; songLoop = 0; songPend = -1; }
    songLoop++;
    const e = S.song[songI] || S.song[0];
    if (songLoop >= e.reps && songPend < 0) {
      songPend = (songI + 1) % S.song.length;
      const slot = S.song[songPend].slot;
      if (slot !== S.cur) { nextSlot = slot; nextAuto = true; post({ type: "pattern", pattern: S.slots[slot], atBar: true }); }
    }
    drawSlots();
  }
  playHooks.unshift((on) => {
    if (!on || !S.songOn || !S.song.length) return;
    songI = 0; songLoop = 0; songPend = -1; nextSlot = -1;
    S.cur = S.song[0].slot; sendPattern(); drawAll();
  });
  const songText = () => (S.songOn && S.song.length ? "SONG " + (songI + 1) + "/" + S.song.length : "");
  function drawSong() {
    $("songOn").querySelectorAll("button").forEach((b2) => b2.setAttribute("aria-pressed", String(+b2.dataset.v === (S.songOn ? 1 : 0))));
    $("songList").innerHTML = S.song.map((e, i) => `<li class="lrow"><span>${i + 1}.</span><div class="stepper"><button type="button" data-i="${i}" data-f="slot" data-d="-1" aria-label="Earlier pattern">&minus;</button>` +
      `<span class="stepper__v"><small>Pattern</small><b>${e.slot + 1}${S.slots[e.slot].name ? " " + S.slots[e.slot].name : ""}</b></span><button type="button" data-i="${i}" data-f="slot" data-d="1" aria-label="Later pattern">+</button></div>` +
      `<div class="stepper"><button type="button" data-i="${i}" data-f="reps" data-d="-1" aria-label="Fewer times">&minus;</button><span class="stepper__v"><small>Times</small><b>×${e.reps}</b></span>` +
      `<button type="button" data-i="${i}" data-f="reps" data-d="1" aria-label="More times">+</button></div><button type="button" class="song__x" data-i="${i}" data-f="del" aria-label="Remove">✕</button></li>`).join("") ||
      `<li class="sheet__hint">Nothing yet: add a pattern.</li>`;
  }
  $("songMenu").addEventListener("click", (e) => {
    if (e.target === $("songMenu")) return $("songMenu").close();
    const b2 = e.target.closest("button"); if (!b2) return;
    if (b2.parentElement && b2.parentElement.id === "songOn") { S.songOn = b2.dataset.v === "1"; save(); drawSong(); drawSlots(); return; }
    if (b2.id === "songAdd") { begin(); const last = S.song[S.song.length - 1]; S.song.push({ slot: last ? (last.slot + 1) % 8 : S.cur, reps: last ? last.reps : 2 }); commit(); save(); drawSong(); return; }
    if (b2.id === "songMidi") { if (!S.song.length) return toast("Add patterns to the song first"); saveMidi(S.song.map((x) => [S.slots[x.slot], x.reps]), "song"); return; }
    const i = +b2.dataset.i, f = b2.dataset.f, d = +b2.dataset.d;
    if (!S.song[i]) return;
    begin();
    if (f === "del") S.song.splice(i, 1);
    else if (f === "slot") S.song[i].slot = (S.song[i].slot + d + 8) % 8;
    else if (f === "reps") S.song[i].reps = Math.max(1, Math.min(16, S.song[i].reps + d));
    commit(); save(); drawSong();
  });
  $("songBtn").addEventListener("click", () => { menu.close(); drawSong(); show($("songMenu")); });

  // ---------------------------------------------------------------------------------------- MIDI files ---
  // a pattern (four times round) or the song as a Standard MIDI File: the bass on channel 1, the lead on 2, the drums on
  // 10 (General MIDI's notes), with the swing, the accents (louder), the slides (legato) and the repeats; chance plays all
  const GM = [36, 38, 39, 42, 46, 45, 37, 56];
  const vlq = (n) => { const o = [n & 127]; while ((n >>= 7)) o.unshift((n & 127) | 128); return o; };
  const smfTrack = (evs) => {
    evs.sort((x, y) => x[0] - y[0] || x[1] - y[1]);
    const out = []; let t = 0;
    for (const [tick, , bytes] of evs) { out.push(...vlq(Math.max(0, tick - t)), ...bytes); t = Math.max(t, tick); }
    out.push(0, 0xff, 0x2f, 0);
    return [0x4d, 0x54, 0x72, 0x6b, (out.length >>> 24) & 255, (out.length >>> 16) & 255, (out.length >>> 8) & 255, out.length & 255, ...out];
  };
  const toMidi = (list) => {
    const Q = 96, ST = 24, P = S.params, swing = Math.round((Math.max(0.5, Math.min(0.75, P.swing)) - 0.5) * 2 * ST);
    const usq = Math.round(60000000 / P.tempo);
    const meta = [[0, 0, [0xff, 0x51, 3, (usq >> 16) & 255, (usq >> 8) & 255, usq & 255]], [0, 0, [0xff, 0x03, 11, ...new TextEncoder().encode("Acid Flower")]]];
    const tr = [[], [], []];
    let base = 0;
    const note = (k, ch, n, at, len, vel) => { tr[k].push([at, 1, [0x90 | ch, n & 127, vel]], [at + Math.max(1, len), 0, [0x80 | ch, n & 127, 0]]); };
    const voice = (k, ch, steps, len, root, a, t0, st) => {
      const x = steps[a % len]; if (!x || !x.on) return;
      const n = root + P.tune + x.note + 12 * x.oct, rat = x.rat || 1, sl = x.slide && rat === 1;
      for (let r = 0; r < rat; r++) note(k, ch, n, t0 + Math.round((r * st) / rat), sl ? st + 3 : Math.round((st / rat) * 0.55), x.acc ? 120 : 88);
    };
    for (const [p, loops] of list) {
      const total = p.len * loops;
      for (let a = 0; a < total; a++) {
        const t0 = base + a * ST + (a % 2 ? swing : 0), st = ST - (a % 2 ? swing : -swing) * 0;
        voice(1, 0, p.bass, p.len, 36, a % p.len, t0, ST);
        voice(2, 1, p.lead, p.llen || p.len, 48, a, t0, ST);
        for (let l = 0; l < LANES.length; l++) {
          const dl = p.dlen[l] || p.len, i = a % dl;
          if (!p.drums[l][i]) continue;
          const rat = p.dr[l][i] || 1;
          for (let r = 0; r < rat; r++) note(0, 9, GM[l], t0 + Math.round((r * ST) / rat), 6, r ? 80 : 100);
        }
        void st;
      }
      base += total * ST;
    }
    const tracks = [smfTrack(meta), smfTrack([[0, 0, [0xff, 0x03, 4, 68, 114, 117, 109]], ...tr[0]]), smfTrack([[0, 0, [0xff, 0x03, 4, 66, 97, 115, 115]], ...tr[1]]), smfTrack([[0, 0, [0xff, 0x03, 4, 76, 101, 97, 100]], ...tr[2]])];
    const head = [0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 6, 0, 1, 0, tracks.length, 0, Q];
    return new Uint8Array([...head, ...tracks.flat()]);
  };
  function saveMidi(list, name) {
    const file = new File([toMidi(list)], `acid-flower-${(name || "pattern").replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.mid`, { type: "audio/midi" });
    saveFile(file, "Acid Flower MIDI");
  }
  $("slotMidi").addEventListener("click", () => { const p = S.slots[sheetSlot]; saveMidi([[p, 4]], p.name || "pattern-" + (sheetSlot + 1)); });


  // --------------------------------------------------------------------------------------------- MIDI ---
  // Web MIDI, where the browser has it (Chrome, Edge, Opera, Android; not Safari, so not iPad or iPhone): keys play the
  // lead or the bass (or hold the punch-ins and pick the scenes, for a VJ set), knobs learnt to any control, program
  // changes pick the patterns, the clock in (follow) and out (lead)
  const CTRL = {};                                          // what a knob can turn: { name, get, set } (the VJ adds its own)
  for (const [k, name] of [["cutoff", "Cutoff"], ["reso", "Resonance"], ["env", "Env mod"], ["decay", "Decay"], ["accent", "Accent"], ["drive", "Drive"],
    ["delay", "Delay"], ["verb", "Verb"], ["pump", "Pump"], ["lead", "Lead level"], ["drums", "Drums level"]])
    CTRL[k] = { name, get: () => S.params[k], set: (v) => { S.params[k] = v; sendParams(); save(); drawXY(); drawKey(k); } };
  CTRL.tempo = { name: "Tempo", get: () => (S.params.tempo - 60) / 120, set: (v) => { setParam("tempo", Math.round(60 + v * 120)); drawKey("tempo"); } };
  const MIDI_DEF = { cutoff: 74, reso: 71, env: 16, decay: 17, accent: 18, drive: 19, delay: 20, verb: 21, pump: 22, lead: 23 };
  const MP = (() => { try { return { keys: "lead", follow: false, send: false, inId: "all", outId: "", map: { ...MIDI_DEF }, ...JSON.parse(localStorage.getItem("acid-flower-midi") || "{}") }; } catch { return { keys: "lead", follow: false, send: false, inId: "all", outId: "", map: { ...MIDI_DEF } }; } })();
  const saveMP = () => { try { localStorage.setItem("acid-flower-midi", JSON.stringify(MP)); } catch {} };
  let midi = null, learning = null, clockT = [], clockNext = 0, clockTimer = 0;
  const midiOK = !!navigator.requestMIDIAccess;
  const midiMsg = (t) => { $("midiMsg").textContent = t; };
  function drawMidi() {
    $("midiStatus").textContent = !midiOK ? "This browser has no MIDI. Safari (and so every browser on iPad and iPhone) leaves it out; Chrome or Edge on a computer, or Chrome on Android, have it."
      : midi ? (midi.inputs.size ? "Listening to " + [...midi.inputs.values()].map((x) => x.name).join(", ") + "." : "MIDI is on, but nothing is plugged in yet.")
      : "Plug in a keyboard or a controller, then turn MIDI on (the browser asks first).";
    $("midiOn").hidden = !midiOK || !!midi;
    $("midiBody").hidden = !midi;
    if (!midi) return;
    $("midiIn").innerHTML = `<option value="all">Everything</option>` + [...midi.inputs.values()].map((x) => `<option value="${x.id}">${x.name}</option>`).join("");
    $("midiIn").value = MP.inId === "all" || midi.inputs.has(MP.inId) ? MP.inId : "all";
    $("midiOut").innerHTML = `<option value="">Nowhere</option>` + [...midi.outputs.values()].map((x) => `<option value="${x.id}">${x.name}</option>`).join("");
    $("midiOut").value = midi.outputs.has(MP.outId) ? MP.outId : "";
    for (const [id, v] of [["midiKeys", MP.keys], ["midiFollow", MP.follow ? "1" : "0"], ["midiSend", MP.send ? "1" : "0"]])
      $(id).querySelectorAll("button").forEach((b2) => b2.setAttribute("aria-pressed", String(b2.dataset.v === v)));
    $("midiMap").innerHTML = Object.entries(CTRL).map(([k, c]) => `<div class="lrow"><span>${c.name}</span><span class="midi__cc">${MP.map[k] != null ? "CC " + MP.map[k] : "—"}</span>` +
      `<button type="button" data-learn="${k}" aria-pressed="${learning === k}">${learning === k ? "Turn a knob…" : "Learn"}</button>${MP.map[k] != null ? `<button type="button" data-forget="${k}" aria-label="Forget">✕</button>` : ""}</div>`).join("");
  }
  const hook = () => { for (const i of midi.inputs.values()) i.onmidimessage = (MP.inId === "all" || MP.inId === i.id) ? onMidi : null; };
  async function midiStart() {
    try { midi = await navigator.requestMIDIAccess({ sysex: false }); } catch (err) { $("midiStatus").textContent = "MIDI wasn’t allowed (" + (err.message || err.name) + "). Allow it in the browser’s site settings, then try again."; return; }
    midi.onstatechange = () => { hook(); drawMidi(); };
    hook(); drawMidi(); clockLoop();
    try { localStorage.setItem("acid-flower-midi-on", "1"); } catch {}
  }
  const outPort = () => (midi && MP.outId ? midi.outputs.get(MP.outId) : null);
  const VJN = { punch: 48, scene: 60 };                    // (C2.. the punch-ins, C3.. the scenes, in MIDI note numbers)
  function onMidi(e) {
    const d = e.data, st = d[0] & 0xf0;
    if (d[0] === 0xf8) {                                   // the clock: 24 a beat
      if (!MP.follow) return;
      clockT.push(e.timeStamp); if (clockT.length > 49) clockT.shift();
      if (clockT.length >= 25) { const bpm = 60000 / (((clockT[clockT.length - 1] - clockT[0]) / (clockT.length - 1)) * 24); if (Math.abs(bpm - S.params.tempo) > 0.4) { S.params.tempo = Math.max(60, Math.min(180, Math.round(bpm * 10) / 10)); sendParams(); drawKey("tempo"); } }
      return;
    }
    if (d[0] === 0xfa || d[0] === 0xfb) { if (MP.follow) { clockT = []; if (playing) setPlaying(false); setPlaying(true); } return; }
    if (d[0] === 0xfc) { if (MP.follow && playing) setPlaying(false); return; }
    if (st === 0xb0) {                                     // a knob
      const cc = d[1], v = d[2] / 127;
      if (learning) { for (const k of Object.keys(MP.map)) if (MP.map[k] === cc) delete MP.map[k]; MP.map[learning] = cc; midiMsg(CTRL[learning].name + " is CC " + cc); learning = null; saveMP(); drawMidi(); return; }
      for (const [k, c] of Object.entries(MP.map)) if (c === cc && CTRL[k]) CTRL[k].set(v);
      return;
    }
    if (st === 0xc0) { if (d[1] < 8) pickSlot(d[1]); return; }   // a program change: a pattern
    if (st === 0x90 || st === 0x80) {
      const n = d[1], on = st === 0x90 && d[2] > 0;
      if (MP.keys === "vj") {
        if (n >= VJN.punch && n < VJN.punch + 12) { fxHold(n - VJN.punch, "m" + n, on); return; }
        if (on && n >= VJN.scene && n < VJN.scene + rave.sceneCount()) { rave.go(n - VJN.scene); drawScenes(); return; }
        if (on && n === VJN.scene + 12) { rave.next(); drawScenes(); return; }
        return;
      }
      post({ type: "live", on, note: n, acc: d[2] > 110, voice: MP.keys });
      if (on) rave.event({ ...viz, note: n, accHit: d[2] > 110, hits: 0 });
    }
  }
  // the clock out: scheduled ahead with timestamps (steady, however busy the page is), lined up with the sound's latency
  function clockLoop() {
    clearInterval(clockTimer);
    clockTimer = setInterval(() => {
      const o = outPort();
      if (!o || !MP.send) { clockNext = 0; return; }
      const now = performance.now(), lat = ctx ? ((ctx.outputLatency || 0) + (ctx.baseLatency || 0)) * 1000 : 0, per = 60000 / (S.params.tempo * 24);
      if (!clockNext || clockNext < now) clockNext = now + lat;
      while (clockNext < now + 120) { try { o.send([0xf8], clockNext); } catch {} clockNext += per; }
    }, 25);
  }
  playHooks.push((on) => { const o = outPort(); if (o && MP.send) try { o.send([on ? 0xfa : 0xfc]); } catch {} });
  $("midiOn").addEventListener("click", midiStart);
  $("midiBtn").addEventListener("click", () => { menu.close(); drawMidi(); show($("midiMenu")); });
  $("midiMenu").addEventListener("click", (e) => {
    if (e.target === $("midiMenu")) return $("midiMenu").close();
    const b2 = e.target.closest("button"); if (!b2) return;
    const seg = b2.parentElement && b2.parentElement.id;
    if (seg === "midiKeys") MP.keys = b2.dataset.v;
    else if (seg === "midiFollow") MP.follow = b2.dataset.v === "1";
    else if (seg === "midiSend") { MP.send = b2.dataset.v === "1"; clockLoop(); }
    else if (b2.dataset.learn) { learning = learning === b2.dataset.learn ? null : b2.dataset.learn; midiMsg(learning ? "Now turn a knob for " + CTRL[learning].name : ""); }
    else if (b2.dataset.forget) delete MP.map[b2.dataset.forget];
    else return;
    saveMP(); drawMidi();
  });
  $("midiIn").addEventListener("change", () => { MP.inId = $("midiIn").value; saveMP(); hook(); });
  $("midiOut").addEventListener("change", () => { MP.outId = $("midiOut").value; saveMP(); clockLoop(); });
  try { if (midiOK && localStorage.getItem("acid-flower-midi-on") === "1" && navigator.permissions) navigator.permissions.query({ name: "midi" }).then((r) => { if (r.state === "granted") midiStart(); }).catch(() => {}); } catch {}


  // ----------------------------------------------------------------------------------------------- VJ ---
  // rave mode's VJ panel: Fill or Fit, the hue, the speed, mirrors and a kaleidoscope, trails, a zoom on the kick, the
  // colour split, bigger pixels, a strobe, what shows, scrolling words, Auto VJ, what Rec records; a second screen
  const saveVJ = () => { try { const { text, ...keep } = VJS; localStorage.setItem("acid-flower-vj", JSON.stringify(keep)); } catch {} };
  const applyVJ = () => {
    for (const k of Object.keys(rave.vj)) if (VJS[k] !== undefined) rave.vj[k] = VJS[k];
    const P = $("vjPanel");
    P.querySelectorAll(".seg[data-vj]").forEach((sg) => sg.querySelectorAll("button").forEach((b2) => {
      const k = sg.dataset.vj, v = VJS[k], want = typeof v === "boolean" ? (v ? "1" : "0") : String(v);
      b2.setAttribute("aria-pressed", String(b2.dataset.v === want));
    }));
    P.querySelectorAll("[data-show]").forEach((b2) => b2.setAttribute("aria-pressed", String(VJS[b2.dataset.show] !== false)));
    P.querySelectorAll("input[data-vj]").forEach((i) => { if (document.activeElement !== i) i.value = VJS[i.dataset.vj] == null ? "" : VJS[i.dataset.vj]; });
    requestAnimationFrame(fitViz);
  };
  const setVJ = (k, v) => { VJS[k] = v; saveVJ(); applyVJ(); };
  $("vjPanel").addEventListener("click", (e) => {
    const b2 = e.target.closest("button"); if (!b2) return;
    const sg = b2.closest(".seg[data-vj]");
    if (sg) { const k = sg.dataset.vj, v = b2.dataset.v; setVJ(k, k === "fill" || k === "auto" ? v === "1" : k === "rec" ? v : +v); }
    else if (b2.dataset.show) setVJ(b2.dataset.show, VJS[b2.dataset.show] === false);
  });
  $("vjPanel").addEventListener("input", (e) => { const i = e.target.closest("input[data-vj]"); if (!i) return; setVJ(i.dataset.vj, i.type === "range" ? +i.value : i.value); });
  for (const t of ["pointerdown", "pointermove", "keydown"]) $("vjPanel").addEventListener(t, (e) => { e.stopPropagation(); poke(); });   // (the panel's own touches)
  const openVJ = (on) => { $("vjPanel").hidden = !on; $("raveVJ").setAttribute("aria-pressed", String(on)); closeScenes(); applyVJ(); poke(); };
  onPress($("raveVJ"), () => openVJ($("vjPanel").hidden));
  $("vjClose").addEventListener("click", () => openVJ(false));
  $("vjReset").addEventListener("click", () => { const keep = { fill: VJS.fill, rec: VJS.rec }; Object.assign(VJS, globalThis.AcidRave.VJ0, keep); saveVJ(); applyVJ(); });
  // Auto VJ: every 4 bars, a new look
  rave.onAuto = () => {
    const R = Math.random;
    Object.assign(VJS, { hue: R() < 0.3 ? 0 : Math.round(R() * 100) / 100, mirror: pick([0, 0, 1, 2, 3]), trails: R() < 0.5 ? 0 : Math.round((0.5 + R() * 0.4) * 100) / 100,
      zoom: R() < 0.5 ? 0 : 0.6, rgb: R() < 0.6 ? 0 : 0.5, pix: pick([1, 1, 1, 2, 3]) });
    if (R() < 0.4) rave.next();
    applyVJ();
  };
  // MIDI can turn the VJ's knobs too
  for (const [k, name, lo, hi] of [["hue", "VJ hue", 0, 1], ["trails", "VJ trails", 0, 0.95], ["zoom", "VJ kick zoom", 0, 1], ["rgb", "VJ colour split", 0, 1]])
    CTRL["vj_" + k] = { name, get: () => VJS[k], set: (v) => { VJS[k] = lo + v * (hi - lo); applyVJ(); } };
  CTRL.vj_mirror = { name: "VJ mirror", get: () => VJS.mirror / 3, set: (v) => { VJS.mirror = Math.round(v * 3); applyVJ(); } };
  // the second screen: a window that shows every frame (30 a second), for a projector
  let bc = null, outAlive = 0, lastOut = 0;
  const openOut = () => {
    if (!window.BroadcastChannel) { toast("This browser can’t open a second screen."); return; }
    if (!bc) {
      bc = new BroadcastChannel("acid-flower-vj");
      bc.onmessage = (e) => { if (e.data && e.data.hello) outAlive = performance.now(); if (e.data && e.data.bye) outAlive = 0; };
      rave.onFrame = (img) => {
        const now = performance.now();
        if (!outAlive || now - outAlive > 4000 || now - lastOut < 32) return;
        lastOut = now; bc.postMessage({ w: img.width, h: img.height, d: img.data });
      };
    }
    outAlive = performance.now();
    const w = window.open("vj.html", "acid-flower-vj", "popup,width=960,height=600");
    if (!w) toast("The window was blocked: allow pop-ups for this site, then try again.");
  };
  $("vjOut").addEventListener("click", openOut);
  applyVJ();



  // --------------------------------------------------------------------------------------- mouse, trackpad ---
  // a scroll turns what is under the pointer: a knob, tempo or swing, a note's pitch, the squelch pad (up and down the
  // resonance, sideways or with Shift the cutoff); a double-click puts a knob back (a mouse's: a finger's double tap
  // stays as it was); a dropped patterns file loads
  let wheelAcc = 0, wheelEl = null, wheelT = 0, wheelBegun = false;
  app.addEventListener("wheel", (e) => {
    const t = e.target.closest && e.target.closest(".strip, .st__note, .xy");
    if (!t) return;
    e.preventDefault();
    if (t !== wheelEl) { wheelEl = t; wheelAcc = 0; }
    const dy = e.deltaMode === 1 ? e.deltaY * 33 : e.deltaY, dx = e.deltaMode === 1 ? e.deltaX * 33 : e.deltaX;
    clearTimeout(wheelT); wheelT = setTimeout(() => { wheelEl = null; if (wheelBegun) { commit(); wheelBegun = false; } }, 500);
    if (t.classList.contains("xy")) {
      // up and down: the resonance; sideways (a trackpad), or Shift with a wheel: the cutoff
      if (e.shiftKey) S.params.cutoff = clamp01(S.params.cutoff - (dy || -dx) * 0.0012);
      else { S.params.reso = clamp01(S.params.reso - dy * 0.0012); S.params.cutoff = clamp01(S.params.cutoff + dx * 0.0012); }
      sendParams(); save(); drawXY();
      return;
    }
    wheelAcc += -dy;
    const STEP = 40, n = Math.trunc(wheelAcc / STEP);
    if (!n) return;
    wheelAcc -= n * STEP;
    if (t.classList.contains("st__note")) {
      if (!wheelBegun) { begin(); wheelBegun = true; }
      track = melOf(t); setFocus(track);
      const i = stp(+t.dataset.s), x = trk()[i];
      x.on = true; x.note = Math.max(0, Math.min(12, x.note + n));
      drawBass(); sendPattern(); save(); drawSlots(); audition(i);
    } else {
      const k = t.dataset.p, sp = spec(k);
      setParam(k, S.params[k] + n * sp.unit * (k === "tempo" || e.shiftKey ? 1 : 2)); drawStrip(t);
    }
  }, { passive: false });
  let lastPtrType = "";
  addEventListener("pointerdown", (e) => { lastPtrType = e.pointerType; }, true);
  strips.forEach((t) => { if (!t.title) t.title = (t.getAttribute("aria-label") || "") + ": drag up or down" + (t.dataset.p === "tempo" ? ", or tap the middle in time" : "") + ", or scroll" + (t.dataset.p !== "tempo" ? "; double-click to reset" : "") + "; Shift for fine"; });
  // a file dropped on the window: a set of patterns
  let dragDepth = 0;
  addEventListener("dragenter", (e) => { if ([...(e.dataTransfer && e.dataTransfer.types || [])].includes("Files")) { dragDepth++; document.documentElement.classList.add("is-filedrag"); } });
  addEventListener("dragleave", () => { if (--dragDepth <= 0) { dragDepth = 0; document.documentElement.classList.remove("is-filedrag"); } });
  addEventListener("dragover", (e) => { if ([...(e.dataTransfer && e.dataTransfer.types || [])].includes("Files")) e.preventDefault(); });
  addEventListener("drop", (e) => {
    const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    dragDepth = 0; document.documentElement.classList.remove("is-filedrag");
    if (!f) return;
    e.preventDefault();
    importFrom(f);
  });


  // ---------------------------------------------------------------------------------------- the keyboard ---
  // a piano on the letters (A to K, the black keys on W E T Y U; Z and X the octave) for the lead or the bass,
  // whichever was touched last; on a step, the arrows move and change it; Shift selects; Cmd C / X / V copy, cut and
  // paste steps, or the whole pattern
  const PIANO = { KeyA: 0, KeyW: 1, KeyS: 2, KeyE: 3, KeyD: 4, KeyF: 5, KeyT: 6, KeyG: 7, KeyY: 8, KeyH: 9, KeyU: 10, KeyJ: 11, KeyK: 12, KeyO: 13, KeyL: 14 };
  let kbOct = 0;
  const held = new Map();
  function pianoDown(e) {
    if (e.code === "KeyZ" || e.code === "KeyX") { kbOct = Math.max(-2, Math.min(2, kbOct + (e.code === "KeyX" ? 1 : -1))); toast("Keys: octave " + (kbOct > 0 ? "+" : "") + kbOct); return true; }
    const n = PIANO[e.code];
    if (n == null || e.shiftKey) return false;
    e.preventDefault();
    if (e.repeat || held.has(e.code)) return true;
    const voice = track === "lead" ? "lead" : "bass", note = (voice === "lead" ? 60 : 36) + 12 * kbOct + n + S.params.tune;
    held.set(e.code, { note, voice });
    post({ type: "live", on: true, note, voice, acc: false });
    rave.event({ ...viz, note, accHit: false, hits: 0 });
    return true;
  }
  addEventListener("keyup", (e) => { const h = held.get(e.code); if (!h) return; held.delete(e.code); post({ type: "live", on: false, note: h.note, voice: h.voice }); });
  addEventListener("blur", () => { for (const h of held.values()) post({ type: "live", on: false, note: h.note, voice: h.voice }); held.clear(); });
  $("keysBtn").addEventListener("click", () => { menu.close(); show($("keysMenu")); });
  $("keysMenu").addEventListener("click", (e) => { if (e.target === $("keysMenu")) $("keysMenu").close(); });

  // a cell, as a place: a melodic step { kind: "mel", tr, i } or a drum step { kind: "drum", l, i } (i: the step)
  const cellOf = (t) => (t.classList.contains("dr") ? { kind: "drum", l: +t.dataset.lane, i: stp(+t.dataset.s) } : { kind: "mel", tr: melOf(t), i: stp(+t.dataset.s) });
  const elOf = (c) => {
    if (c.i < page * 16 || c.i >= page * 16 + 16) { page = c.i >= 16 ? 1 : 0; pageT = performance.now(); drawAll(); }
    const col = c.i - page * 16;
    if (c.kind === "drum") return drumsEl.querySelector(`.dr[data-lane="${c.l}"][data-s="${col}"]`);
    const ed = studio && c.tr === "lead" ? leadEl : bassEl;
    if (!studio && c.tr !== track) { track = c.tr; drawAll(); }
    return ed.querySelector(`.st__note[data-s="${col}"]`);
  };
  function setAnchor(t) { anchor = cellOf(t); }
  function selectFrom(t, extend) {
    const c = cellOf(t);
    if (!extend || !anchor || anchor.kind !== c.kind || (c.kind === "mel" && anchor.tr !== c.tr)) { anchor = c; }
    sel = c.kind === "drum" ? { kind: "drum", l0: Math.min(anchor.l, c.l), l1: Math.max(anchor.l, c.l), a: Math.min(anchor.i, c.i), b: Math.max(anchor.i, c.i) }
                            : { kind: "mel", tr: c.tr, a: Math.min(anchor.i, c.i), b: Math.max(anchor.i, c.i) };
    drawSel();
  }
  function clearSel() { sel = null; drawSel(); }
  function drawSel() {
    for (const ed of eds) { const tr = edTrack(ed); ed.cols.forEach((c, col) => { const i = stp(col); c.note.classList.toggle("is-sel", !!sel && sel.kind === "mel" && sel.tr === tr && i >= sel.a && i <= sel.b); }); }
    cells.forEach((row, l) => row.forEach((d, col) => { const i = stp(col); d.classList.toggle("is-sel", !!sel && sel.kind === "drum" && l >= sel.l0 && l <= sel.l1 && i >= sel.a && i <= sel.b); }));
  }
  function clearRange() {
    if (!sel) return;
    begin();
    const p = pat();
    for (let i = sel.a; i <= sel.b; i++) {
      if (sel.kind === "mel") p[sel.tr][i] = rest();
      else for (let l = sel.l0; l <= sel.l1; l++) { p.drums[l][i] = false; p.dp[l][i] = 100; p.dr[l][i] = 1; }
    }
    edited(); drawAll(); drawSel();
  }
  // Cmd A, C, X, V
  function clipKey(e) {
    const p = pat(), k = e.code;
    if (k === "KeyA") {
      if (focusInSteps() || studio) {
        if (tab() === "drums") sel = { kind: "drum", l0: 0, l1: LANES.length - 1, a: 0, b: p.len - 1 };
        else sel = { kind: "mel", tr: track, a: 0, b: trkLen(p) - 1 };
        anchor = sel.kind === "drum" ? { kind: "drum", l: 0, i: 0 } : { kind: "mel", tr: track, i: 0 };
        drawSel(); return true;
      }
      return false;
    }
    if (k === "KeyC" || k === "KeyX") {
      if (sel && sel.kind === "mel") clip = { kind: "mel", steps: clone(p[sel.tr].slice(sel.a, sel.b + 1)) };
      else if (sel) clip = { kind: "drum", lanes: sel.l1 - sel.l0 + 1, l0: sel.l0, rows: [...Array(sel.l1 - sel.l0 + 1).keys()].map((j) => ({
        on: p.drums[sel.l0 + j].slice(sel.a, sel.b + 1), dp: p.dp[sel.l0 + j].slice(sel.a, sel.b + 1), dr: p.dr[sel.l0 + j].slice(sel.a, sel.b + 1) })) };
      else clip = { kind: "pattern", p: clone(p) };
      try { navigator.clipboard && navigator.clipboard.writeText("acid-flower:" + JSON.stringify(clip)).catch(() => {}); } catch {}
      const what = clip.kind === "pattern" ? "the pattern" : clip.kind === "mel" ? clip.steps.length + " step" + (clip.steps.length > 1 ? "s" : "") : clip.rows[0].on.length + " step" + (clip.rows[0].on.length > 1 ? "s" : "") + " of " + clip.lanes + " drum" + (clip.lanes > 1 ? "s" : "");
      if (k === "KeyX") { if (sel) clearRange(); else { begin(); S.slots[S.cur] = Object.assign(empty(), { name: p.name }); edited(); drawAll(); } toast("Cut " + what, "Undo", undo); }
      else toast("Copied " + what);
      return true;
    }
    if (k === "KeyV") {
      if (!clip) { toast("Nothing copied yet"); return true; }
      begin();
      if (clip.kind === "pattern") { S.slots[S.cur] = Object.assign(normPat(clone(clip.p)), { name: p.name, next: p.next }); }
      else if (clip.kind === "mel") {
        const tr = sel && sel.kind === "mel" ? sel.tr : anchor && anchor.kind === "mel" ? anchor.tr : track === "lead" ? "lead" : "bass";
        const at0 = sel && sel.kind === "mel" ? sel.a : anchor && anchor.kind === "mel" ? anchor.i : 0;
        clip.steps.forEach((x, j) => { if (at0 + j < MAXS) p[tr][at0 + j] = stepOK(clone(x)); });
        sel = { kind: "mel", tr, a: at0, b: Math.min(MAXS - 1, at0 + clip.steps.length - 1) };
      } else {
        const l0 = sel && sel.kind === "drum" ? sel.l0 : anchor && anchor.kind === "drum" ? anchor.l : clip.l0, at0 = sel && sel.kind === "drum" ? sel.a : anchor && anchor.kind === "drum" ? anchor.i : 0;
        clip.rows.forEach((r, j) => { const l = l0 + j; if (l >= LANES.length) return; r.on.forEach((v, q) => { if (at0 + q < MAXS) { p.drums[l][at0 + q] = v; p.dp[l][at0 + q] = r.dp[q]; p.dr[l][at0 + q] = r.dr[q]; } }); });
        sel = { kind: "drum", l0, l1: Math.min(LANES.length - 1, l0 + clip.lanes - 1), a: at0, b: Math.min(MAXS - 1, at0 + clip.rows[0].on.length - 1) };
      }
      edited(); drawAll(); drawSel(); toast("Pasted", "Undo", undo);
      return true;
    }
    return false;
  }
  const focusInSteps = () => { const a = document.activeElement; return !!(a && a.closest && a.closest(".st__note, .dr")); };
  // a step's own keys: arrows move (Shift: select), up and down change a note (or move between drums), Delete clears
  function stepKey(e) {
    const t = e.target;
    if (!t.classList || !(t.classList.contains("st__note") || t.classList.contains("dr"))) return false;
    const c = cellOf(t), k = e.key, p = pat();
    const go = (n) => { const el = elOf(n); if (!el) return; el.focus({ preventScroll: true }); if (e.shiftKey) selectFrom(el, true); else { clearSel(); anchor = n; } };
    if (k === "ArrowLeft" || k === "ArrowRight") {
      e.preventDefault(); e.stopPropagation();
      const len = c.kind === "drum" ? laneLen(c.l) : c.tr === "lead" ? p.llen || p.len : p.len;
      if (!e.shiftKey && !sel) anchor = c;
      go({ ...c, i: (c.i + (k === "ArrowRight" ? 1 : -1) + len) % len });
      return true;
    }
    if (k === "ArrowUp" || k === "ArrowDown") {
      e.preventDefault(); e.stopPropagation();
      const d = k === "ArrowUp" ? 1 : -1;
      if (c.kind === "drum") { go({ ...c, l: (c.l - d + LANES.length) % LANES.length }); return true; }
      begin(); track = c.tr; const x = p[c.tr][c.i];
      if (e.shiftKey) x.oct = Math.max(-1, Math.min(1, x.oct + d)); else x.note = Math.max(0, Math.min(12, x.note + d));
      x.on = true; drawBass(); edited(); audition(c.i);
      return true;
    }
    if (k === "Delete" || k === "Backspace") {
      e.preventDefault(); e.stopPropagation();
      if (sel) { clearRange(); return true; }
      begin();
      if (c.kind === "drum") { p.drums[c.l][c.i] = false; drawDrums(); } else { p[c.tr][c.i] = rest(); drawBass(); }
      edited();
      return true;
    }
    return false;
  }


  // ------------------------------------------------------------------------------------------ audio export ---
  // a pattern (four times round) or the song, rendered offline (an OfflineAudioContext runs the same worklet, faster
  // than real time) into WAV files: the mix, and if asked the stems (the bass, the lead, the drums, each with its sends)
  let wavJob = null;
  const wavFile = (buf, name) => {                         // 16-bit stereo PCM
    const n = buf.length, L = buf.getChannelData(0), R = buf.numberOfChannels > 1 ? buf.getChannelData(1) : L;
    const dv = new DataView(new ArrayBuffer(44 + n * 4)), str = (o, t) => { for (let i = 0; i < t.length; i++) dv.setUint8(o + i, t.charCodeAt(i)); };
    str(0, "RIFF"); dv.setUint32(4, 36 + n * 4, true); str(8, "WAVE"); str(12, "fmt "); dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, 2, true);
    dv.setUint32(24, buf.sampleRate, true); dv.setUint32(28, buf.sampleRate * 4, true); dv.setUint16(32, 4, true); dv.setUint16(34, 16, true); str(36, "data"); dv.setUint32(40, n * 4, true);
    for (let i = 0, o = 44; i < n; i++, o += 4) { dv.setInt16(o, Math.max(-1, Math.min(1, L[i])) * 32767, true); dv.setInt16(o + 2, Math.max(-1, Math.min(1, R[i])) * 32767, true); }
    return new File([dv.buffer], name, { type: "audio/wav" });
  };
  async function renderAudio(list, name, stems) {
    if (!window.OfflineAudioContext) { $("wavMsg").textContent = "This browser can’t render audio."; return; }
    const sr = 44100, steps = list.reduce((n, [p, r]) => n + p.len * r, 0), secs = (steps * 60) / S.params.tempo / 4 + 2.5;
    const code = await (await fetch("acid-worklet.js", { cache: "no-cache" })).text(), url = URL.createObjectURL(new Blob([code], { type: "text/javascript" }));
    const one = async (mute) => {
      const off = new OfflineAudioContext(2, Math.ceil(secs * sr), sr);
      await off.audioWorklet.addModule(url);
      const n = new AudioWorkletNode(off, "acid-flower", { numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [2],
        processorOptions: { params: clone(S.params), queue: list.map(([p, reps]) => ({ pattern: clone(p), reps })), play: true, mute } });
      n.connect(off.destination);
      return off.startRendering();
    };
    const base = "acid-flower-" + String(name).replace(/[^a-z0-9]+/gi, "-").toLowerCase(), files = [];
    const parts = [["mix", null], ...(stems ? [["bass", { lead: 1, drums: 1 }], ["lead", { bass: 1, drums: 1 }], ["drums", { bass: 1, lead: 1 }]] : [])];
    try {
      for (const [part, mute] of parts) { $("wavMsg").textContent = "Rendering the " + part + "…"; files.push(wavFile(await one(mute), base + "-" + part + ".wav")); }
    } catch (err) { $("wavMsg").textContent = "Couldn’t render: " + err.message; URL.revokeObjectURL(url); return; }
    URL.revokeObjectURL(url);
    $("wavMsg").textContent = "Done: " + files.length + " file" + (files.length > 1 ? "s" : "") + ", " + secs.toFixed(1) + " s each.";
    try { if (navigator.canShare && navigator.canShare({ files })) { await navigator.share({ files, title: "Acid Flower audio" }); return; } } catch (err) { if (err && err.name === "AbortError") return; }
    for (const f of files) { await saveFile(f, f.name); await new Promise((r) => setTimeout(r, 350)); }   // (one download each, a moment apart)
  }
  const openWav = (list, name, what) => { wavJob = { list, name }; $("wavWhat").textContent = what; $("wavMsg").textContent = ""; show($("wavMenu")); };
  $("slotWav").addEventListener("click", () => { const p = S.slots[sheetSlot], nm = p.name || "pattern-" + (sheetSlot + 1); $("slotMenu").close(); openWav([[p, 4]], nm, "Pattern " + (sheetSlot + 1) + (p.name ? " (" + p.name + ")" : "") + ", four times round."); });
  $("songWav").addEventListener("click", () => { if (!S.song.length) return toast("Add patterns to the song first"); $("songMenu").close(); openWav(S.song.map((x) => [S.slots[x.slot], x.reps]), "song", "The song: " + S.song.map((x) => x.slot + 1 + "×" + x.reps).join(", ") + "."); });
  $("wavMix").addEventListener("click", () => wavJob && renderAudio(wavJob.list, wavJob.name, false));
  $("wavStems").addEventListener("click", () => wavJob && renderAudio(wavJob.list, wavJob.name, true));
  $("wavMenu").addEventListener("click", (e) => { if (e.target === $("wavMenu")) $("wavMenu").close(); });

  // ------------------------------------------------------------------------------------------- the output ---
  // where the sound goes (Chrome and Edge can choose: an audio interface, headphones); remembered
  const sinkOK = !!(window.AudioContext && AudioContext.prototype.setSinkId);
  const OUT_KEY = "acid-flower-output";
  async function drawOutputs() {
    $("outOpt").hidden = !sinkOK || !navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices;
    if ($("outOpt").hidden) return;
    let devs = [];
    try { devs = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === "audiooutput" && d.deviceId !== "default"); } catch {}
    const cur = (() => { try { return localStorage.getItem(OUT_KEY) || ""; } catch { return ""; } })();
    $("outSel").innerHTML = `<option value="">The system's</option>` + devs.map((d, i) => `<option value="${d.deviceId}">${d.label || "Output " + (i + 1)}</option>`).join("");
    $("outSel").value = devs.some((d) => d.deviceId === cur) ? cur : "";
  }
  const applyOutput = async () => { if (!sinkOK || !ctx) return; let id = ""; try { id = localStorage.getItem(OUT_KEY) || ""; } catch {} try { await ctx.setSinkId(id); } catch {} };
  $("outSel").addEventListener("change", async () => { try { localStorage.setItem(OUT_KEY, $("outSel").value); } catch {} await applyOutput(); toast("Sound to " + $("outSel").selectedOptions[0].textContent); });
  $("menuBtn").addEventListener("click", drawOutputs);
  playHooks.push(() => applyOutput());
  drawOutputs();

  // --------------------------------------------------------------------------------- an app on the desktop ---
  // Chrome and Edge can install it (its own window and icon); the window's title says what plays
  let installEv = null;
  addEventListener("beforeinstallprompt", (e) => { e.preventDefault(); installEv = e; $("installBtn").hidden = false; });
  addEventListener("appinstalled", () => { $("installBtn").hidden = true; installEv = null; toast("Installed: Acid Flower has its own window now"); });
  $("installBtn").addEventListener("click", async () => { if (!installEv) return; installEv.prompt(); try { await installEv.userChoice; } catch {} installEv = null; $("installBtn").hidden = true; });
  function drawTitle() { const p = pat(); document.title = (playing ? "▶ " : "") + (p.name || "Pattern " + (S.cur + 1)) + " · Acid Flower"; }
  playHooks.push(drawTitle);

  // ------------------------------------------------------------------------------------------ pocket jam ---
  // shake to mutate (the motion sensor), and the light filter (the front camera's brightness: the frames stay here,
  // sampled at 16 x 12 and thrown away)
  let shakeOn = false, shakeT = 0, lastAcc = null;
  const onShake = (e) => {
    const a = e.accelerationIncludingGravity || e.acceleration; if (!a || a.x == null) return;
    if (lastAcc) {
      const d = Math.abs(a.x - lastAcc.x) + Math.abs(a.y - lastAcc.y) + Math.abs(a.z - lastAcc.z), now = performance.now();
      if (d > 28 && now - shakeT > 900) { shakeT = now; runAct($("mutate")); buzz(30); rave.burst && rave.burst(); }
    }
    lastAcc = { x: a.x, y: a.y, z: a.z };
  };
  const setShake = async (on) => {
    if (on) {
      try {
        if (window.DeviceMotionEvent && typeof DeviceMotionEvent.requestPermission === "function" && (await DeviceMotionEvent.requestPermission()) !== "granted") { msg("Shake needs motion access."); on = false; }
        else if (!("DeviceMotionEvent" in window)) { msg("This device has no motion sensor."); on = false; }
      } catch (err) { msg("Shake isn’t available here: " + err.message); on = false; }
    }
    shakeOn = on; lastAcc = null;
    if (on) addEventListener("devicemotion", onShake); else removeEventListener("devicemotion", onShake);
    $("shakeSeg").querySelectorAll("button").forEach((b2) => b2.setAttribute("aria-pressed", String(b2.dataset.v === (on ? "1" : "0"))));
  };
  let light = null;
  const setLight = async (on) => {
    if (light) { clearInterval(light.t); light.stream.getTracks().forEach((t) => t.stop()); light = null; }
    if (on) {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user", width: 160, height: 120 }, audio: false });
        const v = document.createElement("video"); v.muted = true; v.playsInline = true; v.srcObject = stream; await v.play();
        const c = document.createElement("canvas"); c.width = 16; c.height = 12; const g = c.getContext("2d", { willReadFrequently: true });
        let lo = 255, hi = 0;
        light = { stream, t: setInterval(() => {
          g.drawImage(v, 0, 0, 16, 12); const d = g.getImageData(0, 0, 16, 12).data; let sum = 0;
          for (let i = 0; i < d.length; i += 4) sum += d[i] * 0.3 + d[i + 1] * 0.59 + d[i + 2] * 0.11;
          const L = sum / (d.length / 4); lo = Math.min(lo + 0.05, L); hi = Math.max(hi - 0.05, L);   // (the range it has seen, slowly forgetting)
          const x = hi - lo > 8 ? (L - lo) / (hi - lo) : 0.5;
          S.params.cutoff += (clamp01(0.1 + x * 0.8) - S.params.cutoff) * 0.5; sendParams(); drawXY();
        }, 60) };
      } catch (err) { msg("The light filter needs the camera: " + (err.message || err.name)); on = false; }
    }
    $("lightSeg").querySelectorAll("button").forEach((b2) => b2.setAttribute("aria-pressed", String(b2.dataset.v === (on ? "1" : "0"))));
  };
  $("shakeSeg").addEventListener("click", (e) => { const b2 = e.target.closest("button"); if (b2) setShake(b2.dataset.v === "1"); });
  $("lightSeg").addEventListener("click", (e) => { const b2 = e.target.closest("button"); if (b2) setLight(b2.dataset.v === "1"); });
  document.addEventListener("visibilitychange", () => { if (document.hidden && light) setLight(false); });
  setShake(false); setLight(false);

  // ------------------------------------------------------------------------------------ no sound? help ---
  // if the sound stops (another app took it, a call, Bluetooth gone, the iPad asleep), a button to bring it back
  function watchSound() {
    setInterval(() => {
      const bad = ctx && !document.hidden && $("gate").hidden && ctx.state !== "running";
      $("noSound").hidden = !bad;
    }, 1000);
  }
  $("noSound").addEventListener("click", async () => {
    try { if (navigator.audioSession) navigator.audioSession.type = "playback"; } catch {}
    try { await ctx.resume(); } catch {}
    setTimeout(() => {
      if (ctx.state === "running") { $("noSound").hidden = true; toast("Sound back"); }
      else toast("Still nothing: close other apps playing sound, check the volume (and, on an iPhone, the silent switch), then reopen Acid Flower.", null, null, 9000);
    }, 500);
  });

  // ------------------------------------------------------------------------------------ the backup nudge ---
  // the patterns live only on this device: after a lot of changes and a week without a copy, a reminder
  function backupNudge() {
    const week = 7 * 864e5, now = Date.now();
    if ((S.edits || 0) < 25 || now - (S.backupAt || 0) < week || now - (S.nudgedAt || 0) < 3 * 864e5) return;
    S.nudgedAt = now; save();
    toast("Your patterns live only on this device. Keep a copy?", "Save", () => $("export").click(), 12000);
  }

  // -------------------------------------------------------------------------------------- the keyboard ---
  // a step focused with Tab: Enter or Space toggles it (a note rests or comes back; a drum step on or off)
  for (const el of [bassEl, leadEl, drumsEl]) el.addEventListener("keydown", (e) => {
    if (stepKey(e)) return;
    if (e.key !== "Enter" && e.key !== " ") return;
    const t = e.target;
    if (t.classList.contains("st__note")) { e.preventDefault(); e.stopPropagation(); track = melOf(t); setFocus(track); begin(); const i = stp(+t.dataset.s), x = trk()[i]; x.on = !x.on; drawBass(); edited(); audition(i); }
    else if (t.classList.contains("dr")) { e.preventDefault(); e.stopPropagation(); begin(); const l = +t.dataset.lane, i = stp(+t.dataset.s); pat().drums[l][i] = !pat().drums[l][i]; drawDrums(); edited(); }
  });
  document.querySelectorAll(".st__note, .dr").forEach((el) => { el.tabIndex = 0; if (el.classList.contains("st__note")) el.setAttribute("role", "button"); });

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

  window.acid = { state: () => S, renderAudio, sel: () => sel, clip: () => clip, studio: () => studio, kbOct: () => kbOct, VJS, applyVJ, ctx: () => ctx, onMidi: (d) => onMidi({ data: d, timeStamp: performance.now() }), onMidiAt: (d, t) => onMidi({ data: d, timeStamp: t }), clockLoop, CTRL, MP, toMidi, gen, songPos: () => [songI, songLoop], locked: () => locked, decode2, normPat, undo, redo, encode: (i) => encode(S.slots[i == null ? S.cur : i]), latch: () => latch, nextSlot: () => nextSlot, playing: () => playing, viz: () => viz, rave, boot, tilt: () => tiltOn, fold: () => [...document.documentElement.classList].filter((c) => c.startsWith("fold")).join(" ") };
})();
