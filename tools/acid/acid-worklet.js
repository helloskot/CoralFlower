// SPDX-License-Identifier: GPL-3.0-only
// Acid Flower: the sound and the clock, in an AudioWorklet (acid.js is the touch surface; test_acid.mjs runs this file
// in node). One squelchy bass voice: a band-limited saw or square into a four-stage resonant ladder filter with a
// decaying filter envelope, accent (louder, a sharper and shorter sweep, and a charge that builds over accents in a
// row) and slide (the next note glides in without a new attack). Five drums made from scratch: kick, snare, clap,
// closed and open hat (the closed one chokes the open one). Drive, a tempo-locked delay, a soft limiter.
// The 16-step clock runs here, sample-accurate, with swing; the page sends the pattern, the knobs and play / stop,
// and gets the step, the filter's motion, the drums' hits and a scrap of the waveform back for its pixel display.
"use strict";

const TAU = 2 * Math.PI;
const tanh = (x) => {                                  // a fast tanh (accurate to ~1e-3, saturates cleanly)
  if (x > 4.97) return 1;
  if (x < -4.97) return -1;
  const x2 = x * x;
  return (x * (135135 + x2 * (17325 + x2 * (378 + x2)))) / (135135 + x2 * (62370 + x2 * (3150 + x2 * 28)));
};
const blep = (t, dt) => {                              // polyBLEP: the step of a saw or square, band-limited
  if (t < dt) { t /= dt; return t + t - t * t - 1; }
  if (t > 1 - dt) { t = (t - 1) / dt; return t * t + t + t + 1; }
  return 0;
};
const mtof = (n) => 440 * Math.pow(2, (n - 69) / 12);

class Biquad {                                         // RBJ cookbook, direct form 1
  constructor() { this.b0 = 1; this.b1 = this.b2 = this.a1 = this.a2 = 0; this.x1 = this.x2 = this.y1 = this.y2 = 0; }
  set(type, f, q, sr) {
    const w = (TAU * Math.min(f, sr * 0.45)) / sr, c = Math.cos(w), s = Math.sin(w), a = s / (2 * q);
    let b0, b1, b2;
    if (type === "lp") { b0 = (1 - c) / 2; b1 = 1 - c; b2 = b0; }
    else if (type === "hp") { b0 = (1 + c) / 2; b1 = -(1 + c); b2 = b0; }
    else { b0 = a; b1 = 0; b2 = -a; }                  // band-pass, 0 dB peak
    const a0 = 1 + a;
    this.b0 = b0 / a0; this.b1 = b1 / a0; this.b2 = b2 / a0; this.a1 = (-2 * c) / a0; this.a2 = (1 - a) / a0;
    return this;
  }
  run(x) {
    const y = this.b0 * x + this.b1 * this.x1 + this.b2 * this.x2 - this.a1 * this.y1 - this.a2 * this.y2;
    this.x2 = this.x1; this.x1 = x; this.y2 = this.y1; this.y1 = y;
    return y;
  }
}

const DEFAULT_PARAMS = { cutoff: 0.35, reso: 0.7, env: 0.55, decay: 0.45, accent: 0.6, drive: 0.25, delay: 0.2,
                         volume: 0.8, drums: 0.8, wave: 0, tempo: 124, swing: 0.54, tune: 0 };
const LANES = 5;                                       // kick, snare, clap, closed hat, open hat

