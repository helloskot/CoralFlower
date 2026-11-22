// SPDX-License-Identifier: GPL-3.0-only
// Handwave, offline (node >= 18, no browser): the theory (every chord in key), then the sound engine
// (tools/handwave/handwave-worklet.js) loaded as an AudioWorklet would load it, rendered and measured.
//   node tools/handwave/test_handwave.mjs
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SR = 44100, BLOCK = 128;
let fails = 0;
const ok = (c, msg) => { console.log(`  ${c ? "ok  " : "FAIL"}  ${msg}`); if (!c) fails++; };

// ---- the theory
const tctx = vm.createContext({ Math, Array, Object, globalThis: {} });
tctx.globalThis = tctx;
vm.runInContext(fs.readFileSync(path.join(HERE, "theory.js"), "utf8"), tctx);
const T = tctx.HWTheory;
console.log("Handwave: theory.js");
{ // every chord, every key, scale, degree, flavour and voicing: only the scale's notes
  let bad = 0, count = 0;
  for (const sc of Object.keys(T.SCALES)) for (let key = 0; key < 12; key++) {
    const pcs = new Set(T.SCALES[sc].steps.map((s) => (s + key) % 12));
    for (let d = 0; d < 7; d++) for (let f = 0; f < 6; f++) for (let v = 0; v < 4; v++) {
      const c = T.chord(key, sc, d, f, v); count++;
      if (!c.notes.every((n) => pcs.has(((n % 12) + 12) % 12)) || c.notes.length < 3) bad++;
    }
  }
  ok(bad === 0, `no wrong notes: ${count} chords (8 scales, 12 keys, 7 degrees, 6 flavours, 4 voicings), ${bad} out of key`);
}
{ // the names
  const n = (k, s, d, f) => T.chord(k, s, d, f).name;
  ok([0, 1, 2, 3, 4, 5, 6].map((d) => n(0, "major", d, 0)).join(" ") === "C Dm Em F G Am Bdim", "C major's triads: C Dm Em F G Am Bdim");
  ok([0, 1, 2, 3, 4, 5, 6].map((d) => n(9, "minor", d, 0)).join(" ") === "Am Bdim C Dm Em F G", "A minor's triads: Am Bdim C Dm Em F G");
  ok(n(0, "major", 4, 1) === "G7" && n(0, "major", 0, 1) === "Cmaj7" && n(0, "major", 6, 1) === "Bm7b5" && n(9, "minor", 0, 1) === "Am7", "sevenths: G7, Cmaj7, Bm7b5, Am7");
  ok(n(0, "major", 1, 2) === "Dm9" && n(0, "major", 0, 3) === "Csus4" && n(0, "lydian", 0, 3) === "Csus2" && n(0, "major", 0, 4) === "C5", "Dm9, Csus4 (Csus2 in Lydian, no perfect fourth), C5");
  ok(n(0, "harmonic", 4, 1) === "G7" && n(0, "hijaz", 0, 0) === "C" && n(0, "hijaz", 1, 0) === "C#", "harmonic minor's V7, Hijaz's I and bII");
  ok(T.chord(0, "major", 0, 0).numeral === "I" && T.chord(0, "major", 1, 0).numeral === "ii" && T.chord(0, "major", 6, 0).numeral === "vii°", "numerals: I, ii, vii°");
}
{ // voicings and smooth changes
  const c = T.chord(0, "major", 0, 0, 0), i1 = T.chord(0, "major", 0, 0, 1), op = T.chord(0, "major", 0, 0, 3);
  ok(c.notes.join() === "48,52,55" && i1.notes.join() === "52,55,60" && op.notes.join() === "48,55,64", `C: close ${c.notes}, first inversion ${i1.notes}, open ${op.notes}`);
  let moves = 0, jumps = 0, prev = T.chord(0, "major", 0, 0).notes;
  for (const d of [3, 4, 0, 5, 1, 4, 0]) {                   // I IV V I vi ii V I, each nearest the last
    const nx = T.nearest(T.chord(0, "major", d, 0), prev).notes;
    const m = nx.reduce((s, x) => s + Math.min(...prev.map((p) => Math.abs(p - x))), 0); moves += m; jumps = Math.max(jumps, m); prev = nx;
  }
  ok(jumps <= 6, `smooth changes: no chord moves more than 6 semitones in all (worst ${jumps}, ${moves} over 7 changes)`);
  ok(T.degreeOf(0, "major", 61) === 0 || T.degreeOf(0, "major", 61) === 1, "a black key: the nearest degree");
  ok(T.degreeOf(9, "minor", 69) === 0 && T.degreeOf(9, "minor", 76) === 4, "A minor: A is i, E is v");
}

