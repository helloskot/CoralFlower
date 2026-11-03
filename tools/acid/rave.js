// SPDX-License-Identifier: GPL-3.0-only
// Acid Flower's pixel rave: 240 x 150 pixels, drawn every frame from what the sound engine reports (the step, the
// filter's envelope and the accents' charge, the cutoff and resonance, every drum hit, every bass note, a scrap of the
// waveform). Five scenes, changing every 8 bars or on a tap: WAREHOUSE (a crowd, lasers, spotlights, fog, the smiley
// flower on the stage), TUNNEL (rings rushing past, a radial scope), PLASMA (a palette-cycling field the filter warps,
// bouncing smileys), GARDEN (every bass note grows a flower, accents bloom bigger, fireflies on the hats) and FEEDBACK
// (each frame zoomed and turned into the next, the waveform drawn on top). Over every scene: particles (confetti on
// claps, sparks on accents), big pixel words on accents, a shake on the kick, colour fringes on accents, scanlines,
// a strobe; each pattern has its own colours. Calm mode (or a device that asks for reduced motion) drops the strobe,
// the shake and the flashing words.
"use strict";
(() => {
  const W = 240, H = 150, N = W * H;
  const TAU = Math.PI * 2;
  const SIN = new Float32Array(1024);
  for (let i = 0; i < 1024; i++) SIN[i] = Math.sin((i / 1024) * TAU);
  const sn = (x) => SIN[((x * 162.97) | 0) & 1023];         // sin(x), from the table
  const rnd = Math.random;
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

  // colours
  const YEL = [255, 225, 0], LIME = [180, 255, 43], PINK = [255, 47, 180], CYAN = [43, 240, 255], ORANGE = [255, 138, 31],
        VIOLET = [176, 64, 255], WHITE = [255, 255, 255], INK = [17, 10, 2];
  // the acid palette: 256 steps round violet, pink, orange, yellow, lime, cyan and back; a pattern turns it
  const STOPS = [[20, 0, 40], VIOLET, PINK, ORANGE, YEL, LIME, CYAN, [40, 60, 255], [20, 0, 40]];
  const PAL = new Float32Array(256 * 3);
  for (let i = 0; i < 256; i++) {
    const f = (i / 256) * (STOPS.length - 1), k = Math.floor(f), t = f - k, a = STOPS[k], b = STOPS[k + 1];
    for (let c = 0; c < 3; c++) PAL[i * 3 + c] = a[c] + (b[c] - a[c]) * t;
  }
  const pal = (i) => { const j = ((i | 0) & 255) * 3; return [PAL[j], PAL[j + 1], PAL[j + 2]]; };

  // fonts: 3 x 5 for the display's small words, 5 x 7 for the big ones
  const F3 = { A: "010101111101101", B: "110101110101110", C: "011100100100011", D: "110101101101110", E: "111100110100111",
    F: "111100110100100", G: "011100101101011", H: "101101111101101", I: "111010010010111", J: "001001001101010",
    K: "101101110101101", L: "100100100100111", M: "101111111101101", N: "110101101101101", O: "010101101101010",
    P: "110101110100100", Q: "010101101110011", R: "110101110101101", S: "011100010001110", T: "111010010010010",
    U: "101101101101111", V: "101101101101010", W: "101101111111101", X: "101101010101101", Y: "101101010010010",
    Z: "111001010100111", 0: "111101101101111", 1: "010110010010111", 2: "111001111100111", 3: "111001111001111",
    4: "101101111001001", 5: "111100111001111", 6: "111100111101111", 7: "111001010010010", 8: "111101111101111",
    9: "111101111001111", " ": "000000000000000", "%": "101001010100101", "!": "010010010000010", ">": "100010001010100",
    ":": "000010000010000", ".": "000000000000010", "-": "000000111000000", "/": "001001010100100", "#": "101111101111101",
    "=": "000111000111000", "_": "000000000000111" };
  const F5 = { A: "01110100011000111111100011000110001", C: "01111100001000010000100001000001111", D: "11110100011000110001100011000111110",
    E: "11111100001000011110100001000011111", F: "11111100001000011110100001000010000", H: "10001100011000111111100011000110001",
    I: "11111001000010000100001000010011111", J: "00111000100001000010000101001001100", K: "10001100101010011000101001001010001",
    L: "10000100001000010000100001000011111", O: "01110100011000110001100011000101110", R: "11110100011000111110101001001010001",
    S: "01111100001000001110000010000111110", U: "10001100011000110001100011000101110", V: "10001100011000110001100010101000100",
    W: "10001100011000110101101011010101010", "!": "00100001000010000100001000000000100", " ": "00000000000000000000000000000000000",
    T: "11111001000010000100001000010000100", N: "10001110011010110011100011000110001", M: "10001110111010110101100011000110001",
    P: "11110100011000111110100001000010000", Y: "10001100010101000100001000010000100", G: "01111100001000010011100011000101111",
    B: "11110100011000111110100011000111110", X: "10001100010101000100010101000110001", 0: "01110100011001110101110011000101110" };
  const WORDS = ["ACID", "FLOWER", "RAVE", "JACK", "LOVE", "HOUSE", "ACID!"];
  const HACKWORDS = ["ROOT", "ACCESS", "OVERRIDE", "SYSTEM", "0XACID", "BYPASS"];
  const SCENES = ["WAREHOUSE", "CYBERSPACE", "TUNNEL", "VOXEL", "PLASMA", "MAINFRAME", "GARDEN", "FEEDBACK"];
  const HACKER = { 1: true, 5: true };                  // (the scenes the terminal types over)
  const FXNAME = ["REPEAT 1/8", "REPEAT 1/16", "ROLL 1/32", "REVERSE", "TAPE STOP", "LOWPASS", "HIGHPASS", "CRUSH", "GATE", "ECHO", "BASS OUT", "DRUMS OUT"];
  const NOTES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
  const hex2 = (n) => ((n & 255) + 256).toString(16).slice(1).toUpperCase();
  // the voxel flower: the app's icon (20 x 20) made solid, two voxels deep, the petals pushed out in front
  const ICON = [".........##.........", "........#PP#........", "....####PPPP####....", "...#LLL#PPPP#LLL#...", "..#LLLL######LLLL#..",
    "..#LL###YYYY###LL#..", "..#LL#YWWYYYYY#LL#..", "..####YYYYYYYY####..", ".#PP#YYYKYYKYYY#PP#.", "#PPP#YYYKYYKYYY#PPP#",
    "#PPP#YYYYYYYYYY#PPP#", ".#PP#YYKYYYYKYY#PP#.", "..####YYKKKKYY####..", "..#LL#YYYYYYYY#LL#..", "..#LL###YYYY###LL#..",
    "..#LLLL######LLLL#..", "...#LLL#PPPP#LLL#...", "....####PPPP####....", "........#PP#........", ".........##........."];
  const VCOL = { Y: [255, 225, 0], K: [30, 18, 6], "#": [30, 18, 6], P: [255, 47, 180], L: [180, 255, 43], W: [255, 252, 220] };
  const VOX = [];
  ICON.forEach((row, y) => [...row].forEach((ch, x) => {
    if (!VCOL[ch]) return;
    const depth = ch === "P" || ch === "L" ? [-1, 0] : ch === "#" ? [-1, 0, 1] : [0, 1];
    for (const z of depth) VOX.push({ x: x - 9.5, y: 9.5 - y, z: z * 1 - (ch === "K" ? 0.6 : 0), c: VCOL[ch] });
  }));
  // a tower's height in the data city: the same at the same place, every time
  const hash = (a, b) => { let h = (a * 374761393 + b * 668265263) | 0; h = (h ^ (h >>> 13)) * 1274126177; return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };

  class Rave {
    constructor(canvas, hooks) {
      this.cv = canvas; this.g = canvas.getContext("2d"); this.hooks = hooks;
      canvas.width = W; canvas.height = H;
      this.img = this.g.createImageData(W, H);
      this.buf = new Float32Array(N * 3); this.prev = new Float32Array(N * 3);
      this.scene = 0; this.auto = true; this.calm = false;
      this.t = 0; this.tPrev = 0; this.scroll = 0; this.bar = 0; this.lastStep = -1; this.barOfScene = 0;
      this.kick = 0; this.snare = 0; this.clap = 0; this.hat = 0; this.accent = 0; this.flash = 0; this.shake = 0;
      this.v = { step: -1, env: 0, acc: 0, cut: 0.3, reso: 0.7, amp: 0, wave: new Float32Array(64) };
      this.parts = []; this.flowers = []; this.bouncers = [];
      this.word = null; this.sceneLabel = 1.5; this.pad = null;
      for (let i = 0; i < 7; i++) this.bouncers.push({ x: 20 + i * 32, y: 100, vy: 0, s: rnd() * TAU });
      // the crowd: a row of heads, each with its own sway
      this.crowd = Array.from({ length: 22 }, (_, i) => ({ x: 6 + i * 11 + rnd() * 5, h: rnd() * 4, ph: rnd() * TAU, up: 0 }));
      // tables: a vignette, the plasma's distances
      this.vig = new Float32Array(N); this.dist = new Float32Array(N);
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        const dx = (x - W / 2) / (W / 2), dy = (y - H / 2) / (H / 2), d = Math.sqrt(dx * dx + dy * dy);
        this.vig[y * W + x] = clamp(1.15 - 0.45 * d * d, 0.35, 1);
        this.dist[y * W + x] = Math.sqrt((x - W / 2) ** 2 + (y - H / 2) ** 2);
      }
      // the punch-ins (what the sound is doing to the picture), the hacker terminal, the mainframe's flying text
      this.fx = 0; this.tape = 1; this.fxSince = new Float32Array(12); this.freeze = null; this.lastOut = new Float32Array(N * 3);
      this.rowOff = new Int16Array(H); this.repIdx = -1;
      this.term = ["> CONNECT 0XACID", "> HANDSHAKE OK"]; this.termT = 0;
      this.flyers = [];
      this.terrain = Array.from({ length: 12 }, () => new Float32Array(16));
      this.loop = this.loop.bind(this);
    }
    start() { requestAnimationFrame(this.loop); }
    next() { this.scene = (this.scene + 1) % SCENES.length; this.sceneLabel = 1.6; this.barOfScene = 0; this.prev.fill(0); }
    setPad(x, y) { this.pad = x == null ? null : [x, y]; }

    // ------------------------------------------------------------------------------------- the sound's news ---
    event(m) {
      this.v = m;
      const fx = m.fx | 0;
      for (let b = 0; b < 12; b++) if ((fx >> b) & 1 && !((this.fx >> b) & 1)) this.fxSince[b] = this.t;
      if ((fx & 7) && !(this.fx & 7)) this.freeze = null;
      this.fx = fx; this.tape = m.tape == null ? 1 : m.tape;
      if (m.step >= 0 && m.step !== this.lastStep) this.typeStep(m);
      if (m.step >= 0 && m.step !== this.lastStep) {
        if (m.step < this.lastStep || this.lastStep < 0) {   // a new bar
          this.bar++; this.barOfScene++;
          if (this.auto && this.barOfScene >= 8 && m.playing) this.next();
        }
        this.lastStep = m.step;
      }
      if (!m.playing) this.lastStep = -1;
      if (m.hits & 1) { this.kick = 1; this.shake = 1; }
      if (m.hits & 2) this.snare = 1;
      if (m.hits & 4) { this.clap = 1; this.flash = Math.max(this.flash, 0.5); this.confetti(26); }
      if (m.hits & 24) { this.hat = 1; this.sparkle(m.hits & 16 ? 6 : 2); }
      if (m.accHit) {
        this.accent = 1; this.flash = Math.max(this.flash, 0.22);
        this.sparks(10);
        const ws = HACKER[this.scene] ? HACKWORDS : WORDS;
        if (rnd() < 0.35 && !this.word) this.word = { s: ws[(rnd() * ws.length) | 0], life: 1 };
      }
      if (m.note >= 0) this.grow(m.note, m.accHit);
    }

    // ------------------------------------------------------------------------------------------- particles ---
    confetti(n) {
      for (let i = 0; i < n; i++) this.parts.push({ k: 0, x: rnd() * W, y: -2 - rnd() * 20, vx: (rnd() - 0.5) * 20, vy: 20 + rnd() * 30,
        life: 2.5, c: [PINK, YEL, LIME, CYAN, VIOLET][(rnd() * 5) | 0], ph: rnd() * TAU });
    }
    sparks(n) {
      const [cx, cy] = this.center();
      for (let i = 0; i < n; i++) { const a = rnd() * TAU, s = 30 + rnd() * 70; this.parts.push({ k: 1, x: cx, y: cy, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: 0.7, c: rnd() < 0.5 ? YEL : PINK }); }
    }
    sparkle(n) { for (let i = 0; i < n; i++) this.parts.push({ k: 2, x: rnd() * W, y: rnd() * H * 0.6, vx: 0, vy: -4, life: 0.35, c: WHITE }); }
    grow(note, acc) {
      const pc = ((note % 12) + 12) % 12, x = 90 + (((note - 24) / 44) * (W - 110)) + (rnd() - 0.5) * 60;   // (right of the gardener)
      this.flowers.push({ x: clamp(x, 6, W - 6), h: 26 + ((note - 24) / 44) * 50 + rnd() * 8, g: 0, acc: acc ? 1 : 0, born: this.t,
        c: pal(pc * 21 + this.slotShift()), c2: acc ? YEL : pal(pc * 21 + 128 + this.slotShift()), sw: rnd() * TAU });
      if (this.flowers.length > 28) this.flowers.shift();
    }
    center() { return this.scene === 0 ? [W / 2, 52 - this.kick * 5] : [W / 2, H / 2]; }
    slotShift() { return ((this.hooks.slot() | 0) * 32) & 255; }

    // ------------------------------------------------------------------------------------------ primitives ---
    fill(r, g, b) { const B = this.buf; for (let i = 0; i < N * 3; i += 3) { B[i] = r; B[i + 1] = g; B[i + 2] = b; } }
    fade(k) { const B = this.buf; for (let i = 0; i < N * 3; i++) B[i] *= k; }
    set(x, y, c, a = 1) {
      x |= 0; y |= 0; if (x < 0 || y < 0 || x >= W || y >= H) return;
      const i = (y * W + x) * 3, B = this.buf;
      if (a >= 1) { B[i] = c[0]; B[i + 1] = c[1]; B[i + 2] = c[2]; }
      else { B[i] += (c[0] - B[i]) * a; B[i + 1] += (c[1] - B[i + 1]) * a; B[i + 2] += (c[2] - B[i + 2]) * a; }
    }
    add(x, y, c, a) { x |= 0; y |= 0; if (x < 0 || y < 0 || x >= W || y >= H) return; const i = (y * W + x) * 3, B = this.buf; B[i] += c[0] * a; B[i + 1] += c[1] * a; B[i + 2] += c[2] * a; }
    line(x0, y0, x1, y1, c, a, glow = false) {
      const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0)) | 0;
      for (let i = 0; i <= n; i++) {
        const t = n ? i / n : 0, x = x0 + (x1 - x0) * t, y = y0 + (y1 - y0) * t;
        this.add(x, y, c, a);
        if (glow) { this.add(x + 1, y, c, a * 0.3); this.add(x - 1, y, c, a * 0.3); this.add(x, y + 1, c, a * 0.3); this.add(x, y - 1, c, a * 0.3); }
      }
    }
    sline(x0, y0, x1, y1, c, a = 1) {
      const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0)) | 0;
      for (let i = 0; i <= n; i++) { const t = n ? i / n : 0; this.set(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, c, a); }
    }
    disc(cx, cy, r, c, a = 1) { for (let y = Math.floor(-r); y <= r; y++) for (let x = Math.floor(-r); x <= r; x++) if (x * x + y * y <= r * r) this.set(cx + x, cy + y, c, a); }
    rect(x, y, w, h, c, a = 1) { for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) this.set(x + i, y + j, c, a); }
    text3(s, x, y, c, a = 1) {
      for (const ch of String(s)) { const f = F3[ch] || F3[" "]; for (let i = 0; i < 15; i++) if (f[i] === "1") this.set(x + (i % 3), y + ((i / 3) | 0), c, a); x += 4; }
    }
    text5(s, x, y, k, c, outline) {
      const w = s.length * 6 * k;
      for (const pass of outline ? [0, 1] : [1]) {
        let cx = x;
        for (const ch of s) {
          const f = F5[ch] || F5[" "];
          for (let i = 0; i < 35; i++) if (f[i] === "1") {
            const px = cx + (i % 5) * k, py = y + ((i / 5) | 0) * k;
            if (pass) this.rect(px, py, k, k, c);
            else this.rect(px - 1, py - 1, k + 2, k + 2, INK);
          }
          cx += 6 * k;
        }
      }
      return w;
    }

    // the smiley flower: petals turning with the beat and opening with the filter, a grin as wide as the cutoff, a
    // wobble from the resonance, cross eyes on accents
    flower(cx, cy, r, sc = 1) {
      const v = this.v, env = v.env || 0, cut = v.cut, reso = v.reso, sq = 1 - this.kick * 0.12;
      r = Math.round(r * sc + env * 2 * sc);
      const spin = this.scroll * 0.35, pr = (5.2 + env * 1.6) * sc * (r / 16), pd = r + (3 + env * 3 + this.kick * 2) * sc;
      for (const pass of [0, 1]) for (let k = 0; k < 8; k++) {
        const a = spin + (k * Math.PI) / 4, px = cx + Math.cos(a) * pd, py = cy + Math.sin(a) * pd * sq;
        this.disc(px, py, pass ? pr : pr + 1.2, pass ? (k % 2 ? LIME : PINK) : INK);
      }
      for (let y = -r - 1; y <= r + 1; y++) for (let x = -r - 1; x <= r + 1; x++) {
        const dd = (x * x) / ((r + 0.5) ** 2) + (y * y) / ((r * sq + 0.5) ** 2);
        if (dd <= 1) this.set(cx + x, cy + y, x + y > r * 0.9 ? [235, 190, 0] : YEL);
        else if (dd <= 1.18) this.set(cx + x, cy + y, INK);
      }
      const e = Math.max(1, Math.round(r / 7)), ex = Math.round(r * 0.38), ey = Math.round(r * 0.32);
      if (this.accent > 0.35) {
        for (const s of [-1, 1]) for (let i = -e - 1; i <= e + 1; i++) { this.set(cx + s * ex + i, cy - ey + i, INK); this.set(cx + s * ex + i, cy - ey - i, INK); }
      } else {
        for (const s of [-1, 1]) this.rect(cx + s * ex - (e >> 1), cy - ey - e, e + 1, e * 2 + 1, INK);
      }
      const grin = 0.35 + 0.6 * cut, mw = Math.round(r * (0.5 + cut * 0.2));
      for (let x = -mw; x <= mw; x++) {
        const t = x / mw, wob = Math.sin(this.t * 9 + x * 0.9) * reso * 1.3 * sc;
        const y = cy + Math.round(r * 0.25) + Math.round((1 - t * t) * r * 0.33 * grin + wob);
        this.set(cx + x, y, INK); this.set(cx + x, y - 1 + (Math.abs(t) > 0.85 ? 1 : 0), INK);
        if (sc > 1.4) this.set(cx + x, y + 1, INK);
      }
      if (this.accent > 0.2) for (const s of [-1, 1]) this.rect(cx + s * Math.round(r * 0.62) - 1, cy + Math.round(r * 0.18), 3, 1, PINK, this.accent);
    }
    smiley(cx, cy, r, c = YEL) {               // a little one, for the plasma's bouncers
      this.disc(cx, cy, r + 1, INK); this.disc(cx, cy, r, c);
      this.set(cx - 2, cy - 1, INK); this.set(cx + 2, cy - 1, INK);
      for (let x = -2; x <= 2; x++) this.set(cx + x, cy + 2 - (Math.abs(x) === 2 ? 1 : 0), INK);
    }
    scope(y0, amp, c, x0 = 20, x1 = W - 20) {
      const w = this.v.wave || [], n = w.length;
      if (n < 2) return;
      let pk = 0.05; for (let j = 0; j < n; j++) pk = Math.max(pk, Math.abs(w[j]));
      const g = Math.min(1, (this.v.amp || 0) * 3 + 0.2);
      for (let j = 0; j < n - 1; j++) {
        const xa = x0 + ((x1 - x0) * j) / (n - 1), xb = x0 + ((x1 - x0) * (j + 1)) / (n - 1);
        const ya = y0 - (w[j] / pk) * amp * g, yb = y0 - (w[j + 1] / pk) * amp * g;
        this.line(xa, ya + 1, xb, yb + 1, [90, 90, 90], -0.7);   // (a shadow under the trace)
        this.line(xa, ya, xb, yb, c, 0.9, true);
      }
    }

    // ---------------------------------------------------------------------------------------------- scenes ---
    warehouse() {
      const v = this.v, cut = v.cut, reso = v.reso, env = v.env || 0, sh = this.slotShift();
      // the roof: dark, a haze of the pattern's colour
      const top = pal(sh + 10), B = this.buf;
      for (let y = 0; y < H; y++) {
        const t = Math.min(1, y / 95), r = 6 + top[0] * 0.12 * t, g = 2 + top[1] * 0.06 * t, b = 14 + top[2] * 0.2 * t;
        for (let x = 0; x < W; x++) { const i = (y * W + x) * 3; B[i] = r; B[i + 1] = g; B[i + 2] = b; }
      }
      for (let k = 0; k < 26; k++) { const x = (k * 53 + 7) % W, y = (k * 29 + 3) % 60; this.add(x, y, WHITE, 0.12 + 0.4 * this.hat * (k & 1)); }
      // spotlights: two cones from the top corners, sweeping, wider as the filter opens
      for (const side of [0, 1]) {
        const ox = side ? W - 8 : 8, a = Math.PI / 2 + (side ? 0.45 : -0.45) + Math.sin(this.t * 0.6 + side * 2) * 0.5, wid = 0.08 + cut * 0.12;
        const col = side ? CYAN : PINK;
        for (let y = 0; y < 98; y += 1) {
          const d = y / Math.max(0.2, Math.sin(a)), xc = ox + Math.cos(a) * d, hw = d * Math.tan(wid);
          for (let x = Math.floor(xc - hw); x <= xc + hw; x++) this.add(x, y, col, 0.06 + 0.05 * this.kick);
        }
      }
      // the lasers: they sweep with the music, more and brighter with the filter and the accents
      const beams = 4 + Math.round(cut * 6) + (this.accent > 0.3 ? 4 : 0), inten = 0.2 + 0.35 * env + 0.45 * this.accent + 0.2 * cut;
      for (let k = 0; k < beams; k++) {
        const ox = [6, W - 7, W / 2, W / 4, (3 * W) / 4][k % 5], col = [LIME, CYAN, PINK, LIME, YEL][k % 5];
        const a = Math.PI / 2 + Math.sin(this.t * (0.7 + 0.25 * k) + k * 1.7 + this.scroll * 0.5) * (0.55 + 0.35 * reso) + [-0.4, 0.4, 0, -0.2, 0.2][k % 5];
        this.line(ox, 0, ox + Math.cos(a) * 220, Math.sin(a) * 220, this.accent > 0.6 ? WHITE : col, inten, true);
      }
      // fog: slow bands, lit by the kick
      for (let y = 60; y < 100; y++) {
        const f = (sn(y * 0.21 + this.t * 0.7) + sn(y * 0.07 - this.t * 0.4)) * 0.5;
        if (f > 0.2) for (let x = 0; x < W; x += 1) this.add(x, y, [120, 60, 160], (f - 0.2) * 0.12 * (0.6 + sn(x * 0.05 + this.t + y) * 0.4) * (0.7 + this.kick * 0.6));
      }
      // the stage: the smiley flower
      this.flower(W / 2, 50 - this.kick * 6, 17);
      this.scope(84, 6, LIME, 60, W - 60);
      // the dance floor: a checkerboard rushing in, lit by the kick
      for (let y = 96; y < H; y++) {
        const d = y - 90, z = 90 / d, light = 0.4 + 0.6 * this.kick, fade = Math.min(1, (y - 96) / 14 + 0.25);
        for (let x = 0; x < W; x++) {
          const u = ((x - W / 2) * 7) / d, par = (Math.floor(u) + Math.floor(z + this.scroll * 2)) & 1;
          const c = par ? pal(sh + 64) : [40, 6, 70];
          this.set(x, y, [c[0] * light * fade, c[1] * light * fade, c[2] * light * fade]);
        }
      }
      // the crowd: heads bobbing on the kick, hands up on accents
      const SIL = [6, 2, 10], rim = pal(sh + 140);
      for (const p of this.crowd) {
        const bob = Math.max(0, Math.sin(this.scroll * TAU + p.ph)) * 2 + this.kick * 2.5 * (0.5 + 0.5 * Math.sin(p.ph));
        if (this.accent > 0.5 && rnd() < 0.08) p.up = 1;
        p.up *= 0.96;
        const y = 134 - p.h - bob, x = p.x;
        if (p.up > 0.3) {                                   // hands in the air
          this.sline(x - 5, y + 8, x - 8, y - 6, SIL); this.sline(x - 4, y + 8, x - 7, y - 6, SIL);
          this.sline(x + 5, y + 8, x + 8, y - 6, SIL); this.sline(x + 4, y + 8, x + 7, y - 6, SIL);
          this.set(x - 8, y - 7, rim); this.set(x + 8, y - 7, rim);
        }
        for (let j = 0; y + 7 + j < H; j++) { const hw = Math.min(6, 3 + j); this.rect(x - hw, y + 7 + j, hw * 2 + 1, 1, SIL); }   // shoulders
        this.disc(x, y + 2, 4, SIL);
        this.set(x - 2, y - 2, rim, 0.7); this.set(x - 3, y - 1, rim, 0.5); this.set(x + 2, y - 2, rim, 0.3);   // the stage's light on them
      }
    }
    tunnel() {
      const v = this.v, sh = this.slotShift(), reso = v.reso, env = v.env || 0;
      this.fade(0.55);
      const rings = 16, rot = Math.sin(this.t * 0.35) * 0.6 + reso * 0.3 * Math.sin(this.t);
      for (let i = rings; i >= 1; i--) {
        let z = (i - ((this.scroll * 2) % 1)) / rings;
        const s = 6 / (z * z + 0.02), half = s * (1 + this.kick * 0.08), a = rot + z * 1.2 * reso;
        const c = pal(sh + i * 24 + this.scroll * 30 + this.accent * 64), br = clamp(1.2 - z, 0.15, 1) * (0.7 + env * 0.5);
        const pts = [0, 1, 2, 3].map((k) => { const ang = a + (k * Math.PI) / 2 + Math.PI / 4; return [W / 2 + Math.cos(ang) * half * 1.414, H / 2 + Math.sin(ang) * half * 1.414 * 0.8]; });
        for (let k = 0; k < 4; k++) { const p = pts[k], q = pts[(k + 1) % 4]; this.line(p[0], p[1], q[0], q[1], c, br, true); }
      }
      // the radial scope: the waveform round a ring at the end of the tunnel
      const w = v.wave || [], n = w.length;
      let pk = 0.05; for (let j = 0; j < n; j++) pk = Math.max(pk, Math.abs(w[j]));
      for (let j = 0; j < n; j++) {
        const a = (j / n) * TAU + this.t, r = 26 + (w[j] / pk) * 8 * Math.min(1, (v.amp || 0) * 3 + 0.2), a2 = ((j + 1) / n) * TAU + this.t;
        const r2 = 26 + (w[(j + 1) % n] / pk) * 8 * Math.min(1, (v.amp || 0) * 3 + 0.2);
        this.line(W / 2 + Math.cos(a) * r, H / 2 + Math.sin(a) * r * 0.85, W / 2 + Math.cos(a2) * r2, H / 2 + Math.sin(a2) * r2 * 0.85, LIME, 0.9, true);
      }
      this.flower(W / 2, H / 2, 11);
    }
    plasma() {
      const v = this.v, sh = this.slotShift(), B = this.buf, t = this.t;
      const k1 = 0.045 + v.reso * 0.05, k2 = 0.06 + (v.env || 0) * 0.06, sp = 1 + this.kick * 0.6, amp = 0.55 + Math.min(1, (v.amp || 0) * 2) * 0.45;
      const off = t * 40 + this.accent * 70 + sh + v.cut * 90;
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        const p = y * W + x;
        const val = sn(x * k1 + t * 1.3 * sp) + sn(y * k2 - t * 1.1) + sn((x + y) * 0.03 + t * 0.7) + sn(this.dist[p] * (0.08 + v.cut * 0.1) - t * 2.2 * sp);
        const j = (((val * 44 + off) | 0) & 255) * 3, i = p * 3, band = amp * (0.35 + 0.65 * Math.abs(sn(val * 2.2 + t)));
        B[i] = PAL[j] * band; B[i + 1] = PAL[j + 1] * band; B[i + 2] = PAL[j + 2] * band;
      }
      // the bouncers: little smileys that jump on the kick
      for (const b of this.bouncers) {
        if (this.kick > 0.95 && b.y > 120) b.vy = -90 - rnd() * 60;
        b.vy += 260 * this.dt; b.y += b.vy * this.dt;
        if (b.y > 132) { b.y = 132; b.vy *= -0.3; }
        b.x += Math.sin(b.s + t) * 10 * this.dt;
        this.smiley(b.x, b.y, 5);
      }
    }
    garden() {
      const v = this.v, sh = this.slotShift(), B = this.buf, t = this.t;
      for (let y = 0; y < H; y++) {
        const q = y / H, c = [8 + 30 * q, 4 + 10 * q, 30 + 40 * q];
        for (let x = 0; x < W; x++) { const i = (y * W + x) * 3; B[i] = c[0]; B[i + 1] = c[1]; B[i + 2] = c[2]; }
      }
      for (let k = 0; k < 40; k++) { const x = (k * 71 + 13) % W, y = (k * 37 + 5) % 70; this.add(x, y, WHITE, 0.15 + 0.5 * this.hat * ((k % 3) === 0)); }
      // the moon is a face: it pulses with the kick
      const mr = 15 + this.kick * 2;
      this.disc(190, 32, mr + 4, [60, 40, 90], 0.35); this.disc(190, 32, mr, [250, 240, 200]);
      this.set(185, 28, [120, 110, 90]); this.set(195, 28, [120, 110, 90]);
      for (let x = -5; x <= 5; x++) this.set(190 + x, 36 + Math.round((1 - (x / 5) ** 2) * 3 * (0.4 + v.cut)), [120, 110, 90]);
      // the hills
      for (let x = 0; x < W; x++) {
        const h = 112 + Math.round(sn(x * 0.03 + 1) * 6 + sn(x * 0.011 + 2) * 8);
        for (let y = h; y < H; y++) this.set(x, y, y > 132 ? [14, 40, 20] : [20, 54, 30]);
      }
      // the flowers: one for every bass note, a bigger bloom for an accent; they sway, then fade after 8 bars
      const life = (60 / Math.max(60, this.hooks.params().tempo)) * 4 * 8;
      this.flowers = this.flowers.filter((f) => t - f.born < life);
      for (const f of this.flowers) {
        f.g = Math.min(1, f.g + this.dt * 4);
        const age = (t - f.born) / life, fadeA = age > 0.8 ? (1 - age) / 0.2 : 1, sway = Math.sin(t * 2 + f.sw) * 3 * (0.4 + v.reso);
        const gy = 136, top = gy - f.h * Math.min(1, f.g * 1.4), tx = f.x + sway * f.g;
        this.sline(f.x, gy, tx, top, [50, 170, 60], fadeA);
        if (f.g > 0.5) { const lx = f.x + (tx - f.x) * 0.5, ly = gy - f.h * 0.35, side = f.sw > Math.PI ? 1 : -1; this.sline(lx, ly, lx + side * 5, ly - 3, LIME, fadeA * 0.9); this.set(lx + side * 4, ly - 1, LIME, fadeA * 0.9); }
        if (f.g > 0.7) {
          const pr = (2.2 + f.acc * 2 + (v.env || 0) * 1.2) * Math.min(1, (f.g - 0.7) * 4), spin = t * 0.8 + f.sw;
          for (let k = 0; k < 6; k++) { const a = spin + (k * TAU) / 6; this.disc(tx + Math.cos(a) * pr * 1.4, top + Math.sin(a) * pr * 1.4, pr * 0.85 + 0.6, INK, fadeA); }
          for (let k = 0; k < 6; k++) { const a = spin + (k * TAU) / 6; this.disc(tx + Math.cos(a) * pr * 1.4, top + Math.sin(a) * pr * 1.4, pr * 0.85, f.c, fadeA); }
          this.disc(tx, top, pr * 0.75, f.c2, fadeA);
        }
      }
      // the gardener: the smiley flower, swaying at the back
      this.flower(52, 62 + Math.sin(t * 1.5) * 2, 13);
    }
    feedback() {
      const v = this.v, sh = this.slotShift(), B = this.buf, P = this.prev;
      P.set(B);
      const z = 0.955 - this.kick * 0.04, a = (0.012 + v.reso * 0.03) * Math.sin(this.t * 0.2), ca = Math.cos(a) * z, sa = Math.sin(a) * z;
      const cx = W / 2 + Math.sin(this.t * 0.7) * 6, cy = H / 2 + Math.cos(this.t * 0.5) * 4, dec = 0.9;
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        const dx = x - cx, dy = y - cy, sx = (cx + dx * ca - dy * sa) | 0, sy = (cy + dx * sa + dy * ca) | 0, i = (y * W + x) * 3;
        if (sx < 0 || sy < 0 || sx >= W || sy >= H) { B[i] = B[i + 1] = B[i + 2] = 0; continue; }
        const j = (sy * W + sx) * 3;
        B[i] = P[j + 2] * dec; B[i + 1] = P[j] * dec; B[i + 2] = P[j + 1] * dec;   // (the colours turn round as they fall in)
      }
      const c = pal(sh + this.t * 60);
      this.scope(H / 2, 22 + (v.env || 0) * 20, c, 14, W - 14);
      const w = v.wave || [], n = w.length;
      let pk = 0.05; for (let j = 0; j < n; j++) pk = Math.max(pk, Math.abs(w[j]));
      for (let j = 0; j < n; j += 2) { const ang = (j / n) * TAU - this.t, r = 34 + (w[j] / pk) * 10; this.add(W / 2 + Math.cos(ang) * r, H / 2 + Math.sin(ang) * r * 0.8, PINK, 0.9); }
      if (this.accent > 0.5) this.flower(W / 2, H / 2, 9);
    }

    // ------------------------------------------------------------------------------------- the terminal ---
    // a line for every step (what the bass plays), others for the accents and the punch-ins; and, for the
    // mainframe, every note flies past as text
    typeStep(m) {
      const p = this.hooks.pattern(), b = p.bass[m.step], tune = this.hooks.params().tune | 0;
      let line;
      if (b && b.on) {
        const n = 36 + tune + b.note + 12 * b.oct, name = NOTES[((n % 12) + 12) % 12] + (Math.floor(n / 12) - 1);
        line = `> ${hex2(m.step * 16 + n)} ${name}${b.acc ? " ACC" : ""}${b.slide ? " SLD" : ""}`;
        this.flyers.push({ s: name, x: (rnd() - 0.5) * 40, y: (rnd() - 0.5) * 24, z: 60, c: b.acc ? PINK : LIME });
      } else line = `> ${hex2(m.step * 16)} ----`;
      if (m.accHit && rnd() < 0.5) line = ["> ROOT ACCESS", "> SQUELCH 99%", "> OVERRIDE OK", "> INJECT ACID"][(rnd() * 4) | 0];
      if (this.fx && this.fx !== this.termFx) { const b2 = 31 - Math.clz32(this.fx); line = "> FX " + FXNAME[b2]; }   // (once a press)
      this.termFx = this.fx;
      this.term.push(line);
      if (this.term.length > 7) this.term.shift();
      if (rnd() < 0.15) this.flyers.push({ s: "0X" + hex2((rnd() * 256) | 0) + hex2((rnd() * 256) | 0), x: (rnd() - 0.5) * 50, y: (rnd() - 0.5) * 30, z: 60, c: CYAN });
    }
    terminal() {
      const x = 4, y0 = H - 9 - this.term.length * 7;
      this.rect(x - 2, y0 - 2, 82, this.term.length * 7 + 3, [0, 8, 0], 0.55);
      this.term.forEach((l, i) => this.text3(l.slice(0, 20), x, y0 + i * 7, i === this.term.length - 1 ? [160, 255, 160] : [40, 200, 80]));
      if (Math.floor(this.t * 3) % 2) this.rect(x + Math.min(20, this.term[this.term.length - 1].length) * 4, y0 + (this.term.length - 1) * 7, 3, 5, [160, 255, 160]);
    }

    // ------------------------------------------------------------------------------------------ pixel 3D ---
    // a camera (position, yaw, pitch), a projection, a filled polygon, a box with its faces lit and its edges glowing
    cam(x, y, z, yaw, pitch, f = 150) { this.c3 = { x, y, z, cy: Math.cos(yaw), sy: Math.sin(yaw), cp: Math.cos(pitch), sp: Math.sin(pitch), f }; }
    proj(x, y, z) {
      const c = this.c3;
      let dx = x - c.x, dy = y - c.y, dz = z - c.z;
      const rx = dx * c.cy - dz * c.sy, rz = dx * c.sy + dz * c.cy;
      const ry = dy * c.cp - rz * c.sp, rz2 = dy * c.sp + rz * c.cp;
      if (rz2 < 0.3) return null;
      return [W / 2 + (rx * c.f) / rz2, H / 2 - (ry * c.f) / rz2, rz2];
    }
    poly(pts, c, a = 1) {
      let y0 = H, y1 = -1;
      for (const p of pts) { y0 = Math.min(y0, p[1]); y1 = Math.max(y1, p[1]); }
      y0 = Math.max(0, Math.ceil(y0)); y1 = Math.min(H - 1, Math.floor(y1));
      const n = pts.length;
      for (let y = y0; y <= y1; y++) {
        let xa = 1e9, xb = -1e9;
        for (let i = 0; i < n; i++) {
          const p = pts[i], q = pts[(i + 1) % n];
          if ((p[1] <= y && q[1] > y) || (q[1] <= y && p[1] > y)) { const x = p[0] + ((y - p[1]) * (q[0] - p[0])) / (q[1] - p[1]); xa = Math.min(xa, x); xb = Math.max(xb, x); }
        }
        if (xa > xb) continue;
        for (let x = Math.max(0, Math.ceil(xa)); x <= Math.min(W - 1, Math.floor(xb)); x++) this.set(x, y, c, a);
      }
    }
    // an axis-aligned box: fills (top, front, sides shaded from c), then glowing edges in e (null: none)
    box(x0, y0, z0, x1, y1, z1, c, e, ea = 0.9) {
      const P = [[x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0], [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]].map((q) => this.proj(q[0], q[1], q[2]));
      if (P.some((q) => !q)) return;
      const C = this.c3, F = [[[3, 2, 6, 7], 0, 1, 0, 1.0], [[0, 1, 2, 3], 0, 0, -1, 0.7], [[4, 5, 6, 7], 0, 0, 1, 0.7], [[0, 3, 7, 4], -1, 0, 0, 0.5], [[1, 2, 6, 5], 1, 0, 0, 0.5]];
      const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, cz = (z0 + z1) / 2;
      for (const [ix, nx, ny, nz, sh] of F) {
        const fx = cx + (nx * (x1 - x0)) / 2, fy = cy + (ny * (y1 - y0)) / 2, fz = cz + (nz * (z1 - z0)) / 2;
        if (nx * (C.x - fx) + ny * (C.y - fy) + nz * (C.z - fz) <= 0) continue;   // (facing away)
        const pts = ix.map((k) => P[k]);
        this.poly(pts, [c[0] * sh, c[1] * sh, c[2] * sh]);
        if (e) for (let k = 0; k < 4; k++) { const a = pts[k], b = pts[(k + 1) % 4]; this.line(a[0], a[1], b[0], b[1], e, ea); }
      }
    }
    // a cube turned by the rotation R (3 x 3, rows) about the model's centre, at T: the voxels
    voxel(px, py, pz, s, R, T, c) {
      const C = this.c3, w = (x, y, z) => [R[0] * x + R[1] * y + R[2] * z + T[0], R[3] * x + R[4] * y + R[5] * z + T[1], R[6] * x + R[7] * y + R[8] * z + T[2]];
      const h = s / 2, Q = [];
      for (const [dx, dy, dz] of [[-h, -h, -h], [h, -h, -h], [h, h, -h], [-h, h, -h], [-h, -h, h], [h, -h, h], [h, h, h], [-h, h, h]]) {
        const q = w(px + dx, py + dy, pz + dz), pr = this.proj(q[0], q[1], q[2]);
        if (!pr) return; Q.push(pr);
      }
      const ctr = w(px, py, pz);
      for (const [ix, nx, ny, nz, sh] of [[[3, 2, 6, 7], 0, 1, 0, 1.0], [[0, 1, 5, 4], 0, -1, 0, 0.35], [[0, 1, 2, 3], 0, 0, -1, 0.8], [[4, 5, 6, 7], 0, 0, 1, 0.8], [[0, 3, 7, 4], -1, 0, 0, 0.6], [[1, 2, 6, 5], 1, 0, 0, 0.6]]) {
        const n = [R[0] * nx + R[1] * ny + R[2] * nz, R[3] * nx + R[4] * ny + R[5] * nz, R[6] * nx + R[7] * ny + R[8] * nz];
        if (n[0] * (C.x - ctr[0]) + n[1] * (C.y - ctr[1]) + n[2] * (C.z - ctr[2]) <= 0) continue;
        const lit = sh * (0.75 + 0.25 * n[1]);
        this.poly(ix.map((k) => Q[k]), [c[0] * lit, c[1] * lit, c[2] * lit]);
      }
    }

    // CYBERSPACE: a flight through a neon data city: towers on a grid, their heights the same each pass, their
    // windows flickering data, the flight banking with the filter, the towers jumping on the kick
    cyberspace() {
      const v = this.v, sh = this.slotShift(), B = this.buf;
      for (let y = 0; y < H; y++) { const t = y / H, r = 4 + 30 * Math.max(0, 0.55 - Math.abs(t - 0.45)), b = 12 + 60 * Math.max(0, 0.55 - Math.abs(t - 0.45)); for (let x = 0; x < W; x++) { const i = (y * W + x) * 3; B[i] = r; B[i + 1] = 2; B[i + 2] = b; } }
      const speed = this.scroll * 6, camZ = speed, bank = Math.sin(this.t * 0.4) * 0.25 + (v.cut - 0.5) * 0.4;
      this.cam(Math.sin(this.t * 0.3) * 3, 7 + Math.sin(this.t * 0.5) * 1.5 - this.kick * 0.6, camZ, bank, -0.18 + (v.reso - 0.5) * 0.1, 130);
      // the floor: a neon grid running under the city
      const gz0 = Math.floor(camZ / 4) * 4;
      for (let k = 0; k < 18; k++) { const z = gz0 + k * 4; const a = this.proj(-60, 0, z), b = this.proj(60, 0, z); if (a && b) this.line(a[0], a[1], b[0], b[1], pal(sh + 200), 0.25); }
      for (let x = -60; x <= 60; x += 6) { const a = this.proj(x, 0, camZ + 1), b = this.proj(x, 0, camZ + 70); if (a && b) this.line(a[0], a[1], b[0], b[1], pal(sh + 200), 0.2); }
      // the towers, far to near
      const cell = 6, z0 = Math.floor(camZ / cell);
      const cols = [[-4, -3, -2, 2, 3, 4], [-5, -4, -3, -2, 2, 3, 4, 5]];
      for (let gz = z0 + 14; gz >= z0 + 1; gz--) {
        for (const gx of cols[gz & 1]) {
          const hgt = 3 + hash(gx, gz) * 16 + (hash(gx, gz) > 0.8 ? 8 : 0), bump = 1 + this.kick * 0.12 * hash(gz, gx);
          const x0 = gx * cell - 2, z = gz * cell, top = hgt * bump;
          const e = [CYAN, PINK, LIME, pal(sh + 90)][(hash(gz, gx * 3) * 4) | 0], near = clamp(1.3 - (z - camZ) / 80, 0.2, 1);
          this.box(x0, 0, z, x0 + 4, top, z + 4, [6, 4, 18], e, near * (0.55 + 0.4 * this.accent));
          // windows: rows of data, blinking at the step
          const f = this.proj(x0 + 2, top * 0.5, z);
          if (f && f[2] < 40) for (let wy = 1; wy < top - 0.5; wy += 1.4) for (let wx = 0.6; wx < 4; wx += 1.1) {
            if (hash(gx * 17 + ((wy * 7) | 0), gz * 13 + ((wx * 5) | 0) + (this.v.step | 0)) > 0.62) { const q = this.proj(x0 + wx, wy, z); if (q) this.set(q[0], q[1], e, 0.8); }
          }
        }
      }
      if (this.kick > 0.6) for (let x = 0; x < W; x += 2) this.add(x, H * 0.45, pal(sh + 120), this.kick * 0.5);   // (the horizon pulses)
    }

    // MAINFRAME: a rotating core (a sphere of wire, pulsing on the kick), rings of data packets orbiting it, every note
    // flying past as text, a grid floor
    mainframe() {
      const v = this.v, sh = this.slotShift();
      this.fade(0.35);
      this.cam(0, 2, -34, Math.sin(this.t * 0.2) * 0.2, -0.05, 140);
      for (let x = -40; x <= 40; x += 5) { const a = this.proj(x, -12, -10), b = this.proj(x, -12, 60); if (a && b) this.line(a[0], a[1], b[0], b[1], [0, 160, 60], 0.35); }
      for (let z = -10; z <= 60; z += 5) { const zz = z - ((this.scroll * 5) % 5); const a = this.proj(-40, -12, zz), b = this.proj(40, -12, zz); if (a && b) this.line(a[0], a[1], b[0], b[1], [0, 160, 60], 0.35); }
      // the core: a wire sphere turning, its radius beating
      const r = 9 + this.kick * 1.8 + (v.env || 0) * 1.5, ry = this.t * 0.6, rx = this.t * 0.37, cr = Math.cos(ry), sr = Math.sin(ry), cx2 = Math.cos(rx), sx2 = Math.sin(rx);
      const P = (u, w) => { let x = r * Math.cos(w) * Math.cos(u), y = r * Math.sin(w), z = r * Math.cos(w) * Math.sin(u); const x2 = x * cr - z * sr, z2 = x * sr + z * cr; const y2 = y * cx2 - z2 * sx2, z3 = y * sx2 + z2 * cx2; return this.proj(x2, y2 + 2, z3 + 6); };
      const col = pal(sh + 160 + this.t * 30);
      for (let i = 0; i < 12; i++) for (let j = -5; j <= 5; j++) {
        const u = (i / 12) * TAU, w = (j / 6) * (Math.PI / 2), u2 = ((i + 1) / 12) * TAU, w2 = ((j + 1) / 6) * (Math.PI / 2);
        const a = P(u, w), b = P(u2, w), c = j < 5 ? P(u, w2) : null;
        if (a && b) this.line(a[0], a[1], b[0], b[1], col, 0.7, true);
        if (a && c) this.line(a[0], a[1], c[0], c[1], col, 0.5);
      }
      // the rings: three tilted orbits, data packets running round them (faster with the hats)
      for (let k = 0; k < 3; k++) {
        const tilt = 0.5 + k * 0.7, rr = 16 + k * 5, spin = this.t * (0.5 + k * 0.3), ct = Math.cos(tilt), st = Math.sin(tilt);
        let prev = null;
        for (let i = 0; i <= 40; i++) {
          const a = (i / 40) * TAU, x = Math.cos(a) * rr, y0 = Math.sin(a) * rr, y = y0 * ct, z = y0 * st;
          const x2 = x * Math.cos(k) - z * Math.sin(k), z2 = x * Math.sin(k) + z * Math.cos(k), q = this.proj(x2, y + 2, z2 + 6);
          if (q && prev) this.line(prev[0], prev[1], q[0], q[1], [0, 200, 90], 0.3);
          prev = q;
        }
        for (let j = 0; j < 5; j++) {
          const a = spin * (1 + this.hat * 0.5) + (j / 5) * TAU, x = Math.cos(a) * rr, y0 = Math.sin(a) * rr;
          const x2 = x * Math.cos(k) - y0 * st * Math.sin(k), z2 = x * Math.sin(k) + y0 * st * Math.cos(k), q = this.proj(x2, y0 * ct + 2, z2 + 6);
          if (q) this.disc(q[0], q[1], 1.2 + 4 / q[2], j === 0 ? WHITE : [120, 255, 160], 0.9);
        }
      }
      // the notes and the hex flying at you
      for (const f of this.flyers) {
        f.z -= this.dt * (24 + this.kick * 30);
        const q = this.proj(f.x, f.y + 2, f.z);
        if (!q) continue;
        const k = clamp(Math.round(34 / q[2]), 1, 3), a = clamp((60 - f.z) / 20, 0, 1) * clamp((f.z + 18) / 20, 0, 1) * 0.85;
        for (let ci = 0; ci < f.s.length; ci++) {
          const g = F3[f.s[ci]] || F3[" "];
          for (let i = 0; i < 15; i++) if (g[i] === "1") this.rect(q[0] + (ci * 4 + (i % 3)) * k - f.s.length * 2 * k, q[1] + ((i / 3) | 0) * k, k, k, f.c, a);
        }
      }
      this.flyers = this.flyers.filter((f) => f.z > -30);
      if (this.flyers.length > 18) this.flyers.splice(0, this.flyers.length - 18);
    }

    // VOXEL: the app's icon as a solid voxel flower, turning and bouncing over a landscape of voxel columns: each row
    // a step of the music (the bass's level, the kick, the hats), the rows rolling towards you
    voxelScene() {
      const v = this.v, sh = this.slotShift(), B = this.buf;
      for (let y = 0; y < H; y++) { const t = y / H, c = pal(sh + 20 + t * 40); for (let x = 0; x < W; x++) { const i = (y * W + x) * 3; B[i] = c[0] * 0.18; B[i + 1] = c[1] * 0.12; B[i + 2] = c[2] * 0.3; } }
      const yaw = Math.sin(this.t * 0.25) * 0.5;
      this.cam(Math.sin(yaw) * -46, 16, -Math.cos(yaw) * 46 + 4, yaw, -0.32, 150);
      // the landscape: on each new step a new row from the sound
      if (v.step >= 0 && v.step !== this.tStep) {
        this.tStep = v.step;
        const w = v.wave || [], row = new Float32Array(16);
        for (let i = 0; i < 16; i++) row[i] = Math.abs(w[i * 4] || 0) * 9 + this.kick * 3 * (i > 5 && i < 10) + this.hat * 2 * hash(i, v.step) + 0.4;
        this.terrain.unshift(row); this.terrain.length = 12;
      }
      for (let r = this.terrain.length - 1; r >= 0; r--) for (let i = 0; i < 16; i++) {
        const h = Math.max(0.3, this.terrain[r][i]), x = (i - 8) * 3, z = 40 - r * 3 + ((this.scroll * 4) % 1) * 3;
        this.box(x, -10, z, x + 2.6, -10 + h, z + 2.6, pal(sh + 100 + h * 18), null);
      }
      // the flower: the icon's voxels, turned and bounced, drawn far to near
      const a = this.t * 0.9 + (v.env || 0) * 0.5, b = Math.sin(this.t * 0.7) * 0.35, ca = Math.cos(a), sa = Math.sin(a), cb = Math.cos(b), sb = Math.sin(b);
      const R = [ca, 0, sa, sa * sb, cb, -ca * sb, -sa * cb, sb, ca * cb], T = [0, 9 + this.kick * 3 + Math.sin(this.scroll * Math.PI) * 1.2, 2];
      const C = this.c3, sc = 1.15 + this.kick * 0.08;
      const vs = VOX.map((q) => { const x = q.x * sc, y = q.y * sc, z = q.z * sc; const wx = R[0] * x + R[1] * y + R[2] * z + T[0], wy = R[3] * x + R[4] * y + R[5] * z + T[1], wz = R[6] * x + R[7] * y + R[8] * z + T[2]; return { q, x, y, z, d: (wx - C.x) ** 2 + (wy - C.y) ** 2 + (wz - C.z) ** 2 }; });
      vs.sort((p1, p2) => p2.d - p1.d);
      for (const o of vs) this.voxel(o.x, o.y, o.z, sc * 1.02, R, T, this.accent > 0.4 && o.q.c === VCOL.Y ? WHITE : o.q.c);
    }

    // --------------------------------------------------------------------------------------------- a frame ---
    loop(now) {
      const dt = Math.min(0.1, this.tPrev ? (now - this.tPrev) / 1000 : 0.016);
      this.tPrev = now; this.dt = dt; this.t += dt;
      const playing = this.hooks.playing(), bpm = this.hooks.params().tempo;
      this.scroll += playing ? dt * (bpm / 60) : dt * 0.12;
      const d = (k) => Math.pow(k, dt);
      this.kick *= d(0.004); this.snare *= d(0.01); this.clap *= d(0.01); this.hat *= d(0.002); this.accent *= d(0.05);
      this.flash *= d(0.0015); this.shake *= d(0.0005); this.sceneLabel -= dt;
      if (!playing) { this.v = { ...this.v, cut: this.hooks.params().cutoff, reso: this.hooks.params().reso }; }
      [this.warehouse, this.cyberspace, this.tunnel, this.voxelScene, this.plasma, this.mainframe, this.garden, this.feedback][this.scene].call(this);
      if (HACKER[this.scene]) this.terminal();
      this.particles(dt);
      this.words(dt);
      this.hud(playing);
      this.post();
      requestAnimationFrame(this.loop);
    }
    particles(dt) {
      for (const p of this.parts) {
        p.life -= dt; p.x += p.vx * dt; p.y += p.vy * dt;
        if (p.k === 0) { p.vx += Math.sin(this.t * 4 + p.ph) * 30 * dt; p.vy = Math.min(p.vy + 20 * dt, 45); this.set(p.x, p.y, p.c); this.set(p.x, p.y + 1, p.c, Math.abs(Math.sin(this.t * 8 + p.ph))); }
        else if (p.k === 1) { p.vx *= 1 - 2 * dt; p.vy = p.vy * (1 - 2 * dt) + 60 * dt; this.add(p.x, p.y, p.c, Math.min(1, p.life * 2)); }
        else this.add(p.x, p.y, p.c, p.life * 3);
      }
      this.parts = this.parts.filter((p) => p.life > 0 && p.y < H + 4);
      if (this.parts.length > 600) this.parts.splice(0, this.parts.length - 600);
    }
    words(dt) {
      const w = this.word;
      if (!w || this.calm) { this.word = null; return; }
      w.life -= dt * 1.4;
      if (w.life <= 0) { this.word = null; return; }
      const k = 3, wd = w.s.length * 6 * k, x = ((W - wd) / 2) | 0, y = 20 + ((1 - w.life) * -6) | 0;
      if (Math.floor(w.life * 12) % 3 !== 0) this.text5(w.s, x, y, k, pal(this.t * 200 + this.slotShift()), true);
    }
    hud(playing) {
      const v = this.v, p = this.hooks.pattern(), B = this.buf;
      for (let y = 0; y < 8; y++) for (let x = 0; x < W; x++) { const i = (y * W + x) * 3; B[i] *= 0.35; B[i + 1] *= 0.35; B[i + 2] *= 0.35; }
      this.text3(Math.round(this.hooks.params().tempo) + " BPM", 2, 1, CYAN);
      this.text3("P" + ((this.hooks.slot() | 0) + 1), W - 10, 1, YEL);
      for (let s = 0; s < 16; s++) {
        const x = 64 + s * 7, on = p.bass[s].on, now = s === v.step, c = now ? YEL : on ? (p.bass[s].acc ? PINK : LIME) : [70, 50, 90];
        if (s < p.len) { this.rect(x, 2, 5, 2, c); if (now) this.rect(x, 4, 5, 1, c); }
      }
      if (this.fx) {                                     // the punch-ins held, named
        const names = FXNAME.filter((_, b) => (this.fx >> b) & 1).join(" + "), s = names.length > 58 ? names.slice(0, 58) : names;
        this.rect(W / 2 - s.length * 2 - 3, 11, s.length * 4 + 5, 9, INK, 0.75); this.text3(s, W / 2 - s.length * 2, 13, Math.floor(this.t * 8) % 2 ? YEL : WHITE);
      }
      if (this.sceneLabel > 0) { const s = SCENES[this.scene], a = Math.min(1, this.sceneLabel * 2); this.rect(W / 2 - s.length * 2 - 3, H - 12, s.length * 4 + 5, 9, INK, 0.7 * a); this.text3(s, W / 2 - s.length * 2, H - 10, YEL, a); }
      else if (!playing && Math.floor(this.t * 2) % 2 === 0) this.text3("PRESS PLAY", W / 2 - 20, H - 10, YEL);
      if (this.pad) {                                    // the rave mode's squelch pad: where the finger is
        const [px, py] = this.pad, x = px * W, y = py * H;
        this.line(x, 9, x, H - 1, LIME, 0.35); this.line(0, y, W - 1, y, LIME, 0.35);
        this.disc(x, y, 4, LIME, 0.9);
        this.text3("CUT " + Math.round(px * 100), 2, H - 16, LIME); this.text3("RES " + Math.round((1 - py) * 100), 2, H - 9, LIME);
      }
    }
    // the picture goes through what the sound goes through: REPEAT / ROLL freeze it and tear it in time; REVERSE turns
    // it negative; TAPE STOP darkens and sags it, then a CRT's power-off line; LOWPASS dims it blue, HIGHPASS bleaches
    // it; CRUSH makes big pixels in few colours; GATE blacks it out in time; ECHO leaves ghosts
    post() {
      const D = this.img.data, V = this.vig, fx = this.fx, calm = this.calm, t = this.t;
      const has = (b) => (fx >> b) & 1, held = (b) => (has(b) ? Math.min(1, (t - this.fxSince[b]) / 1.4) : 0);
      let B = this.buf;
      if (fx & 7) {                                      // a repeat: the frame from the press, torn at the repeat's rate
        if (!this.freeze) this.freeze = Float32Array.from(B);
        const div = has(2) ? 0.5 : has(1) ? 1 : 2, per = (60 / this.hooks.params().tempo / 4) * div, idx = Math.floor(t / per);
        if (idx !== this.repIdx) { this.repIdx = idx; for (let y = 0; y < H; y++) this.rowOff[y] = rnd() < 0.18 ? ((rnd() - 0.5) * 30) | 0 : 0; for (let y = 1; y < H; y++) if (this.rowOff[y - 1] && rnd() < 0.8) this.rowOff[y] = this.rowOff[y - 1]; }
        const live = 0.25;
        for (let i = 0; i < N * 3; i++) this.freeze[i] = this.freeze[i] * (1 - live * 0.1) + B[i] * live * 0.1;
        B = this.freeze;
      } else { this.rowOff.fill(0); this.repIdx = -1; }
      const sx = calm ? 0 : Math.round((rnd() - 0.5) * 3 * this.shake), sy = calm ? 0 : Math.round((rnd() - 0.5) * 3 * this.shake);
      const fr = !calm && this.accent > 0.3 ? 1 + (this.accent > 0.7 ? 1 : 0) : 0, fl = calm ? 0 : this.flash * 0.65;
      const inv = has(3) ? 0.9 : 0, tape = has(4) ? this.tape : 1, lp = held(5), hp = held(6), crush = has(7), echo = has(9);
      const gate = has(8) ? ((this.scroll * 4) % 1 < 0.5 ? 1 : (calm ? 0.35 : 0.04)) : 1;
      const sag = (1 - tape) * 14, blk = crush ? 4 : 1, L = this.lastOut;
      for (let y = 0; y < H; y++) {
        const scan = y & 1 ? 0.86 : 1, ys = crush ? y - (y % blk) : y;
        let yy = clamp(Math.round(ys - sy - sag * (y / H)), 0, H - 1);
        const ro = this.rowOff[y];
        for (let x = 0; x < W; x++) {
          const xs = crush ? x - (x % blk) : x, xx = clamp(xs - sx + ro, 0, W - 1), p = yy * W + xx, o = (y * W + x) * 4, q = (y * W + x) * 3;
          let r = B[(yy * W + clamp(xx + fr, 0, W - 1)) * 3], g = B[p * 3 + 1], b = B[(yy * W + clamp(xx - fr, 0, W - 1)) * 3 + 2];
          if (inv) { r += (255 - r * 1.1 - r) * inv; g += (255 - g * 1.1 - g) * inv; b += (255 - b * 1.1 - b) * inv; }
          if (tape < 1) { const m = (r + g + b) / 3; r = (r + (m - r) * (1 - tape)) * tape; g = (g + (m - g) * (1 - tape)) * tape; b = (b + (m - b) * (1 - tape)) * tape; }
          if (lp) { r *= 1 - lp * 0.6; g *= 1 - lp * 0.5; b = b * (1 - lp * 0.2) + 30 * lp; }
          if (hp) { r += (255 - r) * hp * 0.35; g += (255 - g) * hp * 0.45; b += (255 - b) * hp * 0.5; }
          if (crush) { r = Math.round(r / 85) * 85; g = Math.round(g / 85) * 85; b = Math.round(b / 85) * 85; }
          const v = V[y * W + x] * scan * gate;
          r = r * v + (255 - r * v) * fl; g = g * v + (255 - g * v) * fl; b = b * v + (255 - b * v) * fl;
          if (echo) { r = Math.max(r, L[q] * 0.82); g = Math.max(g, L[q + 1] * 0.82); b = Math.max(b, L[q + 2] * 0.82); }
          L[q] = r; L[q + 1] = g; L[q + 2] = b;
          D[o] = r; D[o + 1] = g; D[o + 2] = b; D[o + 3] = 255;
        }
      }
      if (tape < 0.2) {                                  // the tube switching off: a bright line, shrinking
        const w = Math.round(W * tape * 5), y = (H / 2) | 0;
        for (let x = (W - w) >> 1; x < (W + w) >> 1; x++) for (const yy of [y - 1, y, y + 1]) { const o = (yy * W + x) * 4; D[o] = D[o + 1] = D[o + 2] = 255; }
      }
      this.g.putImageData(this.img, 0, 0);
    }
  }
  globalThis.AcidRave = Rave;
  globalThis.AcidRave.SCENES = SCENES;
})();
