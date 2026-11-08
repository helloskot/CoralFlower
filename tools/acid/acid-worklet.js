// SPDX-License-Identifier: GPL-3.0-only
// Acid Flower: the sound and the clock, in an AudioWorklet (acid.js is the touch surface; test_acid.mjs runs this file
// in node). Two squelchy voices, the bass and the lead (an octave up, its own wave, a brighter filter): each a
// band-limited saw or square into a four-stage resonant ladder filter with a decaying filter envelope, accent (louder,
// a sharper and shorter sweep, and a charge that builds over accents in a row) and slide (the next note glides in
// without a new attack). Eight drums made from scratch: kick, snare, clap, closed and open hat (the closed one chokes
// the open one), tom, rim and cowbell, each with its own tune, decay and level. Drive, a tempo-locked delay, a room
// reverb, a pump (the kick ducking the voices), a soft limiter.
// The clock runs here, sample-accurate, with swing: up to 32 steps, each track (the bass, the lead, every drum) with
// its own length, so they can drift against each other; a step can play by chance and repeat (a ratchet); knob moves
// recorded into the pattern (its motion) play back with it. The page sends the pattern, the knobs, play / stop and
// live notes (a MIDI keyboard), and gets the step, the filter's motion, the drums' hits and a scrap of the waveform
// back for its pixel display.
// Punch-in effects, held from the page (a bit mask, FX below), work on the whole mix: the last 4 s of it are kept,
// so REPEAT 1/8, 1/16 and ROLL 1/32 loop from the last 16th's start, REVERSE plays backwards from the touch, TAPE STOP
// slows to a halt; LOWPASS and HIGHPASS sweep while held and snap back; CRUSH, a tempo-synced GATE, an ECHO throw
// (its tail rings on after the release), and BASS OUT / DRUMS OUT for the drops.
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
                         volume: 0.8, drums: 0.8, wave: 0, tempo: 124, swing: 0.54, tune: 0,
                         verb: 0, pump: 0, lead: 0.6, leadWave: 1, dk: null };
const LANES = 8;                                       // kick, snare, clap, closed hat, open hat, tom, rim, cowbell
const MAXS = 32;
const MOTION = ["cutoff", "reso", "env", "decay", "accent", "drive", "delay"];
const clampI = (v, a, b, d) => { v = v | 0; return v < a ? (d != null && !v ? d : a) : v > b ? b : v; };

// one voice: the oscillator, the ladder, the envelopes (the bass and the lead are two of these)
class Voice {
  constructor(sr) {
    this.sr = sr;
    this.ph = 0; this.freq = 110; this.target = 110; this.gate = false; this.gateLeft = 0;
    this.amp = 0; this.fenv = 0; this.fdec = 0.999; this.accNow = 0; this.accCap = 0; this.slideLeft = 0;
    this.y1 = this.y2 = this.y3 = this.y4 = 0; this.dcx = 0; this.dcy = 0;
    this.accHit = false; this.noteHit = -1; this.live = -1;
  }
  noteOn(note, acc, glide, p) {
    const f = mtof(note);
    this.target = f;
    if (glide && this.gate) {
      this.slideLeft = Math.round(this.sr * 0.05);     // ~50 ms into the new pitch, no new attack
    } else {
      this.freq = f;
      this.slideLeft = 0;
      this.fenv = 1;
    }
    this.accNow = acc ? p.accent : 0;
    if (acc) { this.accCap += (1 - this.accCap) * 0.55 * p.accent; this.fenv = 1; this.accHit = true; }
    // the filter envelope's decay: the knob, much shorter on an accent (the sharp "wow")
    const secs = acc ? 0.16 + 0.1 * (1 - p.accent) : 0.12 * Math.pow(25, p.decay);
    this.fdec = Math.exp(-1 / (secs * this.sr));
    this.gate = true;
    this.noteHit = note;
  }
  // one sample; K: this block's constants
  run(K, wave, cutOff) {
    if (this.gateLeft !== Infinity && this.gateLeft > 0 && --this.gateLeft === 0) this.gate = false;
    if (this.slideLeft > 0) { this.freq += (this.target - this.freq) * K.glideK; this.slideLeft--; if (!this.slideLeft) this.freq = this.target; }
    const sr = this.sr, dt = this.freq / sr;
    this.ph += dt; if (this.ph >= 1) this.ph -= 1;
    let osc;
    if (wave === 1) {                                  // square
      osc = this.ph < 0.5 ? 1 : -1;
      osc += blep(this.ph, dt);
      let t2 = this.ph + 0.5; if (t2 >= 1) t2 -= 1;
      osc -= blep(t2, dt);
    } else {
      osc = 2 * this.ph - 1 - blep(this.ph, dt);
    }
    if (!this.gate && this.amp < 1e-5 && Math.abs(this.y4) < 1e-5) { this.amp = 0; return 0; }   // (silent: skip the filter)
    this.amp = this.gate ? 1 - (1 - this.amp) * K.ampA : this.amp * K.ampR;
    if (this.gate) this.amp *= K.ampHold;
    this.fenv *= this.fdec;
    this.accCap *= K.accDec;
    // the cutoff: the knob, swept up by the envelope (more on an accent), plus the accents' building charge
    const oct = (K.cutoff + cutOff) * 8.2 + K.env * 4.4 * this.fenv * (1 + this.accNow * 0.8) + this.accCap * 2.2 * K.accent;
    const fc = Math.min(sr * 0.38, 32 * Math.pow(2, oct));
    const g = 1 - Math.exp((-TAU * fc) / sr);
    const x = tanh(osc * 0.85 - K.res * this.y4);
    this.y1 += g * (x - tanh(this.y1));
    this.y2 += g * (tanh(this.y1) - tanh(this.y2));
    this.y3 += g * (tanh(this.y2) - tanh(this.y3));
    this.y4 += g * (tanh(this.y3) - tanh(this.y4));
    let v = this.y4 * K.comp * this.amp * (0.5 + 0.7 * this.accNow);
    v = tanh(v * K.driveG) * K.driveN * K.driveC;
    const dc = v - this.dcx + 0.995 * this.dcy; this.dcx = v; this.dcy = dc;   // (a gentle DC block)
    return dc;
  }
}

