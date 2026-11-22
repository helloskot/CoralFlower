// SPDX-License-Identifier: GPL-3.0-only
// Handwave's sound: an AudioWorklet, generative ambient, played with the hands. It drifts by itself (a slow pad on the
// chord, a sub under it, bells, a texture: rain, the sea, wind, birds) and the hands shape it as it goes: the page sends
// the hands (each 0..1 across, up, and how near the camera) and the chord the right hand has moved to; this does the rest.
const SR = sampleRate, TAU = Math.PI * 2;
const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);
const blep = (t, dt) => { if (t < dt) { t /= dt; return t + t - t * t - 1; } if (t > 1 - dt) { t = (t - 1) / dt; return t * t + t + t + 1; } return 0; };
let seed = 22222;
const noise = () => { seed = (seed * 1664525 + 1013904223) | 0; return seed / 2147483648; };

// a state-variable filter (lowpass), its coefficients set now and then
class SVF {
  constructor() { this.ic1 = 0; this.ic2 = 0; this.set(1000, 0.2); }
  set(hz, res) { const g = Math.tan(Math.PI * Math.min(hz, SR * 0.45) / SR); this.k = 2 - 1.9 * res; this.a1 = 1 / (1 + g * (g + this.k)); this.a2 = g * this.a1; this.a3 = g * this.a2; }
  run(x) { const v3 = x - this.ic2, v1 = this.a1 * this.ic1 + this.a2 * v3, v2 = this.ic2 + this.a2 * this.ic1 + this.a3 * v3; this.ic1 = 2 * v1 - this.ic1; this.ic2 = 2 * v2 - this.ic2; return v2; }
}

