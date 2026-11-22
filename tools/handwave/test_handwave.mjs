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
const quiet = (a) => { a.send({ type: "hands", r: null, l: { x: 0, y: 0, z: 0 } }); };   // (rain, dry, calm: the least texture)
console.log("Handwave: handwave-worklet.js");
{ const a = load(); a.send(AM7); ok(peak(a.render(0.5).L) < 1e-6, "not started: silence"); }
{ // started, no hands: it drifts by itself, the pad on the chord's notes, swelling in slowly
  const a = load(); a.send(AM7); a.send({ type: "on", on: true });
  const early = a.render(0.4).L, later = a.render(4).L, v = a.last();
  ok(finite(later) && peak(later) < 1 && rms(later) > 0.02 && rms(early) < rms(later) * 0.5, `no hands: it drifts by itself, swelling in (${rms(early).toFixed(3)} then ${rms(later).toFixed(3)})`);
  ok(v.pad.length >= 3 && v.pad.every((n) => [9, 0, 4, 7].includes(n % 12)), `the pad: the chord's notes (${v.pad.join(" ")})`);
  a.render(12); const bells = a.bells();
  ok(bells.length >= 1 && bells.every((n) => [9, 11, 0, 2, 4, 5, 7].includes(n % 12)), `no hands: a bell now and then, in key (${bells.join(" ")})`);
}
{ // the right hand: nearer, louder; and the melody comes
  const a = load(); a.send(AM7); a.send({ type: "on", on: true }); quiet(a); a.render(5);
  const far = rms(a.render(2).L);
  a.send({ type: "hands", r: { x: 0.5, y: 0.5, z: 1 }, l: { x: 0, y: 0, z: 0 } }); a.render(1.5); a.posted.length = 0;
  const nearL = a.render(4).L, near = rms(nearL), mel = a.notes();
  ok(near > far * 1.4, `right hand near the camera: it swells (${far.toFixed(3)} -> ${near.toFixed(3)})`);
  ok(mel.length >= 5 && mel.every((n) => [9, 11, 0, 2, 4, 5, 7].includes(n % 12)), `right hand: a melody, every note in key (${mel.length} in 4 s: ${mel.slice(0, 10).join(" ")})`);
  a.send({ type: "hands", r: null, l: { x: 0, y: 0, z: 0 } }); a.render(5);
  ok(rms(a.render(2).L) < near * 0.8, "right hand gone: it settles back");
}
{ // the right hand's height: low, low notes and dark; high, high and bright
  const run = (y) => { const a = load(); a.send(AM7); a.send({ type: "on", on: true }); a.send({ type: "hands", r: { x: 0.5, y, z: 0.8 }, l: { x: 0, y: 0, z: 0 } }); a.render(3); a.posted.length = 0;
    const { L } = a.render(5), ns = a.notes(), v = a.last(); return { mel: ns.reduce((s, n) => s + n, 0) / Math.max(1, ns.length), pad: Math.min(...v.pad), bright: above(L, 2000) / Math.max(1e-9, rms(L)) }; };
  const lo = run(0.05), hi = run(0.95);
  ok(hi.mel > lo.mel + 10 && hi.pad > lo.pad, `right hand high: the melody higher (${lo.mel.toFixed(0)} -> ${hi.mel.toFixed(0)}), the pad an octave up (${lo.pad} -> ${hi.pad})`);
  ok(hi.bright > lo.bright * 1.5, `and brighter (the share above 2 kHz ${lo.bright.toFixed(3)} -> ${hi.bright.toFixed(3)})`);
}
{ // a new chord: a new pad
  const a = load(); a.send(AM7); a.send({ type: "on", on: true }); a.render(2);
  a.send({ type: "chord", notes: [53, 57, 60, 64], root: 53, scale: [0, 2, 3, 5, 7, 8, 10], key: 9 }); a.render(0.2);
  const v = a.last(); ok(v.pad.length >= 3 && v.pad.every((n) => [5, 9, 0, 4].includes(n % 12)), `another chord: the pad moves to it (${v.pad.join(" ")})`);
}
{ // the left hand: the textures, crossfaded; the space; the weather
  const tex = (x, z = 0.3) => { const a = load(); a.send({ type: "on", on: true }); a.send({ type: "hands", r: null, l: { x, y: 0.3, z } }); a.render(2); const { L } = a.render(6); return L; };
  const lv = [0, 1 / 3, 2 / 3, 1].map((x) => tex(x));
  ok(lv.every((L) => finite(L) && peak(L) < 0.95 && rms(L) > 0.002), `left hand across: rain, the sea, wind, birds, each there (${lv.map((L) => rms(L).toFixed(4)).join(", ")})`);
  const calm = rms(tex(2 / 3, 0)), storm = rms(tex(2 / 3, 1));
  ok(storm > calm * 1.6, `left hand near: the weather turns (wind ${calm.toFixed(4)} calm, ${storm.toFixed(4)} in a storm)`);
  const verb = (y) => { const a = load(); a.send(AM7); a.send({ type: "on", on: true }); a.send({ type: "hands", r: null, l: { x: 0, y, z: 0 } }); a.render(4); a.send({ type: "on", on: false }); a.render(0.05); const { L } = a.render(0.25); return rms(L); };
  const dry = verb(0), wet = verb(1);
  ok(wet > dry * 1.5, `left hand high: more space (the tail ${dry.toFixed(4)} dry, ${wet.toFixed(4)} vast)`);
}
{ // stopped: it fades out
  const a = load(); a.send(AM7); a.send({ type: "on", on: true }); a.render(4); a.send({ type: "on", on: false });
  const { L } = a.render(8); ok(rms(L, L.length - 4410) < 0.002, `stopped: it fades away (${rms(L, L.length - 4410).toExponential(1)})`);
}
{ // everything at once: bounded, and faster than real time
  const a = load(); a.send(AM7); a.send({ type: "on", on: true }); a.send({ type: "hands", r: { x: 0.5, y: 0.8, z: 1 }, l: { x: 0.5, y: 1, z: 1 } });
  const t0 = process.hrtime.bigint(), { L, R } = a.render(10), ms = Number(process.hrtime.bigint() - t0) / 1e6;
  ok(finite(L) && finite(R) && peak(L) < 1 && peak(R) < 1, `everything on (both hands near, a storm, vast): bounded (peak ${Math.max(peak(L), peak(R)).toFixed(2)})`);
  ok(ms < 7000, `10 s rendered in ${ms.toFixed(0)} ms (${(10000 / ms).toFixed(1)}x real time)`);
}
console.log(fails ? `FAIL (${fails})` : "PASS");
process.exit(fails ? 1 : 0);