// the room: a small Schroeder / Freeverb reverb (four combs, two all-passes a side)
class Verb {
  constructor(sr) {
    const k = sr / 44100, mk = (n) => ({ b: new Float32Array(Math.round(n * k)), i: 0, f: 0 });
    this.cL = [1116, 1188, 1277, 1356].map(mk); this.cR = [1139, 1211, 1300, 1379].map(mk);
    this.aL = [556, 441].map(mk); this.aR = [579, 464].map(mk);
  }
  side(x, C, A) {
    let o = 0;
    for (const c of C) { const y = c.b[c.i]; c.f = y * 0.72 + c.f * 0.28; c.b[c.i] = x + c.f * 0.9; if (++c.i >= c.b.length) c.i = 0; o += y; }
    o *= 0.25;
    for (const a of A) { const y = a.b[a.i]; a.b[a.i] = o + y * 0.5; if (++a.i >= a.b.length) a.i = 0; o = y - o * 0.5; }
    return o;
  }
}
const FX = { REP8: 0, REP16: 1, ROLL: 2, REV: 3, TAPE: 4, LP: 5, HP: 6, CRUSH: 7, GATE: 8, ECHO: 9, BASSOUT: 10, DRUMSOUT: 11 };
const on = (mask, b) => (mask >> b) & 1;
class SVF {                                            // a state-variable filter (Chamberlin, 2x over), for the sweeps
  constructor() { this.lp = 0; this.bp = 0; }
  run(x, f, q, hp) {
    let out = 0;
    for (let k = 0; k < 2; k++) {
      this.lp += f * this.bp;
      const h = x - this.lp - q * this.bp;
      this.bp += f * h;
      out = hp ? h : this.lp;
    }
    return out;
  }
}

