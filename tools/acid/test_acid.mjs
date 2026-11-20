// SPDX-License-Identifier: GPL-3.0-only
// Acid Flower's sound and clock, offline (node >= 18, no browser): tools/acid/acid-worklet.js loaded as an AudioWorklet
// would load it, then rendered block by block and measured.   node tools/acid/test_acid.mjs
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SR = 44100, BLOCK = 128;
let fails = 0;
const ok = (c, msg) => { console.log(`  ${c ? "ok  " : "FAIL"}  ${msg}`); if (!c) fails++; };

function load(processorOptions) {
  let Proc = null;
  const posted = [];
  class AudioWorkletProcessor { constructor() { this.port = { postMessage: (m) => posted.push(m), onmessage: null }; } }
  const ctx = vm.createContext({ AudioWorkletProcessor, registerProcessor: (n, c) => { Proc = c; }, sampleRate: SR, Math, Float32Array,
                                 Float64Array, Array, Object, Infinity, console, Number });
  vm.runInContext(fs.readFileSync(path.join(HERE, "acid-worklet.js"), "utf8"), ctx);
  const p = new Proc(processorOptions ? { processorOptions } : undefined);
  const send = (m) => p.onMessage(m);
  const render = (secs) => {
    const n = Math.round((secs * SR) / BLOCK), L = new Float32Array(n * BLOCK), R = new Float32Array(n * BLOCK);
    const steps = [];
    for (let b = 0; b < n; b++) {
      const l = new Float32Array(BLOCK), r = new Float32Array(BLOCK);
      const before = p.step;
      p.process([], [[l, r]]);
      if (p.step !== before) steps.push([p.step, b * BLOCK]);
      L.set(l, b * BLOCK); R.set(r, b * BLOCK);
    }
    return { L, R, steps };
  };
  return { p, send, render, posted };
}
const empty = () => ({ len: 16, bass: Array.from({ length: 16 }, () => ({ on: false, note: 0, oct: 0, acc: false, slide: false })),
                       drums: Array.from({ length: 5 }, () => new Array(16).fill(false)) });
const rms = (a, from, to) => { let s = 0; for (let i = from; i < to; i++) s += a[i] * a[i]; return Math.sqrt(s / Math.max(1, to - from)); };
const peak = (a) => { let m = 0; for (const v of a) m = Math.max(m, Math.abs(v)); return m; };
const finite = (a) => a.every(Number.isFinite);
const pitch = (a, from, to) => {                       // autocorrelation, 40..400 Hz
  let best = 0, lag = 0;
  for (let T = Math.floor(SR / 400); T <= Math.ceil(SR / 40); T++) {
    let s = 0;
    for (let i = from; i < to - T; i++) s += a[i] * a[i + T];
    if (s > best) { best = s; lag = T; }
  }
  return SR / lag;
};
const sps = (bpm) => (SR * 60) / bpm / 4;

