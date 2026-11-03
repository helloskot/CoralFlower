// SPDX-License-Identifier: GPL-3.0-only
// CoralFlower for iPad: the firmware (../play/coralflower.wasm) runs in ../play/worklet.js; this page is its touch
// surface. Every pad is one of the FM-1's 27 keys and every button one of its 14, so all of CoralFlower works as on
// the unit, but the controls are laid out for fingers: the pads show the firmware's own key caps (web_keycaps: the
// chord on a chord button, the note and its degree on a root, HOLD, the sequencer's steps) and the knob strips its
// knob names and values (web_knobs). Before Play a silent copy boots here to show the screen and the pads.
"use strict";
(() => {
  const { KEYMAP } = globalThis.FM1;
  const $ = (id) => document.getElementById(id);
  const status = (t) => ($("status").textContent = t);
  const isUpper = (k) => (0x54a >> ((k + 5) % 12)) & 1;      // the "black" keys: F#3 G#3 A#3 C#4 ...
  const SUP = "⁰¹²³⁴⁵⁶⁷⁸⁹";
  const cstr = (u8, off, n) => {                              // a NUL-ended firmware string (small digits as ⁰..⁹)
    let s = "";
    for (let i = off; i < off + n && u8[i]; i++) {
      const c = u8[i];
      s += c >= 0x10 && c <= 0x19 ? SUP[c - 0x10] : String.fromCharCode(c);
    }
    return s;
  };

  // --------------------------------------------------------------------------------------------- the pads ---
  const upperRow = $("upper"), lowerRow = $("lower"), playBtn = upperRow.querySelector(".tbtn--play");
  const pads = [];
  for (let k = 0; k < 27; k++) {
    const b = document.createElement("div");
    b.className = "pad";
    b.dataset.k = k;
    b.setAttribute("role", "button");
    b.innerHTML = '<i class="pad__led"></i><span class="pad__top"></span><span class="pad__bot"></span>';
    if (isUpper(k)) upperRow.insertBefore(b, playBtn);
    else lowerRow.appendChild(b);
    pads.push({ el: b, top: b.querySelector(".pad__top"), bot: b.querySelector(".pad__bot"), cls: "", led: -1 });
  }
  const btns = [...document.querySelectorAll("[data-b]")];
  const btnEl = [];
  for (const b of btns) (btnEl[+b.dataset.b] ||= []).push(b);
  const encEl = [...document.querySelectorAll(".enc")];
  const knobEl = encEl.filter((e) => e.classList.contains("enc--knob"));

  // ---------------------------------------------------------------------------------------------- input ---
  const keySrc = Array.from({ length: 27 }, () => new Set()), btnSrc = Array.from({ length: 14 }, () => new Set());
  let node = null, sentK = -1, sentB = -1, master = 724;
  const post = (m) => node && node.port.postMessage(m);
  const publish = () => {
    let k = 0, b = 0;
    keySrc.forEach((s, i) => s.size && (k |= 1 << i));
    btnSrc.forEach((s, i) => s.size && (b |= 1 << i));
    if (k !== sentK) post({ type: "keys", mask: (sentK = k) >>> 0 });
    if (b !== sentB) post({ type: "buttons", mask: (sentB = b) >>> 0 });
    pads.forEach((p, i) => p.el.classList.toggle("is-down", keySrc[i].size > 0));
    btnEl.forEach((list, i) => list && list.forEach((e) => e.classList.toggle("is-down", btnSrc[i].size > 0)));
  };
  const press = (kind, i, src, down) => {
    const set = (kind === "k" ? keySrc : btnSrc)[i];
    if (!set) return;
    down ? set.add(src) : set.delete(src);
    publish();
  };
  const releaseAll = (test) => {
    for (const s of [...keySrc, ...btnSrc]) for (const x of [...s]) if (test(x)) s.delete(x);
    publish();
  };
  const turn = (role, n) => {
    if (!n) return;
    if (role === 7) { master = Math.max(0, Math.min(1023, master + 16 * n)); drawVol(); }
    post({ type: "enc", role, n });
  };
  const drawVol = () => $("volFill").style.setProperty("--vol", (100 * master) / 1023 + "%");

  // pads: a finger presses the pad under it while it stays down, and slides along its row to the next pad
  const ptr = new Map();
  const padAt = (x, y) => { const e = document.elementFromPoint(x, y); return e && e.closest && e.closest(".pad"); };
  const app = $("app");
  app.addEventListener("pointerdown", (e) => {
    const t = e.target.closest && e.target.closest(".pad, [data-b], .enc");
    if (!t) return;
    e.preventDefault();
    if (t.classList.contains("pad")) {
      const k = +t.dataset.k;
      ptr.set(e.pointerId, { kind: "k", i: k, row: isUpper(k) });
      press("k", k, "p" + e.pointerId, true);
    } else if (t.dataset.b != null) {
      ptr.set(e.pointerId, { kind: "b", i: +t.dataset.b });
      press("b", +t.dataset.b, "p" + e.pointerId, true);
    } else {
      const r = t.getBoundingClientRect();
      ptr.set(e.pointerId, { kind: "e", el: t, role: +t.dataset.e, x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY,
                             acc: 0, moved: false, w: r.width, left: r.left });
      t.classList.add("is-turn");
    }
    try { app.setPointerCapture(e.pointerId); } catch {}
  });
  app.addEventListener("pointermove", (e) => {
    const p = ptr.get(e.pointerId);
    if (!p) return;
    if (p.kind === "k") {
      const el = padAt(e.clientX, e.clientY);
      if (!el) return;
      const k = +el.dataset.k;
      if (k === p.i || isUpper(k) !== p.row) return;
      press("k", p.i, "p" + e.pointerId, false);
      p.i = k;
      press("k", k, "p" + e.pointerId, true);
    } else if (p.kind === "e") {
      const vol = p.role === 7;
      const d = vol ? e.clientX - p.x : p.y - e.clientY;   // up (or right, for the volume) turns clockwise
      p.x = e.clientX; p.y = e.clientY;
      if (Math.abs(e.clientX - p.x0) + Math.abs(e.clientY - p.y0) > 10) p.moved = true;
      if (!p.moved) return;
      p.acc += d;
      const step = vol ? Math.max(4, (p.w - 24) / 64) : 16;
      const n = Math.trunc(p.acc / step);
      if (n) { p.acc -= n * step; turn(p.role, n); }
    }
  });
  const up = (e) => {
    const p = ptr.get(e.pointerId);
    if (!p) return;
    ptr.delete(e.pointerId);
    if (p.kind === "e") {
      p.el.classList.remove("is-turn");
      if (!p.moved && e.type === "pointerup") {          // a tap: the arrows step, the volume jumps there
        const f = (e.clientX - p.left) / p.w;
        if (p.role === 7) { const m = Math.round(Math.max(0, Math.min(1, (f * p.w - 12) / (p.w - 24))) * 1023); turn(7, Math.round((m - master) / 16)); }
        else if (f < 0.3 || f > 0.7) {
          const side = f < 0.3 ? "is-l" : "is-r";
          turn(p.role, f < 0.3 ? -1 : 1);
          p.el.classList.add(side);
          setTimeout(() => p.el.classList.remove(side), 120);
        }
      }
    } else {
      press(p.kind, p.i, "p" + e.pointerId, false);
    }
  };
  for (const t of ["pointerup", "pointercancel"]) app.addEventListener(t, up);
  app.addEventListener("contextmenu", (e) => e.preventDefault());
  for (const t of ["gesturestart", "gesturechange", "dblclick"]) document.addEventListener(t, (e) => e.preventDefault(), { passive: false });
  app.addEventListener("wheel", (e) => {
    const t = e.target.closest && e.target.closest(".enc");
    if (!t) return;
    e.preventDefault();
    turn(+t.dataset.e, e.deltaY < 0 ? 1 : -1);
  }, { passive: false });

  // a hardware keyboard (an iPad's Magic Keyboard): the page's keymap (../play/keymap.js)
  const byCode = Object.fromEntries(KEYMAP.map((m) => [m.code, m]));
  let selKnob = 3;
  addEventListener("keydown", (e) => {
    const m = byCode[e.code];
    if (!m || e.metaKey || e.altKey || $("menu").open) return;
    e.preventDefault();
    if (e.repeat && m.kind !== "turn" && m.kind !== "arrow") return;
    if (m.kind === "key") press("k", m.idx, "kb", true);
    else if (m.kind === "btn") press("b", m.idx, "kb" + e.code, true);
    else if (m.kind === "turn") turn(m.idx[0], m.idx[1]);
    else if (m.kind === "cycle") {
      const O = [3, 4, 5, 6, 0, 2, 1, 7], at = O.indexOf(selKnob);
      selKnob = O[(at + (e.shiftKey ? -1 : 1) + O.length) % O.length];
      encEl.forEach((el) => el.classList.toggle("is-sel", +el.dataset.e === selKnob));
    } else if (m.kind === "arrow") turn(selKnob, selKnob === 7 ? 2 * m.idx : m.idx);
  });
  addEventListener("keyup", (e) => {
    const m = byCode[e.code];
    if (!m) return;
    if (m.kind === "key") press("k", m.idx, "kb", false);
    else if (m.kind === "btn") press("b", m.idx, "kb" + e.code, false);
  });
  // no stuck notes: the app in the background, or the keyboard's window gone, lets everything go
  addEventListener("blur", () => releaseAll((s) => s.startsWith("kb")));
  document.addEventListener("visibilitychange", () => { if (document.hidden) { ptr.clear(); releaseAll(() => true); } });

  // ------------------------------------------------------------------------------------- what it shows ---
  const lcd = $("lcd"), g2 = lcd.getContext("2d"), view = $("view"), v2 = view.getContext("2d");
  const img = g2.createImageData(240, 240), px = new Uint32Array(img.data.buffer);
  const LUT = new Uint32Array(65536);
  for (let u = 0; u < 65536; u++) {   // a big-endian RGB565 word read little-endian -> RGBA
    const c = ((u >> 8) | (u << 8)) & 0xffff;
    const r = (((c >> 11) & 31) * 255 + 15) / 31, g = (((c >> 5) & 63) * 255 + 31) / 63, b = ((c & 31) * 255 + 15) / 31;
    LUT[u] = 0xff000000 | (b << 16) | (g << 8) | r;
  }
  // the screen's key row and knob row (y 158..239) are on the pads and strips here: the view shows y 0..156, the
  // whole screen on a tap
  let full = false;
  const blit = () => {
    v2.imageSmoothingEnabled = false;
    if (full) v2.drawImage(lcd, 0, 0);
    else v2.drawImage(lcd, 0, 0, 240, 157, 0, 0, 240, 157);
  };
  const setFull = (f) => {
    full = f;
    view.height = f ? 240 : 157;
    view.parentNode.classList.toggle("is-full", f);
    $("fullView").textContent = f ? "Show the screen without its key row" : "Show the whole screen";
    blit();
  };
  view.addEventListener("click", () => setFull(!full));
  const drawFb = (fb) => {
    for (let i = 0; i < 57600; i++) px[i] = LUT[fb[i]];
    g2.putImageData(img, 0, 0);
    blit();
  };
  const BTN_LED = { 10: "var(--lime)", 11: "var(--rose)", 6: "var(--sun)" };
  const drawLeds = (L) => {
    for (let k = 0; k < 27; k++) {
      const p = pads[k], v = L[k];
      if (v !== p.led) { p.el.classList.remove("l-" + p.led); if (v) p.el.classList.add("l-" + v); p.led = v; }
    }
    for (let i = 0; i < 14; i++) for (const e of btnEl[i] || []) {
      const v = L[27 + i];
      e.classList.toggle("led-1", v === 1); e.classList.toggle("led-2", v === 2); e.classList.toggle("led-3", v === 3);
      if (BTN_LED[i]) e.style.setProperty("--led", BTN_LED[i]);
    }
    playBtn.classList.toggle("is-green", !!L[41]);
  };
  const drawCaps = (c) => {
    for (let k = 0; k < 27; k++) {
      const o = 20 * k, p = pads[k], top = cstr(c, o, 8), bot = cstr(c, o + 8, 8), style = c[o + 16], btn = c[o + 17], icon = c[o + 18];
      const t = top || (icon ? "●" : "");
      if (p.top.textContent !== t) p.top.textContent = t;
      if (p.bot.textContent !== bot) p.bot.textContent = bot;
      const cls = "s-" + style + (btn ? " pad--btn" : "");
      if (cls !== p.cls) {
        p.el.classList.remove(...p.cls.split(" ").filter(Boolean));
        p.el.classList.add(...cls.split(" "));
        p.cls = cls;
      }
      p.el.setAttribute("aria-label", (top + " " + bot).trim() || "key " + (k + 1));
    }
  };
  const drawKnobs = (b) => {
    knobEl.forEach((el, i) => {
      const o = 32 * i, name = cstr(b, o, 12), val = cstr(b, o + 12, 14), bar = (b[o + 26] | (b[o + 27] << 8)) << 16 >> 16;
      el.querySelector("b").textContent = name || "K" + (i + 1);
      el.querySelector("em").textContent = val || "–";
      const bb = el.querySelector(".enc__bar");
      bb.hidden = bar < 0;
      if (bar >= 0) bb.style.setProperty("--bar", (100 * bar) / 255 + "%");
      el.classList.toggle("is-dis", !!b[o + 28]);
      el.setAttribute("aria-label", (name || "Knob " + (i + 1)) + ": " + val);
    });
  };

  // ---------------------------------------------------------------------------------- the flash (IndexedDB) ---
  // the same store as the /play/ page: the two share their settings, sounds and patterns
  const db = () => new Promise((ok, no) => {
    const r = indexedDB.open("coralflower-fm1", 1);
    r.onupgradeneeded = () => r.result.createObjectStore("kv");
    r.onsuccess = () => ok(r.result);
    r.onerror = () => no(r.error);
  });
  const kv = async (mode, f) => {
    const d = await db();
    return new Promise((ok, no) => {
      const t = d.transaction("kv", mode), r = f(t.objectStore("kv"));
      t.oncomplete = () => { d.close(); ok(r.result); };
      t.onerror = () => { d.close(); no(t.error); };
    });
  };
  const flashLoad = () => Promise.race([kv("readonly", (s) => s.get("flash")).catch(() => null),
                                       new Promise((ok) => setTimeout(() => ok(null), 1500))]);
  const flashSave = (buf) => kv("readwrite", (s) => s.put(buf, "flash")).catch(() => {});

  // ------------------------------------------------------------------------------------------- the wasm ---
  const wasmP = fetch("../play/coralflower.wasm", { cache: "no-cache" })
    .then((r) => { if (!r.ok) throw new Error("coralflower.wasm: " + r.status); return r.arrayBuffer(); });
  const workletP = fetch("../play/worklet.js", { cache: "no-cache" })
    .then((r) => { if (!r.ok) throw new Error("worklet.js: " + r.status); return r.text(); });

  (async () => {   // before Play: a silent copy boots here to show the screen and the pads
    try {
      const bytes = await wasmP;
      status("Starting up…");
      let mem;
      const wasi = { fd_write: (fd, iov, n, out) => { const d = new DataView(mem.buffer); let l = 0; for (let i = 0; i < n; i++) l += d.getUint32(iov + 8 * i + 4, true); d.setUint32(out, l, true); return 0; } };
      const stub = new Proxy(wasi, { get: (t, k) => (k in t ? t[k] : () => 0) });
      const { instance } = await WebAssembly.instantiate(bytes.slice(0), { wasi_snapshot_preview1: stub, env: new Proxy({}, { get: () => () => 0 }) });
      const ex = instance.exports;
      mem = ex.memory;
      if (ex._initialize) ex._initialize();
      const f = await flashLoad();
      if (f && f.byteLength === ex.web_flash_size()) {
        new Uint8Array(mem.buffer, ex.web_flash_stage(), f.byteLength).set(new Uint8Array(f));
        ex.web_flash_stage_len(f.byteLength);
      }
      ex.web_boot();
      ex.web_step(30);
      if (node) return;
      drawFb(new Uint16Array(mem.buffer, ex.web_fb(), 57600));
      drawLeds(new Uint8Array(mem.buffer, ex.web_leds(), 42));
      if (ex.web_keycaps) {
        drawCaps(new Uint8Array(mem.buffer, ex.web_keycaps(), 540));
        drawKnobs(new Uint8Array(mem.buffer, ex.web_knobs(), 128));
      }
      $("ver").textContent = cstr(new Uint8Array(mem.buffer), ex.web_version(), 64);
      status("Ready.");
      $("start").disabled = false;
    } catch (err) {
      status("Couldn’t load CoralFlower: " + err.message + ". Check the connection and reload.");
    }
  })();

  // Safari: the audio context is made and resumed inside the tap; the audio session plays through the mute
  // switch; a context Safari suspends or interrupts is resumed by the next touch or the return to the app
  let ctx = null;
  const wake = () => { if (ctx && ctx.state !== "running" && ctx.state !== "closed") ctx.resume().catch(() => {}); };
  for (const t of ["pointerdown", "keydown"]) addEventListener(t, wake, true);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) wake(); });
  $("start").onclick = async () => {
    $("start").disabled = true;
    try {
      if (!window.AudioWorkletNode) throw new Error("this browser has no AudioWorklet: update iPadOS (16.4 or later)");
      try { if (navigator.audioSession) navigator.audioSession.type = "playback"; } catch {}
      ctx = new AudioContext({ sampleRate: 44100, latencyHint: "interactive" });
      ctx.resume().catch(() => {});
      ctx.onstatechange = () => { if (ctx.state === "interrupted" && !document.hidden) wake(); };
      const code = await workletP;   // (as a blob: offline it comes from the cache like the rest)
      const url = URL.createObjectURL(new Blob([code], { type: "text/javascript" }));
      await ctx.audioWorklet.addModule(url);
      URL.revokeObjectURL(url);
      node = new AudioWorkletNode(ctx, "coralflower-fm1", { numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [2] });
      node.connect(ctx.destination);
      node.port.onmessage = (e) => onWorklet(e.data);
      const [bytes, flash] = await Promise.all([wasmP, flashLoad()]);
      node.port.postMessage({ type: "load", wasm: bytes.slice(0), flash, master, caps: true });
      await ctx.resume();
      status("Starting…");
    } catch (err) {
      $("start").disabled = false;
      status("Couldn’t start the sound: " + err.message);
    }
  };
  const onWorklet = (m) => {
    if (m.type === "frame") {
      if (m.fb) drawFb(m.fb);
      drawLeds(m.leds);
      if (m.caps) drawCaps(m.caps);
      if (m.knobs) drawKnobs(m.knobs);
      if (m.master !== master) { master = m.master; drawVol(); }
    } else if (m.type === "ready") {
      $("gate").hidden = true;
      $("ver").textContent = m.version;
      sentK = sentB = -1;
      publish();
    } else if (m.type === "flash") flashSave(m.data);
    else if (m.type === "error") { $("gate").hidden = false; $("start").disabled = false; status("CoralFlower stopped: " + m.message); }
  };

  // ------------------------------------------------------------------------------------------- the menu ---
  const menu = $("menu");
  $("menuBtn").addEventListener("click", () => (menu.showModal ? menu.showModal() : menu.setAttribute("open", "")));
  menu.addEventListener("click", (e) => { if (e.target === menu) menu.close(); });
  $("fullView").onclick = () => { setFull(!full); menu.close(); };
  $("reset").onclick = async () => {
    if (!confirm("Forget the settings, sounds and patterns saved on this iPad?")) return;
    await kv("readwrite", (s) => s.delete("flash")).catch(() => {});
    location.reload();
  };

  // Add to Home Screen, when it is Safari in a tab (a Home Screen app is "standalone")
  const standalone = navigator.standalone || matchMedia("(display-mode: standalone), (display-mode: fullscreen)").matches;
  if (!standalone && navigator.maxTouchPoints > 0) $("a2hs").hidden = false;
  if ("serviceWorker" in navigator && location.protocol === "https:") navigator.serviceWorker.register("sw.js").catch(() => {});

  drawVol();
  window.cf = { keys: (l) => { releaseAll((s) => s === "cf"); for (const k of l) press("k", k, "cf", true); },
                btn: (i, ms = 80) => { press("b", i, "cf", true); setTimeout(() => press("b", i, "cf", false), ms); },
                turn, started: () => !!node };
})();
