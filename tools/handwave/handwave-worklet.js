// SPDX-License-Identifier: GPL-3.0-only
// Handwave's sound: an AudioWorklet, ambient house and dub techno played with the hands. It plays by itself (a slow pad on
// the chord, a soft four-to-the-floor, chord stabs into a dub echo, a deep bass) and the hands shape it as it goes: the
// page sends the hands (each 0..1 across, up, and how near the camera) and the chord the right hand has moved to.
"use strict";
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
  stab: { a: 0.003, d: 0.22, s: 0.25, r: 0.16, fenv: 2.2 },  // (a dub techno chord stab)
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
    if (this.type === "saw" || this.type === "drift" || this.type === "stab") {   // three saws a little apart (the pad two, darker)
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


// ---- the instrument: ambient house, dub techno; always playing, the hands shaping it. Right hand: across the harmony
// (the page picks the chord and sends it), up and down the pitch and the brightness, nearer the swell (an arpeggio, in
// time, more of it the nearer). Left hand: across the groove (no beat at the left: the pad alone; then the kick, the
// hats, the bass, the shaker and the rim, a clap and a rolling bass at the right), up and down the space (the dub echo
// and the reverb), nearer the filter opening on it all. No hands: it plays on by itself.
class Handwave extends AudioWorkletProcessor {
  constructor() {
    super();
    this.P = { vol: 0.8, tempo: 120, swing: 0.53, reso: 0.15, bright: 0.5, attack: 0.3, release: 1.4 };
    this.on = false; this.fade = 0;
    // the hands, as sent (0..1 each; null: not seen) and as smoothed here (the left hand's settings stay where it left them)
    this.R = null; this.L = null;
    this.c = { pitch: 0.45, near: 0, rOn: 0, energy: 0.55, space: 0.5, drive: 0.35, mouth: 0, dance: 0, arms: 0 };
    this.F = null; this.Bd = null;                       // the face ({ mouth }) and the body ({ dance, arms }), when they're tracked
    this.harm = null;                                   // { notes, root, scale (pitch classes), key }
    this.padKey = null; this.pads = Array.from({ length: 12 }, () => new Voice());
    this.stabs = Array.from({ length: 12 }, () => new Voice()); this.mel = Array.from({ length: 10 }, () => new Voice());
    this.step = -1; this.spos = 0; this.stepLen = 1; this.bar = 0; this.stabPat = [3, 10]; this.arpI = 0;
    this.k = { t: 1e9, ph: 0, vel: 1 }; this.cl = { t: 1e9, bp: new SVF(), rim: false }; this.hh = { t: 1e9, dec: 0.04, lp: 0, acc: 1 };
    this.b = { on: false, env: 0, ph: 0, f: new SVF(), hz: 55, fe: 0, cnt: 0, gate: 0, t: 0 };
    this.pumpE = 0; this.kickSeen = 0; this.hatSeen = 0; this.bassSeen = 0; this.notesSeen = []; this.stabSeen = 0;
    this.mf = [new SVF(), new SVF()]; this.mfN = 0;     // the filter the left hand opens (on the drums, the bass, the stabs)
    this.lfo = 0;
    // the space: a ping-pong echo in time (a dotted eighth), a reverb (four combs and two allpasses a side)
    this.dl = [new Float32Array(SR * 2), new Float32Array(SR * 2)]; this.dw = 0; this.dlp = [0, 0];
    const sc = SR / 44100, mk = (n) => ({ b: new Float32Array(Math.round(n * sc)), i: 0, f: 0 });
    this.cb = [[1116, 1188, 1277, 1356].map(mk), [1139, 1211, 1300, 1379].map(mk)];
    this.ap = [[556, 441].map(mk), [579, 464].map(mk)];
    this.vizN = 0; this.lvl = 0;
    this.port.onmessage = (e) => this.onMessage(e.data);
  }

  onMessage(m) {
    if (m.type === "params") Object.assign(this.P, m.p);
    else if (m.type === "on") { this.on = !!m.on; if (this.on && this.step < 0) this.bar = 0; }
    else if (m.type === "hands") { this.R = m.r || null; this.L = m.l || null; this.F = m.f || null; this.Bd = m.b || null; }
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
    for (const n of ns) { const v = this.free(this.pads); v.start(n, 0.6, "drift", this.P, 0); v.pan = noise() * 0.5; }
  }
  bassNote(semis, gate) {
    const B = this.b, r = (((this.harm.root % 12) + 12) % 12);
    this.bassSeen++; B.on = true; B.hz = mtof(36 + r + (r > 6 ? -12 : 0) + semis); B.env = Math.max(B.env, 0.001); B.fe = 1; B.t = 0; B.gate = gate;
  }
  // a chord stab: the chord, close, short, into the echo
  stab(vel) {
    const ns = this.harm.notes.map((n) => { while (n > 67) n -= 12; while (n < 52) n += 12; return n; });
    for (const n of ns) { const v = this.free(this.stabs); v.start(n, vel, "stab", this.P, Math.round(this.stepLen * 0.7)); v.pan = noise() * 0.3; }
    this.stabSeen++;
  }
  // the arpeggio: the chord's notes, up from the right hand's height
  arp() {
    const h = this.harm, c = this.c, base = 52 + c.pitch * 28;
    const ns = []; for (let o = -12; o <= 24; o += 12) for (const n of h.notes) { const x = n + o; if (x >= base - 2 && x <= base + 14) ns.push(x); }
    if (!ns.length) return; ns.sort((a, b) => a - b);
    const n = ns[this.arpI++ % ns.length], v = this.free(this.mel);
    v.start(n, 0.35 + c.near * 0.5, c.pitch > 0.6 ? "pluck" : "keys", this.P, Math.round(this.stepLen * 0.8)); v.pan = noise() * 0.6;
    this.notesSeen.push(n);
  }
  // the clock: sixteenths, a little swing; on each, the drums, the bass, the stabs, the arpeggio
  tick(s) {
    const c = this.c, e = Math.max(c.energy, c.dance), h = this.harm;   // (dancing builds the groove too)
    if (s === 0) {                                      // a new bar: where the stabs fall, a little different now and then
      this.bar++;
      if (this.bar % 4 === 1 || !this.stabPat) { const opts = [[3, 10], [3, 6, 11], [2, 10], [3, 11, 14], [6, 14], [3, 7, 10, 14]]; this.stabPat = opts[Math.floor(Math.random() * opts.length)]; }
    }
    if (e >= 0.15 && s % 4 === 0) { this.k.t = 0; this.k.vel = e < 0.3 ? 0.55 : 1; this.pumpE = 1; this.kickSeen++; }
    if (e >= 0.85 && s === 14 && this.bar % 2 === 0) { this.k.t = 0; this.k.vel = 0.6; }
    if (e >= 0.35 && s % 4 === 2) { this.hatSeen++; this.hh.t = 0; this.hh.dec = 0.16; this.hh.acc = 0.9; }
    else if (e >= 0.65) { this.hatSeen++; this.hh.t = 0; this.hh.dec = 0.035; this.hh.acc = s % 2 ? 0.6 : 0.85; }
    if (e >= 0.65 && (s === 4 || s === 12)) { this.cl.t = 0; this.cl.rim = e < 0.8; }
    if (h && e >= 0.5) {
      if (s % 4 === 2) this.bassNote(0, Math.round(this.stepLen * 1.4));
      else if (e >= 0.8 && s % 4 === 3) this.bassNote(12, Math.round(this.stepLen * 0.6));
    }
    if (h && e >= 0.25 && this.stabPat.includes(s)) this.stab(0.55 + (e - 0.25) * 0.5);
    if (h && c.rOn > 0.5 && c.near > 0.15 && Math.random() < 0.15 + c.near * 0.85 && (c.near > 0.6 || s % 2 === 0)) this.arp();
  }

  process(_in, outs) {
    const out = outs[0], L = out[0], R = out[1] || out[0], n = L.length, P = this.P, c = this.c;
    // the hands, smoothed a little (a few hundredths of a second): the right hand's swell falls away slowly when it goes
    const k = 1 - Math.exp(-n / (SR * 0.07)), kz = 1 - Math.exp(-n / (SR * (this.R ? 0.06 : 1.2)));   // (quick: the hands are felt at once)
    const r = this.R, l = this.L;
    c.rOn += ((r ? 1 : 0) - c.rOn) * kz;
    if (r) { c.pitch += (r.y - c.pitch) * k; c.near += (r.z - c.near) * kz; } else c.near += (0 - c.near) * kz;
    if (l) { c.energy += (l.x - c.energy) * k; c.space += (l.y - c.space) * k; c.drive += (l.z - c.drive) * k; }
    // the face: an open mouth swells it and opens it up; the body: dancing builds the groove, arms wide the space
    const f = this.F, bd = this.Bd, ks = 1 - Math.exp(-n / (SR * 0.15)), kd = 1 - Math.exp(-n / (SR * 1.2));
    c.mouth += ((f ? f.mouth : 0) - c.mouth) * ks; c.dance += ((bd ? bd.dance : 0) - c.dance) * kd; c.arms += ((bd ? bd.arms : 0) - c.arms) * k;
    this.fade += ((this.on ? 1 : 0) - this.fade) * (1 - Math.exp(-n / (SR * (this.on ? 1.2 : 0.6))));
    const live = this.on && this.harm;
    if (live) this.padOn();
    else if (this.padKey) { for (const v of this.pads) v.release(); this.padKey = null; }
    const sixteenth = (60 / P.tempo / 4) * SR;
    // how it sounds now
    const swell = 0.45 + 0.55 * c.near + c.mouth * 0.4, space = Math.max(c.space, c.arms), drive = c.drive;
    this.lfo += n / SR * 0.07;
    const padCut = 220 * Math.pow(2, c.pitch * 3 + c.near * 0.8 + c.mouth * 1.4 + Math.sin(this.lfo * TAU) * 0.3);
    const stabCut = 300 * Math.pow(2, c.pitch * 1.5 + drive * 3.2 + c.mouth * 1.2);
    const dTime = Math.round(sixteenth * 3), fb = 0.3 + space * 0.42, dMix = 0.15 + space * 0.6, vMix = 0.1 + space * 0.55, cfb = 0.78 + space * 0.14;
    if ((this.mfN++ & 1) === 0) { const hz = 250 * Math.pow(2, drive * 6); this.mf[0].set(hz, 0.25 + drive * 0.35); this.mf[1].set(hz, 0.25 + drive * 0.35); }
    const B = this.b;
    let sumSq = 0;
    for (let i = 0; i < n; i++) {
      // the clock
      if (live) {
        if (this.step < 0 || this.spos >= this.stepLen) {
          this.spos = 0; this.step = (this.step + 1) % 16;
          const sw = this.step % 2 ? 1 - (P.swing - 0.5) * 2 : 1 + (P.swing - 0.5) * 2;
          this.stepLen = sixteenth * sw; this.tick(this.step);
        }
        this.spos++;
      } else if (this.fade < 0.01) this.step = -1;
      // the pump: the pad and the stabs breathe under the kick
      this.pumpE *= 0.99985; const duck = 1 - 0.55 * this.pumpE * Math.min(1, Math.max(c.energy, c.dance) * 3);
      // the pad
      let pl = 0, pr = 0;
      for (const v of this.pads) if (v.on) { const x = v.run(P, padCut) * 0.36; pl += x * (0.5 - v.pan); pr += x * (0.5 + v.pan); }
      pl *= duck * swell; pr *= duck * swell;
      // the stabs and the arpeggio
      let sl = 0, sr = 0, ml = 0, mr = 0;
      for (const v of this.stabs) if (v.on) { const x = v.run(P, stabCut) * 0.3; sl += x * (0.5 - v.pan); sr += x * (0.5 + v.pan); }
      for (const v of this.mel) if (v.on) { const x = v.run(P, 1800 + c.pitch * 2500) * 0.3 * swell; ml += x * (0.5 - v.pan); mr += x * (0.5 + v.pan); }
      sl *= 0.6 + 0.4 * duck; sr *= 0.6 + 0.4 * duck;
      // the bass: a saw and a sine, short notes on the offbeat
      let bs = 0;
      if (B.on) {
        if (B.t++ >= B.gate) B.env *= 0.9985; else B.env += (1 - B.env) * 0.02;
        if (B.env < 1e-4 && B.t > B.gate) B.on = false;
        if ((B.cnt++ & 31) === 0) { B.fe *= Math.pow(0.002, 32 / (0.14 * SR)); B.f.set(90 + 500 * drive + 700 * B.fe, 0.35); }
        B.ph += B.hz / SR; if (B.ph >= 1) B.ph -= 1;
        bs = (B.f.run(2 * B.ph - 1 - blep(B.ph, B.hz / SR)) * 0.5 + Math.sin(TAU * B.ph) * 0.6) * B.env * 0.5;
      }
      // the drums: a round kick, a rim or a soft clap, hats
      let dr = 0, hat = 0;
      const K = this.k;
      if (K.t < SR * 0.5) { const t = K.t / SR, f = 46 + 95 * Math.exp(-t * 32); K.ph += f / SR; dr += Math.sin(TAU * K.ph) * Math.exp(-t * 6.5) * 0.95 * K.vel + (K.t < 40 ? 0.1 * noise() : 0); K.t++; } else K.ph = 0;
      const C = this.cl;
      if (C.t < SR * 0.3) { const t = C.t / SR;
        if ((C.t & 15) === 0) C.bp.set(C.rim ? 1700 : 1000, C.rim ? 0.8 : 0.5);
        dr += C.bp.run(noise()) * (C.rim ? Math.exp(-t * 60) * 1.2 : (t < 0.03 ? Math.exp(-((t * 1000) % 10) / 2.5) * 0.6 : 0) + Math.exp(-t * 20) * 0.4); C.t++; }
      const Hh = this.hh;
      if (Hh.t < SR * 0.4) { const t = Hh.t / SR, x = noise(), hp = x - Hh.lp; Hh.lp += (x - Hh.lp) * 0.4; hat = hp * Math.min(1, Hh.t / 60) * Math.exp(-t / Hh.dec) * 0.2 * Hh.acc; Hh.t++; }
      // the left hand's filter, on the beat and the stabs
      const gl = this.mf[0].run((dr * 0.9 + bs) + sl), gr = this.mf[1].run((dr * 0.9 + bs) + sr);
      const fl = gl * 0.75 + (dr * 0.9 + bs) * 0.25 * drive, fr = gr * 0.75 + (dr * 0.9 + bs) * 0.25 * drive;   // (the kick's body still there when it's closed)
      const hx = hat * (0.45 + 0.55 * drive), al = pl + ml + fl + hx, ar = pr + mr + fr + hx;   // (the hats: only a little filtered)
      // the echo: ping-pong, darker each time round (the stabs most of all)
      const D = this.dl, w = this.dw, rd = (w - dTime + D[0].length) % D[0].length;
      const el = D[0][rd], er = D[1][rd];
      this.dlp[0] += (er - this.dlp[0]) * 0.25; this.dlp[1] += (el - this.dlp[1]) * 0.25;
      D[0][w] = (gl - (dr * 0.9 + bs) * 0.6 + ml * 0.8 + pl * 0.15) * dMix + this.dlp[0] * fb; D[1][w] = (gr - (dr * 0.9 + bs) * 0.6 + mr * 0.8 + pr * 0.15) * dMix + this.dlp[1] * fb;
      this.dw = (w + 1) % D[0].length;
      // the reverb
      let vl = 0, vr = 0;
      const inV = (pl + pr + ml + mr + sl + sr) * 0.5 * vMix + dr * 0.04 + (el + er) * 0.3 * vMix;
      for (let s = 0; s < 2; s++) {
        let acc = 0;
        for (const cc of this.cb[s]) { const y = cc.b[cc.i]; cc.f = y * 0.6 + cc.f * 0.4; cc.b[cc.i] = inV + cc.f * cfb; cc.i = (cc.i + 1) % cc.b.length; acc += y; }
        for (const a of this.ap[s]) { const y = a.b[a.i]; const x2 = acc + y * 0.5; a.b[a.i] = x2; acc = y - x2 * 0.5; a.i = (a.i + 1) % a.b.length; }
        if (s === 0) vl = acc; else vr = acc;
      }
      let ol = (al + el + vl * 0.45) * this.fade, or = (ar + er + vr * 0.45) * this.fade;
      ol = Math.tanh(ol * P.vol * 1.2) * 0.92; or = Math.tanh(or * P.vol * 1.2) * 0.92;
      L[i] = ol; R[i] = or; sumSq += ol * ol;
    }
    this.lvl = Math.sqrt(sumSq / n);
    if ((this.vizN++ & 3) === 0) {
      this.port.postMessage({ type: "viz", level: this.lvl, on: this.on, step: this.step, kick: this.kickSeen, stab: this.stabSeen, hats: this.hatSeen, bass: this.bassSeen, pitch: c.pitch, near: c.near, energy: Math.max(c.energy, c.dance), space, drive: c.drive, mouth: c.mouth, dance: c.dance,
        pad: this.pads.filter((v) => v.on && v.stage < 3).map((v) => v.note), notes: this.notesSeen });
      this.kickSeen = 0; this.stabSeen = 0; this.hatSeen = 0; this.bassSeen = 0; this.notesSeen = [];
    }
    return true;
  }
}
registerProcessor("handwave", Handwave);
