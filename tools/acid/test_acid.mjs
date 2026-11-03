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

function load() {
  let Proc = null;
  const posted = [];
  class AudioWorkletProcessor { constructor() { this.port = { postMessage: (m) => posted.push(m), onmessage: null }; } }
  const ctx = vm.createContext({ AudioWorkletProcessor, registerProcessor: (n, c) => { Proc = c; }, sampleRate: SR, Math, Float32Array,
                                 Float64Array, Array, Object, Infinity, console, Number });
  vm.runInContext(fs.readFileSync(path.join(HERE, "acid-worklet.js"), "utf8"), ctx);
  const p = new Proc();
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