class AcidFlower extends AudioWorkletProcessor {
  constructor() {
    super();
    const sr = (this.sr = sampleRate);
    this.p = { ...DEFAULT_PARAMS };
    this.sm = { cutoff: this.p.cutoff, reso: this.p.reso, env: this.p.env, drive: this.p.drive, delay: this.p.delay };
    this.pat = { len: 16, bass: Array.from({ length: 16 }, () => ({ on: false, note: 0, oct: 0, acc: false, slide: false })),
                 drums: Array.from({ length: LANES }, () => new Array(16).fill(false)) };
    this.next = null;                                  // a pattern waiting for the bar's end
    this.playing = false; this.step = -1; this.phase = 0; this.dur = 1;
    // the bass voice
    this.ph = 0; this.freq = 110; this.target = 110; this.gate = false; this.gateLeft = 0;
    this.amp = 0; this.fenv = 0; this.fdec = 0.999; this.accNow = 0; this.accCap = 0; this.slideLeft = 0;
    this.y1 = this.y2 = this.y3 = this.y4 = 0; this.dcx = 0; this.dcy = 0;
    // the drums
    this.k = { on: false, ph: 0, penv: 0, aenv: 0, click: 0 };
    this.sn = { aenv: 0, nenv: 0, ph1: 0, ph2: 0, hp: new Biquad().set("hp", 1200, 0.7, sr), bp: new Biquad().set("bp", 3000, 0.8, sr) };
    this.cl = { t: 1e9, env: 0, bp: new Biquad().set("bp", 1250, 1.6, sr), hp: new Biquad().set("hp", 700, 0.7, sr) };
    this.hh = { env: 0, dec: 0, ph: new Float64Array(6), bp: new Biquad().set("bp", 9500, 0.9, sr), hp: new Biquad().set("hp", 7200, 0.7, sr) };
    this.HH_F = [263, 400, 421, 531, 588, 832].map((f) => f * 1.55);
    this.noise = 22222;
    // the delay: dotted eighths, the repeats darker each time
    this.dl = new Float32Array(Math.ceil(sr * 2.2)); this.dw = 0; this.dlp = 0; this.dlr = new Float32Array(Math.ceil(sr * 2.2));
    this.dlpR = 0;
    // to the page
    this.wave = new Float32Array(64); this.wi = 0; this.wdiv = 0; this.lastPost = 0; this.t = 0;
    this.hits = 0;                                     // bits: the drums that hit since the last post
    this.accHit = false; this.noteHit = -1;
    this.port.onmessage = (e) => this.onMessage(e.data);
  }

  onMessage(m) {
    if (m.type === "params") Object.assign(this.p, m.params);
    else if (m.type === "pattern") {
      if (m.atBar && this.playing) this.next = m.pattern;
      else this.pat = m.pattern;
    } else if (m.type === "play") {
      if (!this.playing) { this.playing = true; this.step = -1; this.phase = 0; this.dur = 0; }
    } else if (m.type === "stop") {
      this.playing = false; this.gate = false;
      if (this.next) { this.pat = this.next; this.next = null; }
    } else if (m.type === "audition") {              // a step edited while stopped: heard once
      this.noteOn(m.note, !!m.acc, false);
      this.gateLeft = Math.round(this.sr * 0.18);
    } else if (m.type === "hit") this.drum(m.lane | 0, 1);
  }

  rnd() {                                              // white noise, -1..1 (xorshift)
    let x = this.noise;
    x ^= x << 13; x ^= x >>> 17; x ^= x << 5;
    this.noise = x | 0;
    return (x | 0) / 2147483648;
  }

  noteOn(note, acc, glide) {
    const f = mtof(note);
    this.target = f;
    if (glide && this.gate) {
      this.slideLeft = Math.round(this.sr * 0.05);     // ~50 ms into the new pitch, no new attack
    } else {
      this.freq = f;
      this.slideLeft = 0;
      this.fenv = 1;
    }
    this.accNow = acc ? this.p.accent : 0;
    if (acc) { this.accCap += (1 - this.accCap) * 0.55 * this.p.accent; this.fenv = 1; this.accHit = true; }
    // the filter envelope's decay: the knob, much shorter on an accent (the sharp "wow")
    const secs = acc ? 0.16 + 0.1 * (1 - this.p.accent) : 0.12 * Math.pow(25, this.p.decay);
    this.fdec = Math.exp(-1 / (secs * this.sr));
    this.gate = true;
    this.noteHit = note;
  }

  drum(lane, vel) {
    const sr = this.sr;
    if (lane === 0) { const k = this.k; k.on = true; k.ph = 0; k.penv = 1; k.aenv = vel; k.click = 1; }
    else if (lane === 1) { const s = this.sn; s.aenv = vel; s.nenv = vel; s.ph1 = s.ph2 = 0; }
    else if (lane === 2) { this.cl.t = 0; }
    else if (lane === 3) { this.hh.env = 0.75 * vel; this.hh.dec = Math.exp(-1 / (0.045 * sr)); }
    else if (lane === 4) { this.hh.env = 0.8 * vel; this.hh.dec = Math.exp(-1 / (0.38 * sr)); }
    this.hits |= 1 << lane;
  }