// ---- a voice: one note (the pad, the melody, a bell)
const SOUND = {                                        // (attack, decay, sustain, release in seconds; filter env octaves)
  saw: { a: 0.04, d: 0.5, s: 0.85, r: 0.6, fenv: 0.6 },
  pluck: { a: 0.002, d: 0.3, s: 1, r: 0.25, fenv: 0 },
  organ: { a: 0.004, d: 0.18, s: 0.55, r: 0.18, fenv: 1.2 },
  keys: { a: 0.003, d: 1.4, s: 0.35, r: 0.5, fenv: 0 },
  bell: { a: 0.002, d: 1.8, s: 0, r: 1.2, fenv: 0 },     // (Drift's bells)
  drift: { a: 2.4, d: 1, s: 0.9, r: 4.5, fenv: 0 },      // (Drift's slow pad)
};
const BELL_K = Math.exp(-1 / (0.6 * SR));
class Voice {
  constructor() { this.on = false; this.f = new SVF(); this.ph = [0, 0, 0]; this.ks = new Float32Array(2400); }
  start(note, vel, type, P, gate) {
    this.on = true; this.note = note; this.vel = vel; this.type = type; this.hz = mtof(note); this.stage = 0; this.env = 0; this.t = 0;
    this.gate = gate || 0; this.held = !gate; this.fe = 1; this.pan = (noise() * 0.5); this.cnt = 0;
    const S = SOUND[type]; this.A = type === "saw" ? Math.max(0.12, P.attack) : S.a; this.R = type === "saw" ? Math.max(0.02, P.release) : S.r;
    for (let i = 0; i < 3; i++) this.ph[i] = Math.abs(noise());
    this.fm = 0; this.fm2 = 0;
    if (type === "pluck") {                              // Karplus-Strong: a burst of filtered noise in a loop the length of a period
      this.len = SR / this.hz; const n = Math.min(2399, Math.ceil(this.len) + 2); let lp = 0, b = 0.35 + P.bright * 0.6;
      for (let i = 0; i < n; i++) { lp += (noise() - lp) * b; this.ks[i] = lp; }
      this.kw = 0; this.klast = 0; this.kdec = Math.pow(10, -3 / (3.2 * this.hz)) ; this.kb = 0.5 + P.bright * 0.45;
    }
  }
  release() { if (this.on && this.stage < 3) this.stage = 3; }
  // one sample (mono) and its envelope; P: the shared params (cutoff, reso)
  run(P, cutHz) {
    const S = SOUND[this.type];
    // the envelope
    if (this.stage === 0) { this.env += 1 / (this.A * SR); if (this.env >= 1) { this.env = 1; this.stage = 1; } }
    else if (this.stage === 1) { this.env += (S.s - this.env) * (1 / (S.d * SR)) * 3; if (Math.abs(this.env - S.s) < 2e-3) this.stage = 2; }
    else if (this.stage === 3) { this.env *= Math.exp(-6.9 / (this.R * SR)); if (this.env < 1e-4) { this.on = false; return 0; } }
    else if (S.s === 0) { this.on = false; return 0; }   // (a bell, rung out)
    this.t++;
    if (this.gate && this.t >= this.gate && this.stage < 3) this.stage = 3;
    if (this.type === "bell") {                         // a bell: FM at an inharmonic ratio, its shimmer fading (no filter)
      const dt = this.hz / SR; this.bi = (this.bi == null || this.t === 1 ? 1.8 : this.bi * BELL_K); const idx = this.bi + 0.1;
      this.fm2 += dt * 3.5; if (this.fm2 >= 1) this.fm2 -= 1; this.fm += dt; if (this.fm >= 1) this.fm -= 1;
      return Math.sin(TAU * this.fm + idx * Math.sin(TAU * this.fm2)) * 0.6 * this.env * (0.35 + this.vel * 0.65);
    }
    if ((this.cnt++ & 15) === 0) {                      // (the filter moves every 16 samples)
      this.fe *= Math.pow(0.0015, 16 / (0.18 * SR));
      this.f.set(cutHz * Math.pow(2, S.fenv * this.fe * (0.4 + this.vel * 0.6)), P.reso);
    }
    let x = 0; const hz = this.hz;
    if (this.type === "saw" || this.type === "drift") {   // three saws a little apart (Drift's pad two, darker)
      for (let i = this.type === "drift" ? 1 : 0; i < 3; i++) {
        const dt = (hz * (i === 0 ? 1 : i === 1 ? 1.0052 : 0.9951)) / SR;
        let p = this.ph[i] + dt; if (p >= 1) p -= 1; this.ph[i] = p;
        x += (2 * p - 1 - blep(p, dt)) * 0.33;
      }
    } else if (this.type === "organ") {                 // a deep house organ: drawbars (the fundamental, the octave, the twelfth, two octaves), a click
      const dt = hz / SR; let p = this.ph[0] + dt; if (p >= 1) p -= 1; this.ph[0] = p;
      x = (Math.sin(TAU * p) + 0.7 * Math.sin(2 * TAU * p) + 0.45 * Math.sin(3 * TAU * p) + 0.25 * Math.sin(4 * TAU * p)) * 0.42 + (this.t < 90 ? noise() * 0.25 * (1 - this.t / 90) : 0);
    } else if (this.type === "pluck") {                 // the loop: averaged (darker each pass), a little lost each time
      const L = this.len, rp = this.kw - L; let i0 = Math.floor(rp), fr = rp - i0; const N = Math.ceil(L) + 2;
      const a = this.ks[((i0 % N) + N) % N], b = this.ks[(((i0 + 1) % N) + N) % N], out = a + (b - a) * fr;
      const nx = this.kdec * (this.kb * out + (1 - this.kb) * 0.5 * (out + this.klast));
      this.klast = out; this.ks[((this.kw % N) + N) % N] = nx; this.kw++;
      x = out * 1.6;
    } else {                                            // keys: two-operator FM, the bite fading
      const dt = hz / SR, idx = 2.2 * Math.exp(-this.t / (0.35 * SR)) + 0.25, tine = 0.6 * Math.exp(-this.t / (0.05 * SR));
      this.fm2 += dt * 14; if (this.fm2 >= 1) this.fm2 -= 1;
      this.fm += dt; if (this.fm >= 1) this.fm -= 1;
      x = Math.sin(TAU * this.fm + idx * Math.sin(TAU * this.fm) + tine * Math.sin(TAU * this.fm2)) * 0.8;
    }
    const y = this.type === "pluck" || this.type === "keys" ? this.f.run(x) * 0.5 + x * 0.5 : this.f.run(x);
    return y * this.env * (0.35 + this.vel * 0.65);
  }
}


