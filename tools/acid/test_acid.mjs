// SPDX-License-Identifier: GPL-3.0-only
// Coral Acid's sound and clock, offline (node >= 18, no browser): tools/acid/acid-worklet.js loaded as an AudioWorklet
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
                                 Float64Array, Array, Object, Infinity, console });
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

console.log("Coral Acid: tools/acid/acid-worklet.js");
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
console.log(fails ? `FAIL (${fails})` : "PASS");
process.exit(fails ? 1 : 0);
