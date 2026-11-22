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
  ok(bad === 0, `no wrong notes: ${count} chords (5 scales, 12 keys, 7 degrees, 6 flavours, 4 voicings), ${bad} out of key`);
}
{ // the names
  const n = (k, s, d, f) => T.chord(k, s, d, f).name;
  ok([0, 1, 2, 3, 4, 5, 6].map((d) => n(0, "major", d, 0)).join(" ") === "C Dm Em F G Am Bdim", "C major's triads: C Dm Em F G Am Bdim");
  ok([0, 1, 2, 3, 4, 5, 6].map((d) => n(9, "minor", d, 0)).join(" ") === "Am Bdim C Dm Em F G", "A minor's triads: Am Bdim C Dm Em F G");
  ok(n(0, "major", 4, 1) === "G7" && n(0, "major", 0, 1) === "Cmaj7" && n(0, "major", 6, 1) === "Bm7b5" && n(9, "minor", 0, 1) === "Am7", "sevenths: G7, Cmaj7, Bm7b5, Am7");
  ok(n(0, "major", 1, 2) === "Dm9" && n(0, "major", 0, 3) === "Csus4" && n(0, "major", 3, 3) === "Fsus2" && n(0, "major", 0, 4) === "C5", "Dm9, Csus4 (Fsus2 on IV: no perfect fourth there), C5");
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
  const last = () => { const v = posted.filter((m) => m.type === "viz"); return v[v.length - 1]; };
  const notes = () => posted.filter((m) => m.type === "viz").flatMap((m) => m.notes), bells = () => posted.filter((m) => m.type === "viz").flatMap((m) => m.bells);
  return { p, send, render, posted, last, notes, bells };
}
const rms = (a, from = 0, to = a.length) => { let s = 0; for (let i = from; i < to; i++) s += a[i] * a[i]; return Math.sqrt(s / Math.max(1, to - from)); };
const peak = (a) => { let m = 0; for (const v of a) m = Math.max(m, Math.abs(v)); return m; };
const finite = (a) => a.every(Number.isFinite);
// a band's energy: a one-pole split at hz (above, or below)
const above = (a, hz) => { const k = 1 - Math.exp(-2 * Math.PI * hz / SR); let lp = 0, s = 0; for (const x of a) { lp += (x - lp) * k; s += (x - lp) ** 2; } return Math.sqrt(s / a.length); };
const AM7 = { type: "chord", notes: [57, 60, 64, 67], root: 57, scale: [0, 2, 3, 5, 7, 8, 10], key: 9 };
const IN_AM = [9, 11, 0, 2, 4, 5, 7];
const vizs = (a) => a.posted.filter((m) => m.type === "viz");
const sum = (a, k) => vizs(a).reduce((s, m) => s + m[k], 0), kicks = (a) => sum(a, "kick"), stabs = (a) => vizs(a).reduce((s, m) => s + m.stab, 0);
const left = (x, y = 0.4, z = 0.4) => ({ type: "hands", r: null, l: { x, y, z } });
console.log("Handwave: handwave-worklet.js");
{ const a = load(); a.send(AM7); ok(peak(a.render(0.5).L) < 1e-6, "not started: silence"); }
{ // started, no hands: it plays by itself, the pad on the chord, the groove four to the floor
  const a = load(); a.send(AM7); a.send({ type: "params", p: { tempo: 120 } }); a.send({ type: "on", on: true });
  const { L } = a.render(4.1), v = a.last();
  ok(finite(L) && peak(L) < 1 && rms(L) > 0.03, `no hands: it plays by itself (level ${rms(L).toFixed(3)}, peak ${peak(L).toFixed(2)})`);
  ok(v.pad.length >= 3 && v.pad.every((n) => [9, 0, 4, 7].includes(n % 12)), `the pad: the chord's notes (${v.pad.join(" ")})`);
  ok(kicks(a) >= 7 && kicks(a) <= 9, `four to the floor: ${kicks(a)} kicks in two bars at 120`);
  ok(stabs(a) >= 2, `dub chord stabs: ${stabs(a)} in two bars`);
}
{ // the left hand across: the groove builds, from the pad alone to everything
  const run = (x) => { const a = load(); a.send(AM7); a.send({ type: "on", on: true }); a.send(left(x)); a.render(1); a.posted.length = 0; const { L } = a.render(4); return { k: kicks(a), s: stabs(a), h: sum(a, "hats"), b: sum(a, "bass"), lo: rms(L) }; };
  const none = run(0), mid = run(0.42), full = run(1);
  ok(none.k === 0 && none.s === 0, `left hand at the left: no beat, the pad alone (${none.k} kicks, ${none.s} stabs)`);
  ok(mid.k >= 7 && mid.s >= 2, `the middle: the kick and the stabs (${mid.k} kicks, ${mid.s} stabs)`);
  ok(mid.h >= 7 && mid.b === 0 && full.h > mid.h * 2.5 && full.b >= 12, `further right: the hats, then the shaker and the bass (hats ${mid.h} -> ${full.h}, bass notes ${mid.b} -> ${full.b} in two bars)`);
}
{ // the left hand nearer: the filter opens
  const run = (z) => { const a = load(); a.send(AM7); a.send({ type: "on", on: true }); a.send(left(0.8, 0.4, z)); a.render(2); const { L } = a.render(4); return above(L, 2500) / rms(L); };
  const shut = run(0), open = run(1);
  ok(open > shut * 1.5, `left hand near: the filter opens (the share above 2.5 kHz ${shut.toFixed(3)} -> ${open.toFixed(3)})`);
}
{ // the left hand high: the dub echo and the reverb, a longer tail
  const verb = (y) => { const a = load(); a.send(AM7); a.send({ type: "on", on: true }); a.send(left(0.55, y, 0.5)); a.render(4); a.send({ type: "on", on: false }); a.render(0.1); return rms(a.render(0.3).L); };
  const dry = verb(0), wet = verb(1);
  ok(wet > dry * 1.5, `left hand high: more space (the tail ${dry.toFixed(4)} dry, ${wet.toFixed(4)} vast)`);
}
{ // the right hand: nearer, a swell and an arpeggio in time, in key; higher, higher notes
  const run = (y, z, lx = 0.55) => { const a = load(); a.send(AM7); a.send({ type: "on", on: true }); a.send({ type: "hands", r: { x: 0.5, y, z }, l: { x: lx, y: 0.4, z: 0.4 } }); a.render(2); a.posted.length = 0; const { L } = a.render(4); const ns = a.notes(); return { n: ns, avg: ns.reduce((s, x) => s + x, 0) / Math.max(1, ns.length), lv: rms(L), pad: Math.min(...a.last().pad) }; };
  const far = run(0.5, 0), near = run(0.5, 1), lo = run(0.05, 0.8), hi = run(0.95, 0.8), farQ = run(0.5, 0, 0), nearQ = run(0.5, 1, 0);
  ok(far.n.length === 0 && near.n.length >= 16, `right hand near: an arpeggio (${far.n.length} notes far, ${near.n.length} near in 4 s)`);
  ok(near.n.every((x) => [9, 0, 4, 7].includes(x % 12)), `the arpeggio: the chord's notes (${near.n.slice(0, 8).join(" ")})`);
  ok(nearQ.lv > farQ.lv * 1.4, `and it swells (with no beat: ${farQ.lv.toFixed(3)} -> ${nearQ.lv.toFixed(3)})`);
  ok(hi.avg > lo.avg + 12 && hi.pad > lo.pad, `right hand high: higher (the arpeggio ${lo.avg.toFixed(0)} -> ${hi.avg.toFixed(0)}, the pad ${lo.pad} -> ${hi.pad})`);
}
{ // a new chord: a new pad, the stabs and the bass follow
  const a = load(); a.send(AM7); a.send({ type: "on", on: true }); a.render(2);
  a.send({ type: "chord", notes: [53, 57, 60, 64], root: 53, scale: [0, 2, 3, 5, 7, 8, 10], key: 9 }); a.render(0.2);
  const v = a.last(); ok(v.pad.length >= 3 && v.pad.every((n) => [5, 9, 0, 4].includes(n % 12)), `another chord: the pad moves to it (${v.pad.join(" ")})`);
}
{ // the body: dancing builds the groove (no left hand); the face: an open mouth opens it up
  const a = load(); a.send(AM7); a.send({ type: "on", on: true }); a.send(left(0)); a.render(1); a.send({ type: "hands", r: null, l: null, b: { dance: 1, arms: 0 } }); a.render(3); a.posted.length = 0; a.render(4);
  ok(kicks(a) >= 7, `dancing: the groove comes in with no hands (${kicks(a)} kicks in two bars)`);
  const m = (mouth) => { const b = load(); b.send(AM7); b.send({ type: "on", on: true }); b.send({ type: "hands", r: null, l: { x: 0, y: 0.4, z: 0.4 }, f: { mouth } }); b.render(2); const { L } = b.render(3); return above(L, 1500) / rms(L); };
  const shut = m(0), open = m(1);
  ok(open > shut * 1.2, `an open mouth: brighter (${shut.toFixed(3)} -> ${open.toFixed(3)})`);
}
{ // the tempo: as the page sets it
  const a = load(); a.send(AM7); a.send({ type: "params", p: { tempo: 126 } }); a.send({ type: "on", on: true }); a.render(0.05); a.posted.length = 0; a.render(3.81);
  ok(kicks(a) === 8, `126 BPM: 8 kicks in 3.8 s (${kicks(a)})`);
}
{ // stopped: it fades out
  const a = load(); a.send(AM7); a.send({ type: "on", on: true }); a.render(4); a.send({ type: "on", on: false });
  const { L } = a.render(8); ok(rms(L, L.length - 4410) < 0.002, `stopped: it fades away (${rms(L, L.length - 4410).toExponential(1)})`);
}
{ // everything at once: bounded, and faster than real time
  const a = load(); a.send(AM7); a.send({ type: "on", on: true }); a.send({ type: "hands", r: { x: 0.5, y: 0.8, z: 1 }, l: { x: 1, y: 1, z: 1 }, f: { mouth: 1 }, b: { dance: 1, arms: 1 } });
  const t0 = process.hrtime.bigint(), { L, R } = a.render(10), ms = Number(process.hrtime.bigint() - t0) / 1e6;
  ok(finite(L) && finite(R) && peak(L) < 1 && peak(R) < 1, `everything on: bounded (peak ${Math.max(peak(L), peak(R)).toFixed(2)})`);
  ok(ms < 7000, `10 s rendered in ${ms.toFixed(0)} ms (${(10000 / ms).toFixed(1)}x real time)`);
}
console.log(fails ? `FAIL (${fails})` : "PASS");
process.exit(fails ? 1 : 0);