// ---- the instrument: always drifting; the hands shape it. Right hand: x the harmony (the page picks the chord and
// sends it), y the pitch and the brightness, z (nearer the camera) the swell, and with it the melody and the bells.
// Left hand: x the texture (rain, the sea, wind, birds, crossfaded), y the space (dry to vast), z the weather (calm to a
// storm: wind, rain, a pad that shivers, thunder far off). No hands: it drifts on by itself, softly.
const TEX = ["rain", "ocean", "wind", "birds"];
class Handwave extends AudioWorkletProcessor {
  constructor() {
    super();
    this.P = { vol: 0.8, reso: 0.15, bright: 0.5, attack: 0.3, release: 1.4 };
    this.on = false; this.fade = 0;
    // the hands, as sent (0..1 each; null: not seen) and as smoothed here
    this.R = null; this.L = null;
    this.c = { pitch: 0.45, near: 0, rOn: 0, tex: 0.33, space: 0.6, storm: 0.15, lOn: 0 };
    this.harm = null;                                   // { notes, root, scale (pitch classes), key }
    this.padKey = null; this.pads = Array.from({ length: 16 }, () => new Voice());
    this.mel = Array.from({ length: 10 }, () => new Voice()); this.melT = SR; this.melNote = 64; this.bellT = SR * 2;
    this.sub = { ph: 0, hz: 55, g: 0 };
    this.tx = { lp: 0, lp2: 0, drop: 0, swell: 0, dlp: 0, wlp: 0, wlp2: 0, wph: 0, gust: 0, gustT: 0, chirpT: SR * 2, chirpN: 0, chirpLeft: 0, cph: 0, cf: 0, thunder: 0, tlp: 0, tlp2: 0 };
    this.lfo = 0; this.notesSeen = []; this.bellsSeen = [];
    // the space: a ping-pong echo, a reverb (four combs and two allpasses a side)
    this.dl = [new Float32Array(SR * 2), new Float32Array(SR * 2)]; this.dw = 0; this.dlp = [0, 0];
    const sc = SR / 44100, mk = (n) => ({ b: new Float32Array(Math.round(n * sc)), i: 0, f: 0 });
    this.cb = [[1116, 1188, 1277, 1356].map(mk), [1139, 1211, 1300, 1379].map(mk)];
    this.ap = [[556, 441].map(mk), [579, 464].map(mk)];
    this.vizN = 0; this.lvl = 0;
    this.port.onmessage = (e) => this.onMessage(e.data);
  }

  onMessage(m) {
    if (m.type === "params") Object.assign(this.P, m.p);
    else if (m.type === "on") this.on = !!m.on;
    else if (m.type === "hands") { this.R = m.r || null; this.L = m.l || null; }
    else if (m.type === "chord") this.harm = { notes: m.notes.slice().sort((a, b) => a - b), root: m.root, scale: m.scale || [0, 2, 3, 5, 7, 8, 10], key: m.key || 0 };
  }

  free(pool) {                                          // a free voice, or the one that will be missed least
    let best = null, bs = Infinity;
    for (const v of pool) { if (!v.on) return v; const s = v.env + (v.stage === 3 ? 0 : 1); if (s < bs) { bs = s; best = v; } }
    return best;
  }
  // the pad: the chord, low or high as the right hand is, slow in and slow out
  padOn() {
    const h = this.harm, oct = this.c.pitch < 0.3 ? -12 : this.c.pitch > 0.72 ? 12 : 0, key = h.notes.join(",") + ":" + oct;
    if (key === this.padKey) return;
    this.padKey = key;
    for (const v of this.pads) if (v.on) v.release();
    const ns = new Set(h.notes.map((n) => { n += oct; while (n > 76) n -= 12; while (n < 45) n += 12; return n; }));
    for (const n of ns) { const v = this.free(this.pads); v.start(n, 0.7, "drift", this.P, 0); v.pan = noise() * 0.5; }
    this.sub.hz = mtof(24 + (((h.root % 12) + 12) % 12) + (h.root % 12 > 6 ? 0 : 12));
  }
  // the melody: notes of the scale near the right hand's height, the chord's own notes more often
  melody(bell) {
    const h = this.harm, c = this.c;
    const target = bell ? 79 + Math.random() * 12 : 55 + c.pitch * 30;
    if (!bell) this.melNote += (target - this.melNote) * 0.5 + (Math.random() - 0.5) * 5;   // (the melody wanders; a bell is up high)
    const want = Math.round(bell ? target : this.melNote), pcs = Math.random() < 0.6 ? h.notes.map((n) => ((n % 12) + 12) % 12) : h.scale.map((s) => (s + h.key) % 12);
    let best = want, bd = 99;
    for (let n = want - 6; n <= want + 6; n++) if (pcs.includes(((n % 12) + 12) % 12) && Math.abs(n - want) < bd) { bd = Math.abs(n - want); best = n; }
    const v = this.free(this.mel); v.start(best, bell ? 0.3 + Math.random() * 0.3 : 0.35 + c.near * 0.45, bell ? "bell" : "keys", this.P, bell ? 0 : Math.round(SR * 0.45)); v.pan = noise() * 0.7;
    (bell ? this.bellsSeen : this.notesSeen).push(best);
  }