  tick() {                                             // a new step
    const len = Math.max(1, Math.min(16, this.pat.len | 0));
    let s = this.step + 1;
    if (s >= len) {
      s = 0;
      if (this.next) { this.pat = this.next; this.next = null; }
    }
    const prev = this.pat.bass[(this.step + len) % len] || {};
    this.step = s;
    const sps = (this.sr * 60) / Math.max(40, Math.min(220, this.p.tempo)) / 4;
    const sw = Math.max(0.5, Math.min(0.75, this.p.swing));
    this.dur = (s % 2 === 0 ? sw : 1 - sw) * 2 * sps;
    for (let l = 0; l < LANES; l++) if (this.pat.drums[l] && this.pat.drums[l][s]) this.drum(l, 1);
    const b = this.pat.bass[s];
    if (b && b.on) {
      const note = 36 + (this.p.tune | 0) + (b.note | 0) + 12 * (b.oct | 0);
      this.noteOn(note, !!b.acc, !!(prev.on && prev.slide));
      // the gate: half the step, or through to the next step when this one slides on
      this.gateLeft = b.slide ? Infinity : Math.round(this.dur * 0.55);
    } else {                                           // a rest: the note (slid into or not) ends
      this.gateLeft = 0;
      this.gate = false;
    }
  }

