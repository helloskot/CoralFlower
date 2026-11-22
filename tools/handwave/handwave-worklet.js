// SPDX-License-Identifier: GPL-3.0-only
// Handwave's sound: an AudioWorklet. Chords (a supersaw pad, a plucked string, a rave stab, electric keys), a bass that
// follows each chord's root, a drum groove, an arpeggiator and a strum, the chord memory played bar by bar, and the
// space round it all (an echo, a reverb, the pump of the kick). The page sends what to play; this keeps the time.
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

// ---- a chord voice: one note, in one of the four sounds
const SOUND = {                                        // (attack, decay, sustain, release in seconds; filter env octaves)
  saw: { a: 0.04, d: 0.5, s: 0.85, r: 0.6, fenv: 0.6 },
  pluck: { a: 0.002, d: 0.3, s: 1, r: 0.25, fenv: 0 },
  stab: { a: 0.002, d: 0.22, s: 0.18, r: 0.12, fenv: 4.2 },
  keys: { a: 0.003, d: 1.4, s: 0.35, r: 0.5, fenv: 0 },
};
class Voice {
  constructor() { this.on = false; this.f = new SVF(); this.ph = [0, 0, 0]; this.ks = new Float32Array(2400); }
  start(note, vel, type, P, gate) {
    this.on = true; this.note = note; this.vel = vel; this.type = type; this.hz = mtof(note); this.stage = 0; this.env = 0; this.t = 0;
    this.gate = gate || 0; this.held = !gate; this.fe = 1; this.pan = (noise() * 0.5); this.cnt = 0;
    const S = SOUND[type]; this.A = type === "saw" ? Math.max(0.003, P.attack) : S.a; this.R = type === "saw" ? Math.max(0.02, P.release) : S.r;
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
    else if (this.stage === 1) { this.env += (S.s - this.env) * (1 / (S.d * SR)) * 3; if (Math.abs(this.env - S.s) < 1e-3) this.stage = 2; }
    else if (this.stage === 3) { this.env *= Math.exp(-6.9 / (this.R * SR)); if (this.env < 1e-4) { this.on = false; return 0; } }
    this.t++;
    if (this.gate && this.t >= this.gate && this.stage < 3) this.stage = 3;
    if ((this.cnt++ & 15) === 0) {                      // (the filter moves every 16 samples)
      this.fe *= Math.pow(0.0015, 16 / (0.18 * SR));
      this.f.set(cutHz * Math.pow(2, S.fenv * this.fe * (0.4 + this.vel * 0.6)), P.reso);
    }
    let x = 0; const hz = this.hz;
    if (this.type === "saw") {                          // three saws a little apart
      for (let i = 0; i < 3; i++) {
        const dt = (hz * (i === 0 ? 1 : i === 1 ? 1.0052 : 0.9951)) / SR;
        let p = this.ph[i] + dt; if (p >= 1) p -= 1; this.ph[i] = p;
        x += (2 * p - 1 - blep(p, dt)) * 0.33;
      }
    } else if (this.type === "stab") {                  // a saw and a square, an octave and a fifth's worth of bite
      const dt = hz / SR; let p = this.ph[0] + dt; if (p >= 1) p -= 1; this.ph[0] = p;
      let q = this.ph[1] + dt * 2.003; if (q >= 1) q -= 1; this.ph[1] = q;
      const sq = (q < 0.5 ? 1 : -1) + blep(q, dt * 2.003) - blep((q + 0.5) % 1, dt * 2.003);
      x = (2 * p - 1 - blep(p, dt)) * 0.6 + sq * 0.3;
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

// ---- the drums: kick, clap (or snare), closed and open hats
const GROOVES = {
  house:    { k: "x...x...x...x...", c: "....x.......x...", h: "x.x.x.x.x.x.x.x.", o: "..x...x...x...x." },
  garage:   { k: "x......x..x.....", c: "....x.......x...", h: "xxx.xxx.xxx.xxx.", o: "......x.......x." },
  techno:   { k: "x...x...x...x...", c: "........x.......", h: "xxxxxxxxxxxxxxxx", o: "..x...x...x...x." },
  breaks:   { k: "x.....x...x.....", c: "....x.......x..x", h: "x.x.x.x.x.x.x.x.", o: "..............x." },
  halftime: { k: "x.........x.....", c: "........x.......", h: "x.x.x.x.x.x.x.x.", o: "......x........." },
};
const BASS = {                                          // (on which steps, how many semitones above the root)
  root:    [[0, 0], [4, 0], [8, 0], [12, 0]],
  offbeat: [[2, 0], [6, 0], [10, 0], [14, 0]],
  rolling: [[0, 0], [1, 0], [2, 12], [3, 0], [4, 0], [5, 0], [6, 12], [7, 0], [8, 0], [9, 0], [10, 12], [11, 0], [12, 0], [13, 0], [14, 12], [15, 0]],
  acid:    [[0, 0], [3, 12], [6, 0], [8, 0], [10, 7], [11, 12], [14, 0]],
};

class Handwave extends AudioWorkletProcessor {
  constructor() {
    super();
    this.P = { tempo: 122, swing: 0.54, sound: "saw", cutoff: 0.75, reso: 0.25, attack: 0.04, release: 0.6, bright: 0.6, arp: "off", arpRate: 16,
               strum: 0, bass: "off", drums: "off", pump: 0.4, delay: 0.25, verb: 0.3, vol: 0.8, chordVol: 0.8, bassVol: 0.8, drumVol: 0.8 };
    this.voices = Array.from({ length: 14 }, () => new Voice());
    this.held = null;                                   // the chord being held: { notes, root, vel }
    this.pend = [];                                     // notes still to come (a strum)
    this.playing = false; this.step = -1; this.bar = -1; this.spos = 0; this.stepLen = 1;
    this.arpPos = 0; this.arpI = 0; this.arpDir = 1;
    this.prog = { on: false, slots: [], i: -1 };
    // the bass: one voice
    this.b = { on: false, env: 0, ph: 0, sub: 0, f: new SVF(), hz: 55, fe: 0, cnt: 0, gate: 0, t: 0 };
    // the drums
    this.k = { t: 1e9, ph: 0 }; this.cl = { t: 1e9, hp: 0, bp: new SVF() }; this.hh = { t: 1e9, dec: 0.04, lp: 0 };
    this.pumpE = 0; this.kickN = 0;
    // the space: a ping-pong echo, a reverb (four combs and two allpasses a side)
    this.dl = [new Float32Array(SR * 2), new Float32Array(SR * 2)]; this.dw = 0; this.dlp = [0, 0];
    const sc = SR / 44100, mk = (n) => ({ b: new Float32Array(Math.round(n * sc)), i: 0, f: 0 });
    this.cb = [[1116, 1188, 1277, 1356].map(mk), [1139, 1211, 1300, 1379].map(mk)];
    this.ap = [[556, 441].map(mk), [579, 464].map(mk)];
    this.vizN = 0; this.lvl = 0; this.kickSeen = false;
    this.port.onmessage = (e) => this.onMessage(e.data);
  }

  onMessage(m) {
    if (m.type === "params") Object.assign(this.P, m.p);
    else if (m.type === "chord") this.chord(m.notes, m.root, m.vel == null ? 0.8 : m.vel, m.dir || 1);
    else if (m.type === "release") this.releaseChord();
    else if (m.type === "play") { this.playing = !!m.on; this.step = -1; this.spos = 0; this.bar = -1; this.prog.i = -1; if (!m.on) this.b.gate = 0; }
    else if (m.type === "prog") { this.prog.on = !!m.on; this.prog.slots = m.slots || []; if (!m.on && this.progChord) { this.progChord = false; this.releaseChord(); } }
  }

  // a chord: the last one let go, this one played (all at once, strummed, or left to the arpeggiator)
  chord(notes, root, vel, dir) {
    this.releaseVoices();
    this.held = { notes: notes.slice().sort((a, b) => a - b), root, vel };
    this.arpI = 0; this.arpDir = 1; this.arpPos = 0;
    if (this.P.arp === "off") {
      const ns = dir < 0 ? this.held.notes.slice().reverse() : this.held.notes, gap = this.P.strum * SR / Math.max(1, ns.length);
      this.pend = ns.map((n, i) => ({ n, at: Math.round(i * gap), vel: vel * (1 - i * 0.04) }));
      this.pendT = 0;
    } else this.pend = [];
    if (this.P.bass === "sub") this.bassNote(root, 0);
  }
  releaseVoices() { for (const v of this.voices) if (v.on && v.held) v.release(); this.pend = []; }
  releaseChord() { this.releaseVoices(); this.held = null; if (this.P.bass === "sub") this.b.gate = 0; }
  voice(note, vel, gate) {
    let v = this.voices.find((x) => !x.on);
    if (!v) { v = this.voices.reduce((a, b) => (a.env < b.env ? a : b)); }
    v.start(note, vel, this.P.sound, this.P, gate);
    return v;
  }
  // the bass: a note (root and an interval), a gate (samples; 0: held)
  bassNote(root, semis, gate) {
    const B = this.b, sub = this.P.bass === "sub";
    B.on = true; B.hz = mtof(36 + ((((root || 0) % 12) + 12) % 12) + semis - (sub ? 12 : 0)); B.env = Math.max(B.env, 0.001); B.fe = 1; B.t = 0;
    B.gate = gate || 1e12; B.atk = true;
  }

  // the clock: sixteenths with swing; on each, the drums, the bass, the chord memory
  tick(s) {
    const P = this.P, g = GROOVES[P.drums];
    if (s === 0) {
      this.bar++;
      if (this.prog.on && this.prog.slots.some(Boolean) && !(this.held && !this.progChord)) {   // (the chord memory: the next one each bar)
        const L = this.prog.slots.length; let i = this.prog.i;
        for (let k = 0; k < L; k++) { i = (i + 1) % L; if (this.prog.slots[i]) break; }
        this.prog.i = i; const c = this.prog.slots[i];
        this.chord(c.notes, c.root, 0.8, 1); this.progChord = true;
      }
    }
    if (g) {
      if (g.k[s] === "x") { this.k.t = 0; this.pumpE = 1; this.kickSeen = true; }
      if (g.c[s] === "x") this.cl.t = 0;
      if (g.o[s] === "x") { this.hh.t = 0; this.hh.dec = 0.22; } else if (g.h[s] === "x") { this.hh.t = 0; this.hh.dec = 0.035; this.hh.acc = s % 4 === 2 ? 1 : 0.6; }
    }
    const pat = BASS[P.bass];
    if (pat && this.held) for (const [st, semi] of pat) if (st === s) this.bassNote(this.held.root, semi, Math.round(this.stepLen * (P.bass === "root" ? 3 : 0.7)));
  }

  process(_in, outs) {
    const out = outs[0], L = out[0], R = out[1] || out[0], n = L.length, P = this.P;
    const sixteenth = (60 / P.tempo / 4) * SR;
    const cutHz = 80 * Math.pow(2, P.cutoff * 8);
    const arpPer = (60 / P.tempo / (P.arpRate === 8 ? 2 : P.arpRate === 32 ? 8 : P.arpRate === 24 ? 6 : 4)) * SR;
    const dTime = Math.round(sixteenth * 3), fb = 0.42, dMix = P.delay * 0.6, vMix = P.verb * 0.5;
    const B = this.b;
    let sumSq = 0;
    for (let i = 0; i < n; i++) {
      // the clock
      if (this.playing) {
        if (this.step < 0 || this.spos >= this.stepLen) {
          this.spos = 0; this.step = (this.step + 1) % 16;
          const sw = this.step % 2 ? 1 - (P.swing - 0.5) * 2 : 1 + (P.swing - 0.5) * 2;
          this.stepLen = sixteenth * sw;
          this.tick(this.step);
        }
        this.spos++;
      }
      // a strum's notes, as their moment comes
      if (this.pend.length) { this.pendT = (this.pendT || 0) + 1; while (this.pend.length && this.pend[0].at <= this.pendT) { const q = this.pend.shift(); this.voice(q.n, q.vel); } }
      // the arpeggiator: the held chord's notes in turn
      if (P.arp !== "off" && this.held) {
        if (this.arpPos <= 0) {
          const ns = this.held.notes.concat(this.held.notes.map((x) => x + 12)), m = ns.length;
          let k;
          if (P.arp === "up") k = this.arpI % m;
          else if (P.arp === "down") k = m - 1 - (this.arpI % m);
          else if (P.arp === "updown") { const c = Math.max(1, 2 * m - 2), j = this.arpI % c; k = j < m ? j : c - j; }
          else k = Math.floor(Math.abs(noise()) * m);
          this.voice(ns[k], this.held.vel * (this.arpI % 4 === 0 ? 1 : 0.75), Math.round(arpPer * 0.6));
          this.arpI++; this.arpPos = arpPer;
        }
        this.arpPos--;
      }
      // the chords
      let cl = 0, cr = 0;
      for (const v of this.voices) if (v.on) { const x = v.run(P, cutHz); cl += x * (0.5 - v.pan); cr += x * (0.5 + v.pan); }
      cl *= P.chordVol * 0.55; cr *= P.chordVol * 0.55;
      // the bass
      let bs = 0;
      if (B.on) {
        if (B.t++ >= B.gate) B.env *= Math.exp(-6.9 / (0.08 * SR)); else B.env += (1 - B.env) * 0.02;
        if (B.env < 1e-4 && B.t > B.gate) B.on = false;
        if ((B.cnt++ & 31) === 0) { B.fe *= Math.pow(0.002, 32 / (0.16 * SR)); B.f.set(120 + 1400 * P.cutoff * (P.bass === "acid" ? 1.6 : 0.7) + 2600 * B.fe * (P.bass === "acid" ? 1 : 0.4), P.bass === "acid" ? 0.8 : 0.35); }
        B.ph += B.hz / SR; if (B.ph >= 1) B.ph -= 1; B.sub += B.hz / 2 / SR; if (B.sub >= 1) B.sub -= 1;
        const saw = 2 * B.ph - 1 - blep(B.ph, B.hz / SR);
        bs = P.bass === "sub" ? Math.sin(TAU * B.ph) * 0.9 : B.f.run(saw) * 0.7 + Math.sin(TAU * B.sub) * 0.35;
        bs *= B.env * P.bassVol * 0.6;
      }
      // the drums
      let dr = 0;
      const K = this.k;
      if (K.t < SR * 0.6) { const t = K.t / SR, f = 46 + 120 * Math.exp(-t * 38); K.ph += f / SR; dr += Math.sin(TAU * K.ph) * Math.exp(-t * 7) * 0.95 + (K.t < 60 ? 0.3 * noise() : 0); K.t++; } else K.ph = 0;
      const C = this.cl;
      if (C.t < SR * 0.4) { const t = C.t / SR, burst = t < 0.03 ? Math.exp(-((t * 1000) % 10) / 2.5) : 0;   // (three quick slaps, then the tail)
        if ((C.t & 15) === 0) C.bp.set(1300, 0.6);
        dr += C.bp.run(noise()) * (burst * 0.9 + Math.exp(-t * 18) * 0.55) * 1.4; C.t++; }
      const Hh = this.hh;
      if (Hh.t < SR * 0.5) { const t = Hh.t / SR, x = noise(), hp = x - Hh.lp; Hh.lp += (x - Hh.lp) * 0.35; dr += hp * Math.exp(-t / Hh.dec) * 0.28 * (Hh.acc || 1); Hh.t++; }
      dr *= P.drumVol * 0.7;
      // the pump: the chords and the bass ducking under the kick
      this.pumpE *= Math.exp(-1 / (0.16 * SR));
      const duck = 1 - P.pump * 0.85 * this.pumpE * (P.drums !== "off" && this.playing ? 1 : 0);
      cl *= duck; cr *= duck; bs *= 0.5 + 0.5 * duck;
      // the echo: ping-pong, darker each time round
      const D = this.dl, w = this.dw, r = (w - dTime + D[0].length) % D[0].length;
      const el = D[0][r], er = D[1][r];
      this.dlp[0] += (er - this.dlp[0]) * 0.35; this.dlp[1] += (el - this.dlp[1]) * 0.35;
      D[0][w] = cl * dMix + this.dlp[0] * fb; D[1][w] = cr * dMix + this.dlp[1] * fb;
      this.dw = (w + 1) % D[0].length;
      // the reverb
      let vl = 0, vr = 0;
      const inV = (cl + cr) * 0.5 * vMix + dr * 0.05 * vMix + (el + er) * 0.2 * vMix;
      for (let s = 0; s < 2; s++) {
        let acc = 0;
        for (const c of this.cb[s]) { const y = c.b[c.i]; c.f = y * 0.7 + c.f * 0.3; c.b[c.i] = inV + c.f * 0.84; c.i = (c.i + 1) % c.b.length; acc += y; }
        for (const a of this.ap[s]) { const y = a.b[a.i]; const x2 = acc + y * 0.5; a.b[a.i] = x2; acc = y - x2 * 0.5; a.i = (a.i + 1) % a.b.length; }
        if (s === 0) vl = acc; else vr = acc;
      }
      let ol = cl + bs + dr + el + vl * 0.6, or = cr + bs + dr + er + vr * 0.6;
      ol = Math.tanh(ol * P.vol * 1.1) * 0.92; or = Math.tanh(or * P.vol * 1.1) * 0.92;
      L[i] = ol; R[i] = or; sumSq += ol * ol;
    }
    this.lvl = Math.sqrt(sumSq / n);
    if ((this.vizN++ & 3) === 0) {
      this.port.postMessage({ type: "viz", step: this.step, bar: this.bar, playing: this.playing, level: this.lvl, kick: this.kickSeen, prog: this.prog.on ? this.prog.i : -1,
        voices: this.voices.filter((v) => v.on && v.stage < 3).map((v) => v.note) });
      this.kickSeen = false;
    }
    return true;
  }
}
registerProcessor("handwave", Handwave);