  process(_in, outs) {
    const out = outs[0], L = out[0], R = out[1] || out[0], n = L.length, P = this.P, c = this.c;
    // the hands, smoothed (about a third of a second): the right hand's swell falls away when it goes
    const k = 1 - Math.exp(-n / (SR * 0.3)), kz = 1 - Math.exp(-n / (SR * (this.R ? 0.25 : 1.6)));
    const r = this.R, l = this.L;
    c.rOn += ((r ? 1 : 0) - c.rOn) * kz; c.lOn += ((l ? 1 : 0) - c.lOn) * k;
    if (r) { c.pitch += (r.y - c.pitch) * k; c.near += (r.z - c.near) * kz; } else c.near += (0 - c.near) * kz;
    if (l) { c.tex += (l.x - c.tex) * k; c.space += (l.y - c.space) * k; c.storm += (l.z - c.storm) * k; }
    this.fade += ((this.on ? 1 : 0) - this.fade) * (1 - Math.exp(-n / (SR * (this.on ? 1.5 : 0.6))));
    const live = this.on && this.harm;
    if (live) this.padOn();
    else if (this.padKey) { for (const v of this.pads) v.release(); this.padKey = null; }
    // how it all sounds now
    const swell = 0.35 + 0.65 * c.near, storm = c.storm, space = c.space;
    this.lfo += n / SR * (0.09 + storm * 0.5);
    const padCut = 220 * Math.pow(2, c.pitch * 3.3 + c.near * 0.9 + Math.sin(this.lfo * TAU) * (0.25 + storm * 0.6));
    const shiver = storm * 0.35;
    const dTime = Math.round(SR * 0.62), fb = 0.35 + space * 0.3, dMix = space * 0.45, vMix = 0.12 + space * 0.7, cfb = 0.78 + space * 0.15;
    const tw = TEX.map((_, i) => Math.max(0, 1 - Math.abs(c.tex * 3 - i))), tLvl = (0.35 + storm * 0.9) * this.fade;
    const T = this.tx;
    // the melody and the bells: the right hand near, more notes; no hands, a bell now and then
    if (live) {
      this.melT -= n; this.bellT -= n;
      if (this.melT <= 0) { if (c.rOn > 0.5) this.melody(false); this.melT = Math.round(SR * (0.35 + Math.random() * 1.1) / (0.4 + c.near * 2.2)); }
      if (this.bellT <= 0) { this.melody(true); this.bellT = Math.round(SR * (1.5 + Math.random() * 5) / (0.3 + c.near * 2.5 + storm * 0.3)); }
    }
    if (storm > 0.72 && Math.random() < n / SR * (storm - 0.7) * 0.25) T.thunder = 1;
    const subG = live ? 0.16 * (0.4 + c.near * 0.6) : 0;
    let sumSq = 0;
    for (let i = 0; i < n; i++) {
      // the pad, breathing; it shivers in a storm
      let pl = 0, pr = 0;
      const trem = 1 - shiver * (0.5 + 0.5 * Math.sin((this.lfo * 37 + i / SR * 7) * TAU));
      for (const v of this.pads) if (v.on) { const x = v.run(P, padCut) * 0.42 * trem; pl += x * (0.5 - v.pan); pr += x * (0.5 + v.pan); }
      let ml = 0, mr = 0;
      for (const v of this.mel) if (v.on) { const x = v.run(P, 2600) * 0.32; ml += x * (0.5 - v.pan); mr += x * (0.5 + v.pan); }
      const S = this.sub; S.g += (subG - S.g) * 0.0005; S.ph += S.hz / SR; if (S.ph >= 1) S.ph -= 1;
      const sub = Math.sin(TAU * S.ph) * S.g;
      const al = (pl + ml) * swell + sub, ar = (pr + mr) * swell + sub;
      // the textures, crossfaded by the left hand
      let tx = 0; const x = noise();
      if (tw[0] > 0) {                                  // rain: a hush and drops, heavier in a storm
        T.lp += (x - T.lp) * 0.5; T.lp2 += (T.lp - T.lp2) * 0.05; if (Math.random() < 0.0015 + storm * 0.006) T.drop = 0.12 + Math.random() * 0.2; T.drop *= 0.992;
        tx += ((T.lp - T.lp2) * (0.06 + storm * 0.08) + noise() * T.drop * 0.3) * tw[0];
      }
      if (tw[1] > 0) {                                  // the sea: dark noise swelling and falling
        T.swell += 1 / (SR * (9 - storm * 4)); if (T.swell >= 1) T.swell -= 1; const w = Math.pow(0.5 - 0.5 * Math.cos(TAU * T.swell), 2);
        T.dlp += (x - T.dlp) * (0.01 + w * 0.06); tx += T.dlp * (0.1 + w * 0.6) * tw[1];
      }
      if (tw[2] > 0) {                                  // wind: a band of noise that sweeps, and gusts
        if (--T.gustT <= 0) { T.gustT = Math.round(SR * (1.5 + Math.random() * 4)); T.gustTo = 0.3 + Math.random() * (0.5 + storm); }
        T.gust += ((T.gustTo || 0.4) - T.gust) * 0.00004; T.wph += 1 / (SR * 7);
        const cf = 0.004 + 0.02 * (0.5 + 0.5 * Math.sin(TAU * T.wph)) * (0.5 + T.gust);
        T.wlp += (x - T.wlp) * cf * 4; T.wlp2 += (T.wlp - T.wlp2) * cf;
        tx += (T.wlp - T.wlp2) * T.gust * 1.6 * tw[2];
      }
      if (tw[3] > 0) {                                  // birds: a little air, a bird now and then
        T.cl = (T.cl || 0) + (x - (T.cl || 0)) * 0.05; let b = T.cl * 0.025;
        if (T.chirpLeft > 0) { const kk = 1 - T.chirpLeft / (SR * 0.09); T.cph += (T.cf * (1 + 0.5 * kk) + 300 * Math.sin(TAU * kk * 3)) / SR; b += Math.sin(TAU * T.cph) * Math.sin(Math.PI * kk) * 0.1; T.chirpLeft--; }
        else if (--T.chirpT <= 0) { T.chirpLeft = Math.round(SR * 0.09); T.cf = 2400 + Math.random() * 1600;
          if (T.chirpN > 0) { T.chirpN--; T.chirpT = Math.round(SR * 0.05); } else { T.chirpN = 1 + Math.floor(Math.random() * 3); T.chirpT = Math.round(SR * (2 + Math.random() * 6)); } }
        tx += b * tw[3];
      }
      if (T.thunder > 0.001) {                          // thunder, far off: a low rumble rolling away
        T.tlp += (noise() - T.tlp) * 0.02; T.tlp2 += (T.tlp - T.tlp2) * 0.02; tx += T.tlp2 * T.thunder * 2.2; T.thunder *= 0.99996;
      }
      tx *= tLvl;
      // the echo: ping-pong, darker each time round
      const D = this.dl, w = this.dw, rd = (w - dTime + D[0].length) % D[0].length;
      const el = D[0][rd], er = D[1][rd];
      this.dlp[0] += (er - this.dlp[0]) * 0.3; this.dlp[1] += (el - this.dlp[1]) * 0.3;
      D[0][w] = (ml * 1.2 + pl * 0.4) * dMix + this.dlp[0] * fb; D[1][w] = (mr * 1.2 + pr * 0.4) * dMix + this.dlp[1] * fb;
      this.dw = (w + 1) % D[0].length;
      // the reverb
      let vl = 0, vr = 0;
      const inV = (al + ar) * 0.5 * vMix + tx * 0.2 + (el + er) * 0.3 * vMix;
      for (let s = 0; s < 2; s++) {
        let acc = 0;
        for (const cc of this.cb[s]) { const y = cc.b[cc.i]; cc.f = y * 0.6 + cc.f * 0.4; cc.b[cc.i] = inV + cc.f * cfb; cc.i = (cc.i + 1) % cc.b.length; acc += y; }
        for (const a of this.ap[s]) { const y = a.b[a.i]; const x2 = acc + y * 0.5; a.b[a.i] = x2; acc = y - x2 * 0.5; a.i = (a.i + 1) % a.b.length; }
        if (s === 0) vl = acc; else vr = acc;
      }
      const dry = 1 - space * 0.35;
      let ol = (al * dry + el + vl * 0.5) * this.fade + tx, or = (ar * dry + er + vr * 0.5) * this.fade + tx;
      ol = Math.tanh(ol * P.vol * 1.2) * 0.92; or = Math.tanh(or * P.vol * 1.2) * 0.92;
      L[i] = ol; R[i] = or; sumSq += ol * ol;
    }
    this.lvl = Math.sqrt(sumSq / n);
    if ((this.vizN++ & 3) === 0) {
      this.port.postMessage({ type: "viz", level: this.lvl, on: this.on, pitch: c.pitch, near: c.near, tex: c.tex, space: c.space, storm: c.storm, thunder: T.thunder,
        pad: this.pads.filter((v) => v.on && v.stage < 3).map((v) => v.note), notes: this.notesSeen, bells: this.bellsSeen });
      this.notesSeen = []; this.bellsSeen = [];
    }
    return true;
  }
}
registerProcessor("handwave", Handwave);