class AcidFlower extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const opt = (options && options.processorOptions) || null;   // (an export, rendered offline: everything up front)
    const sr = (this.sr = sampleRate);
    this.p = { ...DEFAULT_PARAMS };
    this.sm = { cutoff: this.p.cutoff, reso: this.p.reso, env: this.p.env, drive: this.p.drive, delay: this.p.delay, verb: 0, pump: 0, lead: this.p.lead };
    this.pat = { len: 16, bass: Array.from({ length: 16 }, () => ({ on: false, note: 0, oct: 0, acc: false, slide: false })),
                 drums: Array.from({ length: LANES }, () => new Array(16).fill(false)) };
    this.next = null;                                  // a pattern waiting for the bar's end
    this.playing = false; this.step = -1; this.abs = -1; this.phase = 0; this.dur = 1; this.clock = 0;
    this.evs = [];                                     // the ratchets' repeats to come: { t, f }
    // the voices
    this.bass = new Voice(sr); this.lead = new Voice(sr);
    // the drums
    this.k = { on: false, ph: 0, penv: 0, aenv: 0, click: 0 };
    this.sn = { aenv: 0, nenv: 0, ph1: 0, ph2: 0, hp: new Biquad().set("hp", 1200, 0.7, sr), bp: new Biquad().set("bp", 3000, 0.8, sr) };
    this.cl = { t: 1e9, env: 0, bp: new Biquad().set("bp", 1250, 1.6, sr), hp: new Biquad().set("hp", 700, 0.7, sr) };
    this.hh = { env: 0, dec: 0, ph: new Float64Array(6), bp: new Biquad().set("bp", 9500, 0.9, sr), hp: new Biquad().set("hp", 7200, 0.7, sr) };
    this.HH_F = [263, 400, 421, 531, 588, 832].map((f) => f * 1.55);
    this.tm = { ph: 0, penv: 0, aenv: 0 };
    this.rim = { aenv: 0, ph: 0, bp: new Biquad().set("bp", 1700, 3, sr) };
    this.cb = { aenv: 0, p1: 0, p2: 0, bp: new Biquad().set("bp", 2600, 1.2, sr) };
    this.dkG = new Float32Array(LANES).fill(1);        // each drum's level, at its last hit
    this.noise = 22222;
    // the delay: dotted eighths, the repeats darker each time
    this.dl = new Float32Array(Math.ceil(sr * 2.2)); this.dw = 0; this.dlp = 0; this.dlr = new Float32Array(Math.ceil(sr * 2.2));
    this.dlpR = 0;
    this.verb = new Verb(sr); this.pumpE = 0;
    // to the page
    this.wave = new Float32Array(64); this.wi = 0; this.wdiv = 0; this.lastPost = 0; this.t = 0;
    this.hits = 0;                                     // bits: the drums that hit since the last post
    // the punch-ins: the mix's last 4 s, what is held, and each effect's state
    this.HN = Math.ceil(sr * 4); this.hl = new Float32Array(this.HN); this.hr = new Float32Array(this.HN); this.hw = 0;
    this.stepAt = 0; this.fx = 0;
    this.play = null;                                  // buffer playback: { mode: "rep" | "rev" | "tape", ... }
    this.xf = 0;                                       // 0 live .. 1 the buffer's playback
    this.lpC = 1; this.hpC = 0;                        // the sweeps' positions, 0..1
    this.svf = [new SVF(), new SVF(), new SVF(), new SVF()];
    this.crushN = 0; this.crushL = 0; this.crushR = 0; this.gateG = 1;
    this.eL = new Float32Array(Math.ceil(sr * 2.2)); this.eR = new Float32Array(Math.ceil(sr * 2.2)); this.ew = 0; this.eIn = 0;
    this.bassG = 1; this.drumsG = 1;
    // an export: the knobs, a queue of patterns ([{ pattern, reps }], played in order, then the tails ring out) and,
    // for a stem, what to leave out (the parts still run, so chance comes out the same in every stem)
    this.mute = { bass: 0, lead: 0, drums: 0 }; this.queue = null; this.qi = 0; this.qLoops = 0;
    if (opt) {
      if (opt.params) Object.assign(this.p, opt.params);
      if (opt.mute) for (const k of ["bass", "lead", "drums"]) this.mute[k] = opt.mute[k] ? 1 : 0;
      if (opt.queue && opt.queue.length) { this.queue = opt.queue; this.pat = opt.queue[0].pattern; }
      else if (opt.pattern) this.pat = opt.pattern;
      if (opt.play) { this.playing = true; this.step = -1; this.abs = -1; this.phase = 0; this.dur = 0; }
    }
    this.port.onmessage = (e) => this.onMessage(e.data);
  }

  onMessage(m) {
    if (m.type === "params") Object.assign(this.p, m.params);
    else if (m.type === "pattern") {
      if (m.atBar && this.playing) this.next = m.pattern;
      else this.pat = m.pattern;
    } else if (m.type === "play") {
      if (!this.playing) { this.playing = true; this.step = -1; this.abs = -1; this.phase = 0; this.dur = 0; this.evs.length = 0; }
    } else if (m.type === "stop") {
      this.playing = false; this.bass.gate = false; this.lead.gate = false; this.evs.length = 0;
      if (this.next) { this.pat = this.next; this.next = null; }
    } else if (m.type === "audition") {              // a step edited while stopped: heard once
      const v = m.voice === "lead" ? this.lead : this.bass;
      v.noteOn(m.note, !!m.acc, false, this.p);
      v.gateLeft = Math.round(this.sr * 0.18);
    } else if (m.type === "live") {                  // a key held (a MIDI keyboard): sounds until it is let go
      const v = m.voice === "bass" ? this.bass : this.lead;
      if (m.on) { v.noteOn(m.note, !!m.acc, v.live >= 0, this.p); v.gateLeft = Infinity; v.live = m.note; }
      else if (v.live === m.note) { v.gate = false; v.gateLeft = 0; v.live = -1; }
    } else if (m.type === "hit") this.drum(m.lane | 0, 1);
    else if (m.type === "fx") this.setFx(m.mask | 0);
  }

  rnd() {                                              // white noise, -1..1 (xorshift)
    let x = this.noise;
    x ^= x << 13; x ^= x >>> 17; x ^= x << 5;
    this.noise = x | 0;
    return (x | 0) / 2147483648;
  }
  chance() { return (this.rnd() + 1) * 50; }           // 0..100

  // a drum's own knobs: tune (semitones, -12..12), decay (0..1, 0.5 as made), level (0..1, 0.8 as made)
  dk(lane) { const d = this.p.dk && this.p.dk[lane]; return d || null; }
  drum(lane, vel) {
    const sr = this.sr, d = this.dk(lane);
    const tune = d ? Math.pow(2, (d[0] || 0) / 12) : 1, dec = d ? Math.pow(2, ((d[1] == null ? 0.5 : d[1]) - 0.5) * 2.4) : 1;
    this.dkG[lane] = d ? (d[2] == null ? 0.8 : d[2]) / 0.8 : 1;
    if (!this.dkT) this.dkT = new Float32Array(LANES).fill(1);
    this.dkT[lane] = tune;
    if (!this.dkD) this.dkD = new Float32Array(LANES).fill(1);
    this.dkD[lane] = dec;
    if (lane === 0) { const k = this.k; k.on = true; k.ph = 0; k.penv = 1; k.aenv = vel; k.click = 1; this.pumpE = 1; }
    else if (lane === 1) { const s = this.sn; s.aenv = vel; s.nenv = vel; s.ph1 = s.ph2 = 0; }
    else if (lane === 2) { this.cl.t = 0; }
    else if (lane === 3) { this.hh.env = 0.75 * vel; this.hh.dec = Math.exp(-1 / (0.045 * dec * sr)); this.hhL = 3; }
    else if (lane === 4) { this.hh.env = 0.8 * vel; this.hh.dec = Math.exp(-1 / (0.38 * dec * sr)); this.hhL = 4; }
    else if (lane === 5) { const t = this.tm; t.ph = 0; t.penv = 1; t.aenv = vel; }
    else if (lane === 6) { const r = this.rim; r.aenv = vel; r.ph = 0; }
    else if (lane === 7) { const c = this.cb; c.aenv = vel; }
    this.hits |= 1 << lane;
  }

  // the punch-ins held change: start a loop, a reverse or a tape stop from here; the rest follow the mask by themselves
  setFx(mask) {
    const was = this.fx;
    this.fx = mask;
    const sps = (this.sr * 60) / Math.max(40, Math.min(220, this.p.tempo)) / 4, HN = this.HN;
    const div = on(mask, FX.ROLL) ? 0.5 : on(mask, FX.REP16) ? 1 : on(mask, FX.REP8) ? 2 : 0;
    if (on(mask, FX.TAPE)) {
      if (!on(was, FX.TAPE)) this.play = { mode: "tape", pos: (this.hw - 1 + HN) % HN, rate: 1 };
    } else if (on(mask, FX.REV)) {
      if (!on(was, FX.REV) || (this.play && this.play.mode !== "rev")) this.play = { mode: "rev", pos: (this.hw - 1 + HN) % HN };
    } else if (div) {
      const len = Math.max(64, Math.round(sps * div));
      if (!this.play || this.play.mode !== "rep" || this.play.len !== len) {
        // loop from the last 16th's start (playing), or the last loop's length (stopped); the first pass is live
        const start = this.playing ? this.stepAt : (this.hw - len + HN) % HN;
        const k = this.playing ? (this.hw - start + HN) % HN : 0;
        this.play = { mode: "rep", start, len, k };
      }
    } else this.play = null;
  }

  // a voice's step: by chance, ratcheted (repeated within the step), gliding from a slide before it
  voiceStep(v, steps, pos, prevPos, base, dur) {
    if (v.live >= 0) return;                           // (a held key wins)
    const b = steps && steps[pos], prev = (steps && steps[prevPos]) || {};
    if (b && b.on && (b.prob == null || b.prob >= 100 || this.chance() < b.prob)) {
      const note = base + (this.p.tune | 0) + (b.note | 0) + 12 * (b.oct | 0), rat = clampI(b.rat, 1, 4, 1);
      v.noteOn(note, !!b.acc, !!(prev.on && prev.slide), this.p);
      // the gate: half the step, or through to the next step when this one slides on
      v.gateLeft = b.slide && rat === 1 ? Infinity : Math.round((dur / rat) * 0.55);
      for (let r = 1; r < rat; r++) this.evs.push({ t: this.clock + Math.round((dur * r) / rat), f: () => { v.noteOn(note, !!b.acc, false, this.p); v.gateLeft = Math.round((dur / rat) * 0.55); } });
    } else {                                           // a rest: the note (slid into or not) ends
      v.gateLeft = 0;
      v.gate = false;
    }
  }

  tick() {                                             // a new step
    const P = this.pat, len = clampI(P.len, 1, MAXS, 16);
    let s = this.step + 1;
    this.abs++;
    if (s >= len) {
      s = 0;
      if (this.next) { this.pat = this.next; this.next = null; this.abs = 0; }
      if (this.queue && ++this.qLoops >= Math.max(1, this.queue[this.qi].reps | 0)) {   // (an export's next pattern, or the end)
        this.qLoops = 0; this.qi++;
        if (this.qi >= this.queue.length) { this.playing = false; this.bass.gate = false; this.lead.gate = false; this.queue = null; this.step = -1; return; }
        this.pat = this.queue[this.qi].pattern; this.abs = 0;
      }
    }
    const pat = this.pat, L = clampI(pat.len, 1, MAXS, 16), prevS = (s - 1 + L) % L;
    this.step = s;
    this.stepAt = this.hw;                             // (where this step's sound goes in the punch-ins' history)
    const sps = (this.sr * 60) / Math.max(40, Math.min(220, this.p.tempo)) / 4;
    const sw = Math.max(0.5, Math.min(0.75, this.p.swing));
    this.dur = (s % 2 === 0 ? sw : 1 - sw) * 2 * sps;
    const a = this.abs;
    // the motion: knob moves recorded into the pattern, at this step
    const mo = pat.motion;
    if (mo) for (const k of MOTION) { const lane = mo[k]; if (lane && lane[s] != null) this.p[k] = lane[s]; }
    // the drums: each on its own length; by chance; ratcheted
    for (let l = 0; l < LANES; l++) {
      const row = pat.drums[l];
      if (!row) continue;
      const dl = clampI(pat.dlen && pat.dlen[l], 1, MAXS, L), pos = a % dl;
      if (!row[pos]) continue;
      const pr = pat.dp && pat.dp[l] ? pat.dp[l][pos] : 100;
      if (pr != null && pr < 100 && this.chance() >= pr) continue;
      this.drum(l, 1);
      const rat = clampI(pat.dr && pat.dr[l] ? pat.dr[l][pos] : 1, 1, 4, 1);
      for (let r = 1; r < rat; r++) this.evs.push({ t: this.clock + Math.round((this.dur * r) / rat), f: () => this.drum(l, 0.75) });
    }
    this.voiceStep(this.bass, pat.bass, s, prevS, 36, this.dur);
    if (pat.lead) {
      const ll = clampI(pat.llen, 1, MAXS, L), lp = a % ll;
      this.voiceStep(this.lead, pat.lead, lp, (lp - 1 + ll) % ll, 48, this.dur);
    }
    if (this.evs.length > 1) this.evs.sort((x, y) => x.t - y.t);
  }

  process(inputs, outputs) {
    const out = outputs[0], L = out[0], R = out[1] || out[0], n = L.length, sr = this.sr, p = this.p, sm = this.sm;
    // the knobs move smoothly (no zipper noise)
    const a = 1 - Math.exp(-n / (0.03 * sr));
    sm.cutoff += (p.cutoff - sm.cutoff) * a; sm.reso += (p.reso - sm.reso) * a; sm.env += (p.env - sm.env) * a;
    sm.drive += (p.drive - sm.drive) * a; sm.delay += (p.delay - sm.delay) * a;
    sm.verb += ((p.verb || 0) - sm.verb) * a; sm.pump += ((p.pump || 0) - sm.pump) * a; sm.lead += ((p.lead == null ? 0.6 : p.lead) - sm.lead) * a;
    const driveG = 1 + sm.drive * 9;
    const K = { res: Math.min(0.97, sm.reso) * 4.15, comp: 1 + sm.reso * 1.1, driveG, driveN: 1 / tanh(driveG), driveC: 1 - sm.drive * 0.35,
                accDec: Math.exp(-1 / (0.28 * sr)), ampA: Math.exp(-1 / (0.002 * sr)), ampR: Math.exp(-1 / (0.012 * sr)),
                ampHold: Math.exp(-1 / (1.6 * sr)), glideK: 1 - Math.exp(-1 / (0.012 * sr)), cutoff: sm.cutoff, env: sm.env, accent: p.accent };
    const sps = (sr * 60) / Math.max(40, Math.min(220, p.tempo)) / 4;
    const dlen = Math.min(this.dl.length - 1, Math.round(sps * 3));
    const D = this.dkD || [1, 1, 1, 1, 1, 1, 1, 1], T = this.dkT || [1, 1, 1, 1, 1, 1, 1, 1], G = this.dkG;
    const kDec = Math.exp(-1 / (0.42 * D[0] * sr)), kP = Math.exp(-1 / (0.028 * sr)), clickD = Math.exp(-1 / (0.0015 * sr));
    const snT = Math.exp(-1 / (0.11 * D[1] * sr)), snN = Math.exp(-1 / (0.17 * D[1] * sr));
    const tmA = Math.exp(-1 / (0.3 * D[5] * sr)), tmP = Math.exp(-1 / (0.06 * sr));
    const rimA = Math.exp(-1 / (0.018 * D[6] * sr)), cbA = Math.exp(-1 / (0.16 * D[7] * sr));
    const vol = p.volume, dvol = p.drums * 0.9, leadW = p.leadWave == null ? 1 : p.leadWave;
    const pumpK = Math.exp(-1 / (sps * 2.2)), verbOn = sm.verb > 0.002;
    // the punch-ins' constants for this block
    const fx = this.fx, HN = this.HN, P = this.play, xfK = 1 - Math.exp(-1 / (0.004 * sr));
    const lpOn = on(fx, FX.LP), hpOn = on(fx, FX.HP), crush = on(fx, FX.CRUSH), gateOn = on(fx, FX.GATE), echoOn = on(fx, FX.ECHO);
    const lpK = lpOn ? Math.exp(-1 / (1.4 * sr)) : Math.exp(-1 / (0.06 * sr)), hpK = hpOn ? Math.exp(-1 / (1.4 * sr)) : Math.exp(-1 / (0.06 * sr));
    const tapeDec = 1 / (0.75 * sr), muteK = 1 - Math.exp(-1 / (0.006 * sr));
    const bassT = on(fx, FX.BASSOUT) ? 0 : 1, drumsT = on(fx, FX.DRUMSOUT) ? 0 : 1;
    const elen = Math.min(this.eL.length - 1, Math.round(sps * 3)), echoFb = echoOn ? 0.72 : 0.55;
    for (let i = 0; i < n; i++) {
      // ---- the clock
      if (this.playing) {
        if (this.phase >= this.dur) { this.phase -= this.dur; this.tick(); }
        this.phase++;
      }
      this.clock++;
      while (this.evs.length && this.evs[0].t <= this.clock) this.evs.shift().f();   // (the ratchets' repeats)
      this.bassG += (bassT - this.bassG) * muteK; this.drumsG += (drumsT - this.drumsG) * muteK;
      // ---- the voices, ducked by the kick (the pump)
      this.pumpE *= pumpK;
      const duck = 1 - sm.pump * 0.85 * this.pumpE;
      const bass = this.bass.run(K, p.wave, 0) * duck * (1 - this.mute.bass);
      const lead = this.lead.run(K, leadW, 0.12) * duck * sm.lead * 0.8 * (1 - this.mute.lead);
      // ---- the drums
      let drums = 0;
      const k = this.k;
      if (k.on) {
        const kf = (46 + 125 * k.penv * k.penv) * T[0];
        k.ph += kf / sr; if (k.ph >= 1) k.ph -= 1;
        drums += (Math.sin(TAU * k.ph) * k.aenv * 1.05 + this.rnd() * k.click * 0.25) * G[0];
        k.penv *= kP; k.aenv *= kDec; k.click *= clickD;
        if (k.aenv < 1e-4) k.on = false;
      }
      const s = this.sn;
      if (s.aenv > 1e-4 || s.nenv > 1e-4) {
        s.ph1 += (182 * T[1]) / sr; s.ph2 += (331 * T[1]) / sr;
        const tone = (Math.sin(TAU * s.ph1) + 0.6 * Math.sin(TAU * s.ph2)) * s.aenv * 0.45;
        const nz = s.bp.run(s.hp.run(this.rnd())) * s.nenv * 1.1;
        drums += (tone + nz) * G[1];
        s.aenv *= snT; s.nenv *= snN;
      }
      const c = this.cl;
      if (c.t < sr * 0.4 * D[2]) {
        const ms = (c.t / sr) * 1000 * T[2];
        let e;
        if (ms < 30) { const ph = ms % 10; e = Math.exp(-ph / 2.2); }     // three quick hand claps
        else e = 0.85 * Math.exp(-(ms - 30) / (70 * D[2]));             // the room
        drums += c.bp.run(c.hp.run(this.rnd())) * e * 1.5 * G[2];
        c.t++;
      }
      const h = this.hh;
      if (h.env > 1e-4) {
        let m = 0;
        const ht = T[this.hhL || 3];
        for (let j = 0; j < 6; j++) { h.ph[j] += (this.HH_F[j] * ht) / sr; if (h.ph[j] >= 1) h.ph[j] -= 1; m += h.ph[j] < 0.5 ? 1 : -1; }
        drums += h.hp.run(h.bp.run(m * 0.18 + this.rnd() * 0.25)) * h.env * 1.4 * G[this.hhL || 3];
        h.env *= h.dec;
      }
      const tm = this.tm;
      if (tm.aenv > 1e-4) {                            // the tom: a sine falling from 2.2 x its pitch
        tm.ph += ((110 + 130 * tm.penv) * T[5]) / sr; if (tm.ph >= 1) tm.ph -= 1;
        drums += Math.sin(TAU * tm.ph) * tm.aenv * 0.8 * G[5];
        tm.penv *= tmP; tm.aenv *= tmA;
      }
      const ri = this.rim;
      if (ri.aenv > 1e-4) {                            // the rim: a knock and a click, short
        ri.ph += (1720 * T[6]) / sr; if (ri.ph >= 1) ri.ph -= 1;
        drums += ri.bp.run((ri.ph < 0.5 ? 1 : -1) * 0.6 + this.rnd() * 0.5) * ri.aenv * 1.3 * G[6];
        ri.aenv *= rimA;
      }
      const cb = this.cb;
      if (cb.aenv > 1e-4) {                            // the cowbell: two squares a fifth-ish apart, band-passed
        cb.p1 += (540 * T[7]) / sr; if (cb.p1 >= 1) cb.p1 -= 1;
        cb.p2 += (800 * T[7]) / sr; if (cb.p2 >= 1) cb.p2 -= 1;
        drums += cb.bp.run(((cb.p1 < 0.5 ? 1 : -1) + (cb.p2 < 0.5 ? 1 : -1)) * 0.5) * cb.aenv * 0.9 * G[7];
        cb.aenv *= cbA;
      }
      // ---- the delay (the voices into it), ping-pong
      const send = (bass + lead * 0.8) * sm.delay * this.bassG;   // (BASS OUT: nothing more into the delay; its repeats ring out)
      let rd = this.dw - dlen; if (rd < 0) rd += this.dl.length;
      const dLeft = this.dl[rd], dRight = this.dlr[rd];
      this.dlp += (dRight - this.dlp) * 0.35;          // the repeats a little darker each time
      this.dlpR += (dLeft - this.dlpR) * 0.35;
      this.dl[this.dw] = send + this.dlp * 0.48;
      this.dlr[this.dw] = this.dlpR * 0.48;
      this.dw = (this.dw + 1) % this.dl.length;
      const voices = (bass * 0.95 + lead) * this.bassG, dr = drums * dvol * this.drumsG * (1 - this.mute.drums);
      let oL = voices + dr + dLeft * 0.8, oR = voices + dr + dRight * 0.8;
      if (verbOn) {                                    // the room: the voices and a little of the drums
        const vin = (voices * 0.7 + dr * 0.5) * sm.verb * 0.5;
        oL += this.verb.side(vin, this.verb.cL, this.verb.aL) * 3.2; oR += this.verb.side(vin, this.verb.cR, this.verb.aR) * 3.2;
      }
      // ---- the punch-ins: the mix into its history; a loop, a reverse or a tape stop played from it
      this.hl[this.hw] = oL; this.hr[this.hw] = oR;
      let bL = 0, bR = 0;
      if (P) {
        if (P.mode === "rep") {
          const j = P.k % P.len, idx = (P.start + j) % HN, w = Math.min(1, j / 48, (P.len - j) / 48);
          bL = this.hl[idx] * w; bR = this.hr[idx] * w; P.k++;
        } else if (P.mode === "rev") {
          bL = this.hl[P.pos]; bR = this.hr[P.pos]; P.pos = (P.pos - 1 + HN) % HN;
        } else {                                       // the tape: slowing to a stop, read between samples
          const i0 = Math.floor(P.pos), f = P.pos - i0, i1 = (i0 + 1) % HN, e = Math.min(1, P.rate * 1.5);
          bL = (this.hl[i0] + (this.hl[i1] - this.hl[i0]) * f) * e; bR = (this.hr[i0] + (this.hr[i1] - this.hr[i0]) * f) * e;
          P.pos += P.rate; if (P.pos >= HN) P.pos -= HN;
          P.rate = Math.max(0, P.rate - tapeDec);
        }
      }
      this.hw = (this.hw + 1) % HN;
      this.xf += ((P ? 1 : 0) - this.xf) * xfK;
      oL += (bL - oL) * this.xf; oR += (bR - oR) * this.xf;
      // the sweeps: a lowpass closing, a highpass opening, while held; back when let go
      this.lpC = lpOn ? 0.02 + (this.lpC - 0.02) * lpK : 1 - (1 - this.lpC) * lpK;
      this.hpC = hpOn ? 0.75 - (0.75 - this.hpC) * hpK : this.hpC * lpK;
      if (this.lpC < 0.995) {
        const f = Math.min(0.9, 2 * Math.sin((Math.PI * 30 * Math.pow(600, this.lpC)) / (2 * sr)));
        oL = this.svf[0].run(oL, f, 0.55, false); oR = this.svf[1].run(oR, f, 0.55, false);
      }
      if (this.hpC > 0.005) {
        const f = Math.min(0.9, 2 * Math.sin((Math.PI * 20 * Math.pow(400, this.hpC)) / (2 * sr)));
        oL = this.svf[2].run(oL, f, 0.7, true); oR = this.svf[3].run(oR, f, 0.7, true);
      }
      if (crush) {                                      // 4-bit, a sixth of the rate
        if (++this.crushN >= 6) { this.crushN = 0; this.crushL = Math.round(oL * 7) / 7; this.crushR = Math.round(oR * 7) / 7; }
        oL = this.crushL * 1.1; oR = this.crushR * 1.1;
      }
      // the gate: on for the first half of every 16th, in time with the clock
      const gT = !gateOn ? 1 : this.playing ? (this.phase < this.dur * 0.5 ? 1 : 0) : ((this.t + i) % Math.round(sps)) < sps * 0.5 ? 1 : 0;
      this.gateG += (gT - this.gateG) * 0.02;
      oL *= this.gateG; oR *= this.gateG;
      // the echo throw: the mix into a long echo while held; its repeats ring on after
      this.eIn += ((echoOn ? 1 : 0) - this.eIn) * muteK;
      let er = this.ew - elen; if (er < 0) er += this.eL.length;
      const eL = this.eL[er], eR = this.eR[er];
      this.eL[this.ew] = oL * this.eIn + eR * echoFb;
      this.eR[this.ew] = oR * this.eIn * 0.6 + eL * echoFb;
      this.ew = (this.ew + 1) % this.eL.length;
      oL += eL * 0.85; oR += eR * 0.85;
      L[i] = tanh(oL * vol * 0.9);
      if (R !== L) R[i] = tanh(oR * vol * 0.9);
      // ---- a scrap of the waveform for the display
      if (++this.wdiv >= 4) { this.wdiv = 0; this.wave[this.wi] = bass + lead; this.wi = (this.wi + 1) & 63; }
    }
    this.t += n;
    if (this.t - this.lastPost >= sr / 40) {
      this.lastPost = this.t;
      const w = new Float32Array(64);
      for (let j = 0; j < 64; j++) w[j] = this.wave[(this.wi + j) & 63];
      const B = this.bass, Ld = this.lead;
      this.port.postMessage({ type: "viz", step: this.playing ? this.step : -1, abs: this.playing ? this.abs : -1, playing: this.playing,
        env: Math.max(B.fenv, Ld.fenv * 0.8), acc: B.accCap, cut: sm.cutoff, reso: sm.reso, amp: Math.max(B.amp, Ld.amp), hits: this.hits,
        accHit: B.accHit || Ld.accHit, note: B.noteHit >= 0 ? B.noteHit : Ld.noteHit, wave: w, fx: this.fx,
        tape: this.play && this.play.mode === "tape" ? this.play.rate : 1, p: { cutoff: p.cutoff, reso: p.reso, env: p.env } }, [w.buffer]);
      this.hits = 0; B.accHit = Ld.accHit = false; B.noteHit = Ld.noteHit = -1;
    }
    return true;
  }
}

registerProcessor("acid-flower", AcidFlower);