  process(inputs, outputs) {
    const out = outputs[0], L = out[0], R = out[1] || out[0], n = L.length, sr = this.sr, p = this.p, sm = this.sm;
    // the knobs move smoothly (no zipper noise)
    const a = 1 - Math.exp(-n / (0.03 * sr));
    sm.cutoff += (p.cutoff - sm.cutoff) * a; sm.reso += (p.reso - sm.reso) * a; sm.env += (p.env - sm.env) * a;
    sm.drive += (p.drive - sm.drive) * a; sm.delay += (p.delay - sm.delay) * a;
    const res = Math.min(0.97, sm.reso) * 4.15, comp = 1 + sm.reso * 1.1;
    const driveG = 1 + sm.drive * 9, driveN = 1 / tanh(driveG);
    const accDec = Math.exp(-1 / (0.28 * sr)), ampA = Math.exp(-1 / (0.002 * sr)), ampR = Math.exp(-1 / (0.012 * sr));
    const ampHold = Math.exp(-1 / (1.6 * sr));
    const glideK = 1 - Math.exp(-1 / (0.012 * sr));
    const sps = (sr * 60) / Math.max(40, Math.min(220, p.tempo)) / 4;
    const dlen = Math.min(this.dl.length - 1, Math.round(sps * 3));
    const kDec = Math.exp(-1 / (0.42 * sr)), kP = Math.exp(-1 / (0.028 * sr)), clickD = Math.exp(-1 / (0.0015 * sr));
    const snT = Math.exp(-1 / (0.11 * sr)), snN = Math.exp(-1 / (0.17 * sr));
    const vol = p.volume, dvol = p.drums * 0.9;
    for (let i = 0; i < n; i++) {
      // ---- the clock
      if (this.playing) {
        if (this.phase >= this.dur) { this.phase -= this.dur; this.tick(); }
        this.phase++;
      }
      // ---- the bass voice
      if (this.gateLeft !== Infinity && this.gateLeft > 0 && --this.gateLeft === 0) this.gate = false;
      if (this.slideLeft > 0) { this.freq += (this.target - this.freq) * glideK; this.slideLeft--; if (!this.slideLeft) this.freq = this.target; }
      const dt = this.freq / sr;
      this.ph += dt; if (this.ph >= 1) this.ph -= 1;
      let osc;
      if (p.wave === 1) {                              // square
        osc = this.ph < 0.5 ? 1 : -1;
        osc += blep(this.ph, dt);
        let t2 = this.ph + 0.5; if (t2 >= 1) t2 -= 1;
        osc -= blep(t2, dt);
      } else {
        osc = 2 * this.ph - 1 - blep(this.ph, dt);
      }
      this.amp = this.gate ? 1 - (1 - this.amp) * ampA : this.amp * ampR;
      if (this.gate) this.amp *= ampHold;
      this.fenv *= this.fdec;
      this.accCap *= accDec;
      // the cutoff: the knob, swept up by the envelope (more on an accent), plus the accents' building charge
      const oct = sm.cutoff * 8.2 + sm.env * 4.4 * this.fenv * (1 + this.accNow * 0.8) + this.accCap * 2.2 * p.accent;
      const fc = Math.min(sr * 0.38, 32 * Math.pow(2, oct));
      const g = 1 - Math.exp((-TAU * fc) / sr);
      const x = tanh(osc * 0.85 - res * this.y4);
      this.y1 += g * (x - tanh(this.y1));
      this.y2 += g * (tanh(this.y1) - tanh(this.y2));
      this.y3 += g * (tanh(this.y2) - tanh(this.y3));
      this.y4 += g * (tanh(this.y3) - tanh(this.y4));
      let bass = this.y4 * comp * this.amp * (0.5 + 0.7 * this.accNow);
      bass = tanh(bass * driveG) * driveN * (1 - sm.drive * 0.35);
      // (a gentle DC block)
      const dc = bass - this.dcx + 0.995 * this.dcy; this.dcx = bass; this.dcy = dc; bass = dc;
      // ---- the drums
      let drums = 0;
      const k = this.k;
      if (k.on) {
        const kf = 46 + 125 * k.penv * k.penv;
        k.ph += kf / sr; if (k.ph >= 1) k.ph -= 1;
        drums += Math.sin(TAU * k.ph) * k.aenv * 1.05 + this.rnd() * k.click * 0.25;
        k.penv *= kP; k.aenv *= kDec; k.click *= clickD;
        if (k.aenv < 1e-4) k.on = false;
      }
      const s = this.sn;
      if (s.aenv > 1e-4 || s.nenv > 1e-4) {
        s.ph1 += 182 / sr; s.ph2 += 331 / sr;
        const tone = (Math.sin(TAU * s.ph1) + 0.6 * Math.sin(TAU * s.ph2)) * s.aenv * 0.45;
        const nz = s.bp.run(s.hp.run(this.rnd())) * s.nenv * 1.1;
        drums += tone + nz;
        s.aenv *= snT; s.nenv *= snN;
      }
      const c = this.cl;
      if (c.t < sr * 0.4) {
        const ms = (c.t / sr) * 1000;
        let e;
        if (ms < 30) { const ph = ms % 10; e = Math.exp(-ph / 2.2); }     // three quick hand claps
        else e = 0.85 * Math.exp(-(ms - 30) / 70);                       // the room
        drums += c.bp.run(c.hp.run(this.rnd())) * e * 1.5;
        c.t++;
      }
      const h = this.hh;
      if (h.env > 1e-4) {
        let m = 0;
        for (let j = 0; j < 6; j++) { h.ph[j] += this.HH_F[j] / sr; if (h.ph[j] >= 1) h.ph[j] -= 1; m += h.ph[j] < 0.5 ? 1 : -1; }
        drums += h.hp.run(h.bp.run(m * 0.18 + this.rnd() * 0.25)) * h.env * 1.4;
        h.env *= h.dec;
      }
      // ---- the delay (the bass and the clap into it), ping-pong
      const send = bass * sm.delay;
      let rd = this.dw - dlen; if (rd < 0) rd += this.dl.length;
      const dLeft = this.dl[rd], dRight = this.dlr[rd];
      this.dlp += (dRight - this.dlp) * 0.35;          // the repeats a little darker each time
      this.dlpR += (dLeft - this.dlpR) * 0.35;
      this.dl[this.dw] = send + this.dlp * 0.48;
      this.dlr[this.dw] = this.dlpR * 0.48;
      this.dw = (this.dw + 1) % this.dl.length;
      const mix = bass * 0.95 + drums * dvol;
      L[i] = tanh((mix + dLeft * 0.8) * vol * 0.9);
      if (R !== L) R[i] = tanh((mix + dRight * 0.8) * vol * 0.9);
      // ---- a scrap of the waveform for the display
      if (++this.wdiv >= 4) { this.wdiv = 0; this.wave[this.wi] = bass; this.wi = (this.wi + 1) & 63; }
    }
    this.t += n;
    if (this.t - this.lastPost >= sr / 40) {
      this.lastPost = this.t;
      const w = new Float32Array(64);
      for (let j = 0; j < 64; j++) w[j] = this.wave[(this.wi + j) & 63];
      this.port.postMessage({ type: "viz", step: this.playing ? this.step : -1, playing: this.playing, env: this.fenv,
        acc: this.accCap, cut: sm.cutoff, reso: sm.reso, amp: this.amp, hits: this.hits, accHit: this.accHit,
        note: this.noteHit, wave: w }, [w.buffer]);
      this.hits = 0; this.accHit = false; this.noteHit = -1;
    }
    return true;
  }
}

registerProcessor("acid-flower", AcidFlower);