console.log("Acid Flower: tools/acid/acid-worklet.js");
{ // stopped: silence
  const a = load();
  const { L } = a.render(0.5);
  ok(peak(L) < 1e-6, `stopped: silence (peak ${peak(L).toExponential(1)})`);
}
{ // a note's pitch, the accent, the gate
  const a = load(), pat = empty();
  for (const s of [0, 4, 8, 12]) pat.bass[s] = { on: true, note: 0, oct: 0, acc: s === 0, slide: false };
  a.send({ type: "params", params: { tempo: 120, swing: 0.5, delay: 0, drums: 0, decay: 0.3, env: 0.4, cutoff: 0.5 } });
  a.send({ type: "pattern", pattern: pat });
  a.send({ type: "play" });
  const { L } = a.render(2.2);
  const S = sps(120);
  ok(finite(L) && peak(L) < 1, `bass: finite, peak ${peak(L).toFixed(2)} (under 1: the limiter)`);
  const f = pitch(L, Math.round(4 * S + 300), Math.round(4 * S + 2200));
  ok(Math.abs(f - 65.41) / 65.41 < 0.03, `bass: C2 sounds at ${f.toFixed(1)} Hz (65.4)`);
  const acc = rms(L, 200, Math.round(S * 0.5)), plain = rms(L, Math.round(4 * S + 200), Math.round(4.5 * S));
  ok(acc > plain * 1.25, `accent: louder (${acc.toFixed(3)} against ${plain.toFixed(3)})`);
  const tail = rms(L, Math.round(4 * S + 0.75 * S), Math.round(5 * S - 50));
  ok(tail < plain * 0.25, `gate: the note ends inside its step (tail ${tail.toFixed(4)})`);
}
{ // slide: no new attack, the gate held through, the pitch glides to the next note
  const run = (slide) => {
    const a = load(), pat = empty();
    pat.bass[0] = { on: true, note: 0, oct: 0, acc: false, slide };
    pat.bass[1] = { on: true, note: 7, oct: 0, acc: false, slide: true };   // (held through: a long window)
    a.send({ type: "params", params: { tempo: 120, swing: 0.5, delay: 0, drums: 0 } });
    a.send({ type: "pattern", pattern: pat });
    a.send({ type: "play" });
    return a.render(0.6).L;
  };
  const S = sps(120), held = run(true), cut = run(false);
  const gap = (a) => rms(a, Math.round(0.8 * S), Math.round(S - 20));
  ok(gap(held) > 4 * gap(cut), `slide: the gate held to the next note (${gap(held).toFixed(3)} against ${gap(cut).toFixed(4)} without)`);
  const f = pitch(held, Math.round(1.25 * S), Math.round(1.95 * S));
  ok(Math.abs(f - 98) / 98 < 0.03, `slide: arrives at G2, ${f.toFixed(1)} Hz (98.0)`);
}
{ // every drum sounds, the kick on the beat, nothing runs away
  const S = sps(120);
  for (const [lane, name] of [[0, "kick"], [1, "snare"], [2, "clap"], [3, "closed hat"], [4, "open hat"]]) {
    const a = load(), pat = empty();
    pat.drums[lane][0] = pat.drums[lane][8] = true;
    a.send({ type: "params", params: { tempo: 120, swing: 0.5, delay: 0 } });
    a.send({ type: "pattern", pattern: pat });
    a.send({ type: "play" });
    const { L } = a.render(1.2);
    const hit = rms(L, 0, Math.round(S)), quiet = rms(L, Math.round(5 * S), Math.round(7.5 * S));
    ok(finite(L) && hit > 0.02 && quiet < hit * 0.25, `${name}: hits (${hit.toFixed(3)}), then dies away (${quiet.toFixed(4)})`);
  }
}
{ // the clock: 16th notes at the tempo, swing on the off-beats, the pattern's length, the next pattern at the bar
  const a = load(), pat = empty();
  pat.len = 8;
  a.send({ type: "params", params: { tempo: 120, swing: 0.66, delay: 0 } });
  a.send({ type: "pattern", pattern: pat });
  a.send({ type: "play" });
  const { steps } = a.render(1.3);
  const S = sps(120), at = (k) => (steps.find(([s], i) => s === k && i > 0) || [, -1])[1];
  const t1 = at(1), t2 = at(2);
  ok(Math.abs(t1 - 0.66 * 2 * S) < BLOCK * 1.5 && Math.abs(t2 - 2 * S) < BLOCK * 1.5,
     `swing 66%: step 2 at ${t1} samples (${Math.round(0.66 * 2 * S)}), step 3 at ${t2} (${Math.round(2 * S)})`);
  ok(Math.max(...steps.map(([s]) => s)) === 7, `length 8: steps 1..8 then round again`);
  const b = load(), p1 = empty(), p2 = empty();
  p2.drums[0][0] = true;
  b.send({ type: "params", params: { tempo: 120, delay: 0 } });
  b.send({ type: "pattern", pattern: p1 });
  b.send({ type: "play" });
  b.render(0.3);
  b.send({ type: "pattern", pattern: p2, atBar: true });
  const r = b.render(1.9);
  const bar = Math.round(16 * S - 0.3 * SR);
  ok(rms(r.L, 0, bar - 400) < 1e-4 && rms(r.L, bar + 200, bar + 4000) > 0.02, `the next pattern waits for the bar's end`);
}
{ // the display's messages, and the speed
  const a = load(), pat = empty();
  for (let s = 0; s < 16; s++) { pat.bass[s] = { on: s % 3 !== 2, note: (s * 5) % 12, oct: s % 4 === 3 ? 1 : 0, acc: s % 4 === 0, slide: s % 5 === 1 }; pat.drums[0][s] = s % 4 === 0; pat.drums[3][s] = s % 2 === 1; }
  pat.drums[2][4] = pat.drums[2][12] = true;
  a.send({ type: "params", params: { reso: 0.95, drive: 0.8, delay: 0.5, cutoff: 0.8, env: 1 } });
  a.send({ type: "pattern", pattern: pat });
  a.send({ type: "play" });
  const t0 = process.hrtime.bigint();
  const { L, R } = a.render(10);
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  ok(finite(L) && finite(R) && peak(L) <= 1 && rms(L, 0, L.length) > 0.05, `everything at once, resonance and drive high: finite, peak ${peak(L).toFixed(2)}, rms ${rms(L, 0, L.length).toFixed(3)}`);
  const v = a.posted.filter((m) => m.type === "viz");
  ok(v.length > 300 && v.some((m) => m.accHit) && v.some((m) => m.hits & 1) && v.every((m) => m.wave.length === 64),
     `display: ${v.length} messages in 10 s, with accents, kicks and the waveform`);
  ok(ms < 2500, `speed: 10 s rendered in ${ms.toFixed(0)} ms (${(10000 / ms).toFixed(0)}x real time)`);
}
{ // the punch-ins, held over a playing pattern
  const S = sps(120), F = { REP8: 0, REP16: 1, ROLL: 2, REV: 3, TAPE: 4, LP: 5, HP: 6, CRUSH: 7, GATE: 8, ECHO: 9, BASSOUT: 10, DRUMSOUT: 11 };
  const busy = () => {                                 // a different note on every step, hats, a kick on the beat
    const pat = empty();
    for (let s = 0; s < 16; s++) { pat.bass[s] = { on: true, note: (s * 7) % 12, oct: s % 3 === 0 ? 1 : 0, acc: s % 4 === 0, slide: false }; pat.drums[3][s] = true; }
    for (const s of [0, 4, 8, 12]) pat.drums[0][s] = true;
    return pat;
  };
  const run = (pat, mask, at, hold, total, params = {}) => {
    const a = load();
    a.send({ type: "params", params: { tempo: 120, swing: 0.5, delay: 0, ...params } });
    a.send({ type: "pattern", pattern: pat }); a.send({ type: "play" });
    const pre = a.render(at);
    a.send({ type: "fx", mask: mask ? 1 << mask[0] : 0 });
    const held = a.render(hold);
    a.send({ type: "fx", mask: 0 });
    const after = a.render(total);
    return { pre: pre.L, held: held.L, after: after.L };
  };
  const corr = (x, i0, y, j0, n, dir = 1) => { let sxy = 0, sxx = 0, syy = 0; for (let k = 0; k < n; k++) { const u = x[i0 + k], v = y[j0 + dir * k]; sxy += u * v; sxx += u * u; syy += v * v; } return sxy / Math.sqrt(sxx * syy + 1e-12); };
  // REPEAT 1/16 and ROLL 1/32: the held sound repeats at a 16th / a 32nd
  for (const [name, bit, len] of [["REPEAT 1/16", F.REP16, Math.round(S)], ["ROLL 1/32", F.ROLL, Math.round(S / 2)], ["REPEAT 1/8", F.REP8, Math.round(2 * S)]]) {
    const r = run(busy(), [bit], 0.57, 1.2, 0.1);
    const c = corr(r.held, Math.round(0.5 * SR), r.held, Math.round(0.5 * SR) + len, Math.round(len * 0.8));
    const live = corr(r.pre, Math.round(0.1 * SR), r.pre, Math.round(0.1 * SR) + len, Math.round(len * 0.8));
    ok(c > 0.97 && finite(r.held), `${name}: the held sound repeats every ${len} samples (correlation ${c.toFixed(3)}; live ${live.toFixed(2)})`);
  }
  { // REVERSE: what was just played, backwards
    const r = run(busy(), [F.REV], 0.8, 0.5, 0.1), n = Math.round(0.25 * SR), off = 400;
    const c = corr(r.held, off, r.pre, r.pre.length - 1 - off, n, -1);
    ok(c > 0.9, `REVERSE: the last quarter second played backwards (correlation ${c.toFixed(3)})`);
  }
  { // TAPE STOP: slows down, then silence
    const r = run(busy(), [F.TAPE], 0.6, 1.2, 0.1);
    const zc = (a, i0, n) => { let z = 0; for (let k = i0 + 1; k < i0 + n; k++) z += (a[k - 1] < 0) !== (a[k] < 0); return z; };
    const z0 = zc(r.held, 0, 4000), z1 = zc(r.held, Math.round(0.45 * SR), 4000), end = rms(r.held, Math.round(0.95 * SR), Math.round(1.15 * SR));
    ok(z1 < z0 * 0.7 && end < 0.005, `TAPE STOP: it slows (${z0} then ${z1} zero crossings) and stops (rms ${end.toFixed(4)})`);
  }
  { // LOWPASS and HIGHPASS sweeps
    const hf = (a, i0, n) => { let s2 = 0; for (let k = i0 + 1; k < i0 + n; k++) s2 += (a[k] - a[k - 1]) ** 2; return Math.sqrt(s2 / n); };
    const lfE = (a, i0, n) => { let m = 0, s2 = 0; for (let k = i0; k < i0 + n; k++) { m += (a[k] - m) * 0.01; s2 += m * m; } return Math.sqrt(s2 / n); };
    const r = run(busy(), [F.LP], 0.5, 1.8, 0.4), h = run(busy(), [F.HP], 0.5, 1.8, 0.4), N2 = Math.round(0.5 * SR);
    const before = hf(r.pre, 0, Math.round(0.45 * SR)), closed = hf(r.held, Math.round(1.25 * SR), N2), back = hf(r.after, Math.round(0.15 * SR), Math.round(0.25 * SR));
    ok(closed < before * 0.2 && back > before * 0.6, `LOWPASS: the highs swept away (${before.toFixed(3)} to ${closed.toFixed(3)}) and back after (${back.toFixed(3)})`);
    const lb = lfE(h.pre, 0, Math.round(0.45 * SR)), lo = lfE(h.held, Math.round(1.25 * SR), N2);
    ok(lo < lb * 0.35, `HIGHPASS: the lows swept away (${lb.toFixed(3)} to ${lo.toFixed(3)})`);
  }
  { // CRUSH: held steps of six samples
    const r = run(busy(), [F.CRUSH], 0.4, 0.4, 0.05);
    let same = 0, n = 0; for (let k = 2000; k < 12000; k++) { n++; same += r.held[k] === r.held[k - 1]; }
    ok(same / n > 0.75, `CRUSH: the sample rate cut (${Math.round((100 * same) / n)}% of samples repeat the last)`);
  }
  { // GATE: silent in the second half of each 16th
    const r = run(busy(), [F.GATE], 0.5, 1.0, 0.05), T = Math.round(0.5 * SR);   // (the held part starts at sample T of the clock)
    let a1 = 0, a2 = 0;
    for (let k = Math.ceil(T / S) + 1; k < Math.ceil(T / S) + 5; k++) {
      const b0 = Math.round(k * S) - T;
      a1 += rms(r.held, b0 + 300, b0 + Math.round(S * 0.45)); a2 += rms(r.held, b0 + Math.round(S * 0.6), b0 + Math.round(S * 0.95));
    }
    ok(a2 < a1 * 0.08, `GATE: each 16th on then off (${(a1 / 4).toFixed(3)} against ${(a2 / 4).toFixed(4)})`);
  }
  { // ECHO: a throw that rings on after the release
    const one = empty(); one.drums[1][0] = true;                    // one snare, then nothing
    const r = run(one, [F.ECHO], 0.02, 0.15, 1.5), d = run(one, null, 0.02, 0.15, 1.5);
    const tail = rms(r.after, Math.round(0.4 * SR), Math.round(1.2 * SR)), dry = rms(d.after, Math.round(0.4 * SR), Math.round(1.2 * SR));
    ok(tail > 0.01 && tail > dry * 8, `ECHO: its repeats ring on after the release (${tail.toFixed(3)} against ${dry.toFixed(4)} without)`);
  }
  { // BASS OUT and DRUMS OUT
    const bassOnly = busy(); bassOnly.drums = bassOnly.drums.map((r) => r.map(() => false));
    const drumsOnly = busy(); drumsOnly.bass = drumsOnly.bass.map(() => ({ on: false, note: 0, oct: 0, acc: false, slide: false }));
    const b = run(bassOnly, [F.BASSOUT], 0.3, 0.6, 0.05), d = run(drumsOnly, [F.DRUMSOUT], 0.3, 0.6, 0.05);
    const gone = rms(b.held, Math.round(0.3 * SR), b.held.length);   // (after the delay's last repeats)
    ok(gone < 0.002 && rms(b.pre, 2000, b.pre.length) > 0.05, `BASS OUT: the bass gone (${gone.toFixed(4)})`);
    ok(rms(d.held, 2000, d.held.length) < 0.002 && rms(d.pre, 2000, d.pre.length) > 0.02, `DRUMS OUT: the drums gone (${rms(d.held, 2000, d.held.length).toFixed(4)})`);
  }
  { // everything at once: still finite and limited
    const a = load();
    a.send({ type: "pattern", pattern: busy() }); a.send({ type: "play" }); a.render(0.4);
    a.send({ type: "fx", mask: 0xfff }); const r = a.render(2);
    ok(finite(r.L) && finite(r.R) && peak(r.L) <= 1, `all twelve held at once: finite, peak ${peak(r.L).toFixed(2)}`);
  }
}
{ // v2: the three new drums, each drum's knobs, chance, ratchets, track lengths, 32 steps, the lead, live keys,
  // the room and the pump
  const S = sps(120);
  const e8 = () => { const p = empty(); p.drums = Array.from({ length: 8 }, () => new Array(32).fill(false)); return p; };
  for (const [lane, name] of [[5, "tom"], [6, "rim"], [7, "cowbell"]]) {
    const a = load(), pat = e8();
    pat.drums[lane][0] = pat.drums[lane][8] = true;
    a.send({ type: "params", params: { tempo: 120, swing: 0.5, delay: 0 } });
    a.send({ type: "pattern", pattern: pat }); a.send({ type: "play" });
    const { L } = a.render(1.2);
    const hit = rms(L, 0, Math.round(S)), quiet = rms(L, Math.round(5 * S), Math.round(7.5 * S));
    ok(finite(L) && hit > 0.02 && quiet < hit * 0.25, `${name}: hits (${hit.toFixed(3)}), then dies away (${quiet.toFixed(4)})`);
  }
  { // a drum's tune and level
    const tom = (dk) => { const a = load(), pat = e8(); pat.drums[5][0] = true;
      a.send({ type: "params", params: { tempo: 120, swing: 0.5, delay: 0, dk } }); a.send({ type: "pattern", pattern: pat }); a.send({ type: "play" });
      return a.render(0.4).L; };
    const f0 = pitch(tom(null), 4000, 9000), f1 = pitch(tom([null, null, null, null, null, [12, 0.5, 0.8]]), 4000, 9000);
    ok(Math.abs(f1 / f0 - 2) < 0.15, `tom tuned up an octave: ${f0.toFixed(0)} to ${f1.toFixed(0)} Hz`);
    const q = rms(tom([null, null, null, null, null, [0, 0.5, 0.2]]), 0, 6000), l = rms(tom(null), 0, 6000);
    ok(q < l * 0.4, `tom's level down: ${q.toFixed(3)} against ${l.toFixed(3)}`);
  }
  { // chance: 0 never plays, 50 plays about half
    const count = (prob) => { const a = load(), pat = e8(); pat.dp = pat.drums.map(() => new Array(32).fill(prob));
      for (let s2 = 0; s2 < 16; s2++) pat.drums[6][s2] = true;
      a.send({ type: "params", params: { tempo: 120, swing: 0.5, delay: 0 } }); a.send({ type: "pattern", pattern: pat }); a.send({ type: "play" });
      a.render(8); return a.posted.filter((m) => m.type === "viz").reduce((n, m) => n + ((m.hits >> 6) & 1), 0); };
    const none = count(0), half = count(50), all = count(100);
    ok(none === 0 && half > all * 0.25 && half < all * 0.75, `chance: 0% ${none} hits, 50% ${half}, 100% ${all}`);
  }
  { // ratchets: a step repeated 4 times inside itself
    const a = load(), pat = e8(); pat.drums[6][0] = true; pat.dr = pat.drums.map(() => new Array(32).fill(1)); pat.dr[6][0] = 4;
    a.send({ type: "params", params: { tempo: 60, swing: 0.5, delay: 0 } }); a.send({ type: "pattern", pattern: pat }); a.send({ type: "play" });
    const { L } = a.render(0.25), S60 = sps(60);
    let onsets = 0;
    for (let q = 0; q < 4; q++) if (rms(L, Math.round((q * S60) / 4), Math.round((q * S60) / 4 + 300)) > 0.02) onsets++;
    ok(onsets === 4, `ratchet x4: ${onsets} hits inside one step`);
  }
  { // track lengths: a 3-step kick against a 16-step bar; 32 steps
    const a = load(), pat = e8(); pat.drums[0][0] = true; pat.dlen = [3, 0, 0, 0, 0, 0, 0, 0];
    a.send({ type: "params", params: { tempo: 120, swing: 0.5, delay: 0 } }); a.send({ type: "pattern", pattern: pat }); a.send({ type: "play" });
    a.render(2.05);
    const kicks = a.posted.filter((m) => m.type === "viz").reduce((n, m) => n + (m.hits & 1), 0);
    ok(kicks === 6, `a 3-step kick lane: ${kicks} kicks in 16 steps (6)`);
    const b = load(), p32 = e8(); p32.len = 32;
    b.send({ type: "params", params: { tempo: 120, swing: 0.5, delay: 0 } }); b.send({ type: "pattern", pattern: p32 }); b.send({ type: "play" });
    const { steps } = b.render(4.2);
    ok(Math.max(...steps.map(([s2]) => s2)) === 31, `32 steps: the clock runs to step 32`);
  }
  { // the lead: an octave above the bass, its own track
    const a = load(), pat = e8(); pat.lead = Array.from({ length: 32 }, () => ({ on: false, note: 0, oct: 0, acc: false, slide: false }));
    pat.lead[0] = { on: true, note: 0, oct: 0, acc: false, slide: true }; pat.lead[1] = { on: true, note: 0, oct: 0, acc: false, slide: true };
    a.send({ type: "params", params: { tempo: 120, swing: 0.5, delay: 0, drums: 0, leadWave: 0, lead: 1 } }); a.send({ type: "pattern", pattern: pat }); a.send({ type: "play" });
    const { L } = a.render(0.6), f = pitch(L, 3000, 9000);
    ok(Math.abs(f - 130.8) / 130.8 < 0.04, `lead: C3 sounds at ${f.toFixed(1)} Hz (130.8)`);
  }
  { // a live key: held, then let go
    const a = load();
    a.send({ type: "params", params: { delay: 0, lead: 1 } }); a.send({ type: "live", on: true, note: 57, voice: "lead" });
    const held = a.render(0.5).L; a.send({ type: "live", on: false, note: 57, voice: "lead" }); const after = a.render(0.3).L;
    ok(rms(held, 15000, 22000) > 0.03 && rms(after, 4000, 13000) < 0.003, `live key: sounds while held (${rms(held, 15000, 22000).toFixed(3)}), stops after (${rms(after, 4000, 13000).toFixed(4)})`);
  }
  { // the room: a tail after a snare; the pump: the bass ducked after a kick
    const tail = (verb) => { const a = load(), pat = e8(); pat.drums[1][0] = true;
      a.send({ type: "params", params: { tempo: 60, swing: 0.5, delay: 0, verb } }); a.send({ type: "pattern", pattern: pat }); a.send({ type: "play" });
      const { L } = a.render(1.2); return rms(L, Math.round(0.5 * SR), Math.round(1.0 * SR)); };
    const wet = tail(0.8), dry = tail(0);
    ok(wet > dry * 2.5 && wet > 0.004, `reverb: a tail after the snare (${wet.toFixed(4)} against ${dry.toFixed(5)} dry)`);
    const duck = (pump) => { const a = load(), pat = e8(); pat.drums[0][0] = true; pat.bass[0] = { on: true, note: 0, oct: 0, acc: false, slide: true };
      for (let s2 = 1; s2 < 16; s2++) pat.bass[s2] = { on: true, note: 0, oct: 0, acc: false, slide: true };
      a.send({ type: "params", params: { tempo: 120, swing: 0.5, delay: 0, drums: 0, pump } }); a.send({ type: "pattern", pattern: pat }); a.send({ type: "play" });
      const { L } = a.render(0.5); return rms(L, 800, 3500); };
    const pumped = duck(1), flat = duck(0);
    ok(pumped < flat * 0.5, `pump: the bass ducked under the kick (${pumped.toFixed(3)} against ${flat.toFixed(3)})`);
  }
}
{ // an export: a queue of patterns, played once each then the tails; stems that add up to the mix
  const S120 = sps(120), e8 = () => { const p = empty(); p.drums = Array.from({ length: 8 }, () => new Array(32).fill(false)); return p; };
  const p1 = e8(), p2 = e8();
  p1.drums[0][0] = true; p1.bass[2] = { on: true, note: 0, oct: 0, acc: false, slide: false, prob: 50 };
  p2.drums[1][0] = true; p2.lead = Array.from({ length: 32 }, () => ({ on: false, note: 0, oct: 0, acc: false, slide: false })); p2.lead[4] = { on: true, note: 7, oct: 0, acc: false, slide: false };
  for (let s2 = 0; s2 < 16; s2 += 2) p1.drums[3][s2] = true;
  const opts = (mute) => ({ params: { tempo: 120, swing: 0.5, delay: 0.3, verb: 0.3 }, queue: [{ pattern: p1, reps: 2 }, { pattern: p2, reps: 1 }], play: true, mute });
  const run = (mute) => load(opts(mute)).render((3 * 16 * S120) / SR + 1.5);
  const mix = run(null), b = run({ lead: 1, drums: 1 }), l = run({ bass: 1, drums: 1 }), d = run({ bass: 1, lead: 1 });
  const kicks = (r) => { let n = 0; for (let k = 0; k < 4; k++) if (rms(r.L, Math.round(k * 16 * S120), Math.round(k * 16 * S120 + 1500)) > 0.05) n++; return n; };
  const done = load(opts(null)); done.render((3 * 16 * S120) / SR + 0.2);
  ok(rms(mix.L, Math.round(48 * S120 + 0.9 * SR), mix.L.length) < 0.01 && !done.p.playing, `export: the queue plays (2 bars, then 1), then stops and rings out`);
  ok(kicks(d) >= 2, `export: pattern 1's kick on bars 1 and 2 (${kicks(d)} loud bar starts)`);
  let err = 0, tot = 0;
  for (let i = 0; i < mix.L.length; i += 7) { const sum = b.L[i] + l.L[i] + d.L[i]; err += Math.abs(mix.L[i] - sum); tot += Math.abs(mix.L[i]); }
  ok(err / tot < 0.25, `stems: bass + lead + drums close to the mix (difference ${(100 * err / tot).toFixed(1)}%, the limiter's)`);
  ok(rms(l.L, 0, Math.round(32 * S120)) < 1e-4 && rms(l.L, Math.round(36 * S120), Math.round(40 * S120)) > 0.01, `stems: the lead only where the lead plays`);
}
{ // the squelch pad over a repeat: unmoved, the loop is untouched; moved left after the press, the loop goes dark
  const S = sps(120), busyP = () => { const p = empty(); for (let s2 = 0; s2 < 16; s2++) { p.bass[s2] = { on: true, note: (s2 * 7) % 12, oct: s2 % 3 === 0 ? 1 : 0, acc: s2 % 4 === 0, slide: false }; p.drums[3][s2] = true; } return p; };
  const run = (cutAfter) => {
    const a = load(); a.send({ type: "params", params: { tempo: 120, swing: 0.5, delay: 0, cutoff: 0.7, reso: 0.7 } });
    a.send({ type: "pattern", pattern: busyP() }); a.send({ type: "play" }); a.render(0.5);
    a.send({ type: "fx", mask: 1 << 1 }); a.render(0.05);
    if (cutAfter != null) a.send({ type: "params", params: { cutoff: cutAfter } });
    return a.render(0.6).L;
  };
  const zc = (x, from) => { let n = 0; for (let i = from + 1; i < x.length; i++) if ((x[i - 1] < 0) !== (x[i] < 0)) n++; return n; };
  const still = run(null), dark = run(0.15), from = Math.round(0.25 * SR);
  ok(zc(dark, from) < zc(still, from) * 0.5, `squelch over REPEAT: the pad left closes the loop (${zc(still, from)} to ${zc(dark, from)} zero crossings)`);
}
{ // Drift: it plays itself; the same seed, the same piece; the weather brings in the acid and the drums; taps, textures,
  // the shimmer; fast enough
  const drift = (set, secs, msgs) => { const a = load({ drift: { seed: "nightbus", ...set }, play: true }); if (msgs) msgs(a); const r = a.render(secs); return { ...r, a }; };
  const calm = drift({ weather: 0 }, 8), again = drift({ weather: 0 }, 8), other = drift({ weather: 0, seed: "sunrise" }, 8);
  ok(finite(calm.L) && peak(calm.L) < 1 && rms(calm.L, Math.round(4 * SR), calm.L.length) > 0.01, `Drift: the pad swells in and plays (rms ${rms(calm.L, Math.round(4 * SR), calm.L.length).toFixed(3)})`);
  let same = true, diff = 0;
  for (let i = 0; i < calm.L.length; i += 11) { if (calm.L[i] !== again.L[i]) same = false; diff += Math.abs(calm.L[i] - other.L[i]); }
  ok(same && diff > 1, `Drift: "nightbus" twice is the same piece; "sunrise" is another`);
  const vz = (r) => r.a.posted.filter((m) => m.type === "viz");
  const kicksCalm = vz(calm).reduce((n, m) => n + (m.hits & 1), 0);
  const storm = drift({ weather: 1 }, 10), kicksStorm = vz(storm).reduce((n, m) => n + (m.hits & 1), 0), acid = vz(storm).at(-1).drift.acid;
  ok(kicksCalm === 0 && kicksStorm > 3 && acid > 0.95 && vz(calm).at(-1).drift.acid < 0.01, `Drift: calm has no drums and no acid; a storm brings both (${kicksStorm} kicks, acid ${acid.toFixed(2)})`);
  const tapped = drift({ weather: 0 }, 1.5, (a) => { a.render(0.3); a.send({ type: "drift", tap: 0.8 }); });
  ok(vz(tapped).some((m) => m.drift && m.drift.bell >= 60), `Drift: a tap rings a bell`);
  const hf = (x, from, to) => { let n = 0; for (let i = from + 1; i < to; i++) n += Math.abs(x[i] - x[i - 1]); return n / (to - from); };
  const dry = drift({ weather: 0.2, texture: "none" }, 2).L, rain = drift({ weather: 0.2, texture: "rain", tex: 1 }, 2).L;
  const only = rain.map((x, i) => x - dry[i]);            // (the same seed plays the same music: what is left is the rain)
  ok(rms(only, 2000, 80000) > 0.01 && hf(only, 2000, 80000) > hf(dry, 2000, 80000) * 0.5, `Drift: rain adds its hiss and drops (the rain alone: rms ${rms(only, 2000, 80000).toFixed(3)})`);
  const rainAt = (w) => { const d = drift({ weather: w, texture: "none" }, 2).L, r = drift({ weather: w, texture: "rain", tex: 1 }, 2).L; return rms(r.map((x, i) => x - d[i]), 2000, 80000); };
  const light = rainAt(0), heavy = rainAt(0.9);
  ok(heavy > light * 1.5, `Drift: the rain grows with the weather (${light.toFixed(3)} calm, ${heavy.toFixed(3)} stormy)`);
  const birdsAt = (w) => { const d = drift({ weather: w, texture: "none" }, 4).L, r = drift({ weather: w, texture: "birds", tex: 1 }, 4).L; return rms(r.map((x, i) => x - d[i]), 2000, r.length); };
  ok(birdsAt(0) > 0.003 && birdsAt(0) > birdsAt(1) * 2, `Drift: birds sing in the calm, hide from a storm (${birdsAt(0).toFixed(4)} / ${birdsAt(1).toFixed(4)})`);
  for (const k of ["wind", "fire", "city", "vinyl", "ocean"]) { const d = drift({ weather: 0.4 }, 2).L, r = drift({ weather: 0.4, texture: k, tex: 1 }, 2).L, o = rms(r.map((x, i) => x - d[i]), 2000, r.length); ok(o > 0.004 && finite(r), `Drift: ${k} sounds (${o.toFixed(4)})`); }
  { const d = drift({ weather: 0.3 }, 2).L, two = drift({ weather: 0.3, texture: "rain", texture2: "fire", tex: 1 }, 2).L, one = drift({ weather: 0.3, texture: "rain", tex: 1 }, 2).L;
    ok(rms(two.map((x, i) => x - d[i]), 2000, 80000) > rms(one.map((x, i) => x - d[i]), 2000, 80000) * 1.1, `Drift: two textures at once`); }
  const sh = (amt) => { const r = drift({ weather: 0, shimmer: amt, space: 1 }, 7); ok(finite(r.L) && rms(r.L, Math.round(5 * SR), r.L.length) < 0.6, `Drift: shimmer ${amt} stays in bounds (rms ${rms(r.L, Math.round(5 * SR), r.L.length).toFixed(3)})`); return hf(r.L, Math.round(5 * SR), r.L.length - 1) / rms(r.L, Math.round(5 * SR), r.L.length); };   // (brightness: the highs for the loudness)
  const s0 = sh(0), s1 = sh(1);
  ok(s1 > s0 * 1.1, `Drift: the shimmer brightens the tail (${s0.toFixed(4)} to ${s1.toFixed(4)})`);
  const off = drift({ weather: 0.5 }, 6, null); off.a.send({ type: "drift", on: false }); off.a.send({ type: "stop" }); const tail = off.a.render(14).L;
  ok(rms(tail, Math.round(12 * SR), tail.length) < 0.004, `Drift off: it fades to silence (${rms(tail, Math.round(12 * SR), tail.length).toFixed(4)})`);
  const t0 = process.hrtime.bigint(); drift({ weather: 0.8, texture: "ocean", tex: 0.6 }, 10); const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  ok(ms < 3000, `Drift: speed, 10 s rendered in ${ms.toFixed(0)} ms (${(10000 / ms).toFixed(0)}x real time)`);
}
{ // Drift's additions: five pads and three bells, a held note, freeze, the movements and a new key, the drone and the pulse,
  // weather that drifts by itself
  const drift = (set, secs, msgs) => { const a = load({ drift: { seed: "nightbus", weather: 0, ...set }, play: true }); if (msgs) msgs(a); const r = a.render(secs); return { ...r, a }; };
  const vz = (r) => r.a.posted.filter((m) => m.type === "viz");
  const sigs = {};
  for (const pad of ["saw", "glass", "choir", "keys", "drone"]) {
    const r = drift({ pad }, 6), lv = rms(r.L, Math.round(3 * SR), r.L.length);
    sigs[pad] = r.L;
    ok(finite(r.L) && peak(r.L) < 1 && lv > 0.01 && vz(r).at(-1).drift.pad === pad, `Drift pad "${pad}": plays (rms ${lv.toFixed(3)})`);
  }
  let alike = 0; const ks = Object.keys(sigs);
  for (let i = 0; i < ks.length; i++) for (let j = i + 1; j < ks.length; j++) { let d = 0; for (let n = 132300; n < 264600; n += 13) d += Math.abs(sigs[ks[i]][n] - sigs[ks[j]][n]); if (d < 5) alike++; }
  ok(alike === 0, `Drift pads: all five sound different`);
  for (const bell of ["bell", "box", "glass"]) {
    const r = drift({ bell, pad: "glass" }, 2, (a) => { a.render(0.2); a.send({ type: "drift", tap: 0.7 }); });
    ok(finite(r.L) && vz(r).at(-1).drift.bellT === bell, `Drift bell "${bell}": rings`);
  }
  { // a held finger: it sounds while held, and fades when let go
    const base = drift({ moodY: 0 }, 1.5).L;
    const r = drift({ moodY: 0 }, 1.5, (a) => { a.send({ type: "drift", hold: { id: 1, x: 0.6, on: true } }); });
    const held = rms(r.L.map((x, i) => x - base[i]), Math.round(0.8 * SR), r.L.length);
    ok(held > 0.01, `Drift: a held finger holds a note (${held.toFixed(3)})`);
    r.a.send({ type: "drift", hold: { id: 1, on: false } }); const after = r.a.render(20).L;
    const left = r.a.p.drift.pads.filter((v) => v.held != null || (v.env > 0 && v.held === 1)).length;
    ok(left === 0, `Drift: let go, the note fades`);
  }
  { // freeze: no new notes, the chord holds
    const r = drift({ weather: 0.9, moodY: 1 }, 3, (a) => { a.render(2); a.send({ type: "drift", set: { freeze: true } }); });
    const before = r.a.p.drift.abs, notes = vz(r).slice(-20).filter((m) => m.drift.bell >= 0).length, more = r.a.render(3);
    const later = vz(r).slice(-60).filter((m) => m.drift.bell >= 0 || (m.hits & 1)).length;
    ok(later === 0 && rms(more.L, 0, more.L.length) > 0.01 && vz(r).at(-1).drift.frozen, `Drift: frozen, nothing new plays but the chord holds (rms ${rms(more.L, 0, more.L.length).toFixed(3)})`);
  }
  { // the movements: build, full, thin, rest, a new key
    const a = load({ drift: { seed: "nightbus", bpm: 180, moodY: 1 }, play: true });
    const seen = new Set(), roots = new Set(); let lowArc = 1;
    for (let k = 0; k < 40; k++) { a.render(5); const d = a.p.drift; seen.add(d.sect); roots.add(d.root); if (d.sect === "rest") lowArc = Math.min(lowArc, d.arc); }
    ok(["build", "full", "thin", "rest"].every((x) => seen.has(x)) && roots.size >= 2 && lowArc < 0.4, `Drift: movements (${[...seen].join(", ")}), the rest quiet (arc ${lowArc.toFixed(2)}), then a new key (${roots.size} keys)`);
  }
  { // the drone and the pulse
    const plain = drift({ drone: 0, pulse: 0, moodY: 0 }, 4).L, dr = drift({ drone: 1, pulse: 0, moodY: 0 }, 4).L, pu = drift({ drone: 0, pulse: 1, moodY: 0 }, 4).L;
    const dOnly = dr.map((x, i) => x - plain[i]), pOnly = pu.map((x, i) => x - plain[i]);
    const f = pitch(dOnly, Math.round(2 * SR), Math.round(3 * SR));
    ok(rms(dOnly, Math.round(1 * SR), dOnly.length) > 0.004 && f < 120, `Drift: the drone hums low (${f.toFixed(0)} Hz)`);
    ok(rms(pOnly, 0, pOnly.length) > 0.004, `Drift: the pulse beats (${rms(pOnly, 0, pOnly.length).toFixed(4)})`);
  }
  { // weather that drifts by itself
    const a = load({ drift: { seed: "nightbus", weather: 0.05, autoW: true, bpm: 180 }, play: true }); const ws = [];
    for (let k = 0; k < 12; k++) { a.render(5); ws.push(a.p.drift.set.weather); }
    ok(Math.max(...ws) - Math.min(...ws) > 0.05, `Drift: auto weather wanders (${Math.min(...ws).toFixed(2)} to ${Math.max(...ws).toFixed(2)})`);
  }
}
{ // the power-on sounds (boot-sound.js): each part where the boot animation puts it, nothing clipped, then quiet
  const ctx = vm.createContext({ Math, Float32Array, globalThis: {} });
  ctx.globalThis = ctx;
  vm.runInContext(fs.readFileSync(path.join(HERE, "boot-sound.js"), "utf8"), ctx);
  const { bootSound, enterSound, READY } = ctx.AcidBootSound;
  const t0 = process.hrtime.bigint(), [L, R] = bootSound(SR), ms = Number(process.hrtime.bigint() - t0) / 1e6;
  const at = (a, b) => rms(L, Math.round(a * SR), Math.round(b * SR));
  const parts = { before: at(0, 0.07), thump: at(0.08, 0.35), clicks: at(1.0, 2.0), whoosh: at(2.8, 3.6), ready: at(READY, READY + 0.4), end: at(5.2, 5.39) };
  ok(finite(L) && finite(R) && peak(L) < 1 && peak(R) < 1 && ms < 1500, `boot sound: ${(L.length / SR).toFixed(1)} s made in ${ms.toFixed(0)} ms, peak ${peak(L).toFixed(2)}`);
  ok(parts.before < 1e-4 && parts.thump > 0.05 && parts.clicks > 0.005 && parts.whoosh > 0.05 && parts.ready > 0.1 && parts.end < 0.01,
     `boot sound: silence, then the thump ${parts.thump.toFixed(3)}, the BIOS's clicks ${parts.clicks.toFixed(3)}, the whoosh ${parts.whoosh.toFixed(3)}, the ready stab ${parts.ready.toFixed(3)}, fading to ${parts.end.toFixed(4)}`);
  const [eL] = enterSound(SR);
  ok(finite(eL) && peak(eL) < 1 && rms(eL, 0, eL.length) > 0.05, `enter sound: ${(eL.length / SR).toFixed(2)} s, rms ${rms(eL, 0, eL.length).toFixed(3)}`);
}
console.log(fails ? `FAIL (${fails})` : "PASS");
process.exit(fails ? 1 : 0);