// ---- the sound
function load() {
  let Proc = null;
  const posted = [];
  class AudioWorkletProcessor { constructor() { this.port = { postMessage: (m) => posted.push(m), onmessage: null }; } }
  const ctx = vm.createContext({ AudioWorkletProcessor, registerProcessor: (n, c) => { Proc = c; }, sampleRate: SR, Math, Float32Array, Array, Object, console, Number });
  vm.runInContext(fs.readFileSync(path.join(HERE, "handwave-worklet.js"), "utf8"), ctx);
  const p = new Proc();
  const send = (m) => p.onMessage(m);
  const render = (secs) => {
    const n = Math.round((secs * SR) / BLOCK), L = new Float32Array(n * BLOCK), R = new Float32Array(n * BLOCK);
    for (let b = 0; b < n; b++) { const l = new Float32Array(BLOCK), r = new Float32Array(BLOCK); p.process([], [[l, r]]); L.set(l, b * BLOCK); R.set(r, b * BLOCK); }
    return { L, R };
  };
  return { p, send, render, posted };
}
const rms = (a, from = 0, to = a.length) => { let s = 0; for (let i = from; i < to; i++) s += a[i] * a[i]; return Math.sqrt(s / Math.max(1, to - from)); };
const peak = (a) => { let m = 0; for (const v of a) m = Math.max(m, Math.abs(v)); return m; };
const finite = (a) => a.every(Number.isFinite);
const pitch = (a, from, to, lo = 40, hi = 600) => {
  let best = 0, lag = 0;
  for (let T2 = Math.floor(SR / hi); T2 <= Math.ceil(SR / lo); T2++) { let s = 0; for (let i = from; i < to - T2; i++) s += a[i] * a[i + T2]; if (s > best) { best = s; lag = T2; } }
  return SR / lag;
};
const onsets = (a, win = 256, k = 2.2) => {            // where the level jumps
  const e = []; for (let i = 0; i + win <= a.length; i += win) e.push(rms(a, i, i + win));
  const out = []; for (let i = 2; i < e.length; i++) if (e[i] > e[i - 1] * k && e[i] > 0.01) out.push(i * win);
  return out;
};
console.log("Handwave: handwave-worklet.js");
{ const a = load(); ok(peak(a.render(0.5).L) < 1e-6, "nothing played: silence"); }
for (const sound of ["saw", "pluck", "stab", "keys"]) {      // each sound: a note at its pitch, bounded, and it stops
  const a = load(); a.send({ type: "params", p: { sound, delay: 0, verb: 0 } });
  a.send({ type: "chord", notes: [57], root: 57, vel: 0.9 });
  const { L } = a.render(0.6); a.send({ type: "release" });
  const tail = a.render(1.6).L;
  const f = pitch(L, 4000, 20000, 100, 600);
  ok(finite(L) && peak(L) < 1 && Math.abs(f - 220) < 8 && rms(L, 4000, 20000) > 0.02, `${sound}: A3 at ${f.toFixed(1)} Hz, level ${rms(L, 4000, 20000).toFixed(3)}, peak ${peak(L).toFixed(2)}`);
  ok(rms(tail, tail.length - 4410, tail.length) < 0.002, `${sound}: let go, it dies away (${rms(tail, tail.length - 4410, tail.length).toExponential(1)})`);
}
{ // a strum: the notes one after another
  const a = load(); a.send({ type: "params", p: { sound: "pluck", strum: 0.3, delay: 0, verb: 0 } });
  a.send({ type: "chord", notes: [48, 55, 64, 72], root: 48, vel: 0.9 });
  a.render(0.6);
  const counts = a.posted.filter((m) => m.type === "viz").map((m) => m.voices.length), first4 = counts.indexOf(4);
  ok(counts[0] <= 2 && first4 > 0 && first4 * 512 / SR > 0.15, `a strum: the notes start one after another (${counts.slice(0, 30).join("")}: all four after ${(first4 * 512 / SR * 1000).toFixed(0)} ms)`);
}
{ // the arpeggiator: notes at its rate
  const a = load(); a.send({ type: "params", p: { sound: "pluck", arp: "up", arpRate: 16, tempo: 120, delay: 0, verb: 0 } });
  a.send({ type: "chord", notes: [60, 64, 67], root: 60, vel: 0.9 });
  const on = onsets(a.render(2).L, 256, 1.6), per = (on[on.length - 1] - on[0]) / (on.length - 1) / SR;
  ok(on.length >= 12 && Math.abs(per - 0.125) < 0.02, `the arpeggiator: ${on.length} notes in 2 s, every ${(per * 1000).toFixed(0)} ms (a sixteenth at 120: 125)`);
}
{ // the groove: kicks four to the bar
  const a = load(); a.send({ type: "params", p: { drums: "house", tempo: 120, delay: 0, verb: 0 } }); a.send({ type: "play", on: true });
  const { L } = a.render(4.2);
  const kicks = a.posted.filter((m) => m.type === "viz" && m.kick).length;
  ok(finite(L) && peak(L) < 1 && rms(L) > 0.03, `the house groove sounds (level ${rms(L).toFixed(3)}, peak ${peak(L).toFixed(2)})`);
  ok(kicks >= 7 && kicks <= 9, `kicks on the beat: ${kicks} in two bars at 120`);
}
{ // the bass follows the chord's root
  const a = load(); a.send({ type: "params", p: { bass: "sub", delay: 0, verb: 0, chordVol: 0 } });
  a.send({ type: "chord", notes: [57, 60, 64], root: 57, vel: 0.8 });
  const { L } = a.render(0.8), f = pitch(L, 8000, 30000, 30, 200);
  ok(Math.abs(f - 55) < 3, `the sub bass on A's root: ${f.toFixed(1)} Hz (A1: 55)`);
  a.send({ type: "chord", notes: [53, 57, 60], root: 53, vel: 0.8 });
  const f2 = pitch(a.render(0.8).L, 8000, 30000, 30, 200);
  ok(Math.abs(f2 - 43.65) < 3, `then F's: ${f2.toFixed(1)} Hz (F1: 43.7)`);
}
{ // the chord memory: a chord a bar
  const a = load(); a.send({ type: "params", p: { tempo: 120, delay: 0, verb: 0, sound: "saw" } });
  a.send({ type: "prog", on: true, slots: [{ notes: [57, 60, 64], root: 57 }, null, { notes: [53, 57, 60], root: 53 }] });
  a.send({ type: "play", on: true });
  const seen = new Set(); for (let k = 0; k < 4; k++) { a.render(2); const v = a.posted.filter((m) => m.type === "viz"); seen.add(v[v.length - 1].prog); }
  ok(seen.has(0) && seen.has(2) && !seen.has(1), `the chord memory: slots ${[...seen].join(", ")} played in turn (the empty one skipped)`);
}
{ // the pump: the chords duck under each kick
  const a = load(); a.send({ type: "params", p: { drums: "house", pump: 1, tempo: 120, drumVol: 0, delay: 0, verb: 0, sound: "saw", attack: 0.003 } });
  a.send({ type: "play", on: true }); a.send({ type: "chord", notes: [60, 64, 67], root: 60, vel: 0.8 });
  const { L } = a.render(2.2), beat = SR / 2, w = 1024;
  const at = (t) => rms(L, Math.round(t), Math.round(t) + w);
  ok(at(beat * 2 + 300) < at(beat * 2 - 6000) * 0.6, `the pump: the pad ducks on the kick (${at(beat * 2 + 300).toFixed(3)} vs ${at(beat * 2 - 6000).toFixed(3)})`);
}
{ // everything at once: bounded, and faster than real time
  const a = load(); a.send({ type: "params", p: { drums: "techno", bass: "acid", arp: "updown", arpRate: 16, sound: "saw", delay: 0.5, verb: 0.6, pump: 0.6 } });
  a.send({ type: "play", on: true }); a.send({ type: "chord", notes: [57, 60, 64, 67, 71], root: 57, vel: 1 });
  const t0 = process.hrtime.bigint(), { L, R } = a.render(10), ms = Number(process.hrtime.bigint() - t0) / 1e6;
  ok(finite(L) && finite(R) && peak(L) < 1 && peak(R) < 1, `everything on: bounded (peak ${Math.max(peak(L), peak(R)).toFixed(2)})`);
  ok(ms < 4000, `10 s rendered in ${ms.toFixed(0)} ms (${(10000 / ms).toFixed(1)}x real time)`);
}
console.log(fails ? `FAIL (${fails})` : "PASS");
process.exit(fails ? 1 : 0);
