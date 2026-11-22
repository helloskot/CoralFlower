// SPDX-License-Identifier: GPL-3.0-only
// Handwave's music theory: a key and a scale, and from them the chords that belong. Every chord is built by stacking
// the scale's own notes, so whatever degree and flavour you pick, nothing is out of key. Used by the page
// (handwave.js) and by the tests (test_handwave.mjs, in node).
"use strict";
(() => {
  const NAMES = ["C", "C#", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"];
  // seven-note scales (a chord needs seven notes to stack on)
  const SCALES = {
    major: { name: "Major", steps: [0, 2, 4, 5, 7, 9, 11] },
    minor: { name: "Minor", steps: [0, 2, 3, 5, 7, 8, 10] },
    dorian: { name: "Dorian", steps: [0, 2, 3, 5, 7, 9, 10] },
    harmonic: { name: "Harmonic minor", steps: [0, 2, 3, 5, 7, 8, 11] },
    hijaz: { name: "Hijaz", steps: [0, 1, 4, 5, 7, 8, 10] },
  };
  // the flavours, in the order the hand counts them (a fist, then one finger up, two, three, four, an open hand)
  const FLAVOURS = [
    { id: "triad", name: "Triad", stack: [0, 2, 4] },
    { id: "seventh", name: "7th", stack: [0, 2, 4, 6] },
    { id: "ninth", name: "9th", stack: [0, 2, 4, 6, 8] },
    { id: "sus", name: "Sus", stack: null },            // (the third swapped for the fourth, or the second if the fourth isn't perfect)
    { id: "power", name: "Power", stack: [0, 4, 7] },     // (root, fifth, octave)
    { id: "wide", name: "Wide", stack: [0, 4, 7, 9, 10] }, // (an open 11th: root, fifth, octave, the third and the fourth above)
  ];
  const ROMAN = ["I", "II", "III", "IV", "V", "VI", "VII"];
  const mod = (a, n) => ((a % n) + n) % n;

  // the semitones of the scale's k-th note above degree d (k can pass the octave)
  const above = (steps, d, k) => steps[mod(d + k, 7)] + 12 * Math.floor((d + k) / 7) - steps[d];

  // what kind of triad sits on a degree: from its third and fifth
  function quality(steps, d) {
    const third = above(steps, d, 2), fifth = above(steps, d, 4);
    if (third === 3 && fifth === 6) return "dim";
    if (third === 4 && fifth === 8) return "aug";
    return third === 3 ? "min" : "maj";
  }

  // a chord: key (0..11), scale id, degree (0..6), flavour (0..5), voicing (0: close, 1: first inversion, 2: second,
  // 3: open), octave shift; its notes as MIDI numbers (root near C3), its name and its numeral
  function chord(key, scale, degree, flavour, voicing = 0, octave = 0) {
    const steps = (SCALES[scale] || SCALES.minor).steps, d = mod(degree, 7), fl = FLAVOURS[mod(flavour, 6)];
    let root = 48 + mod(key, 12) + steps[d] + 12 * octave;
    if (root - 12 * octave > 59) root -= 12;
    let ks = fl.stack;
    if (!ks) ks = above(steps, d, 3) === 5 ? [0, 3, 4] : [0, 1, 4];
    let notes = ks.map((k) => root + above(steps, d, k));
    // voicings: inversions lift the lowest note(s) an octave; open spreads the second note up an octave
    const v = mod(voicing, 4);
    if (v === 1 || v === 2) for (let i = 0; i < v && i < notes.length - 1; i++) { notes.sort((a, b) => a - b); notes[0] += 12; }
    if (v === 3 && notes.length >= 3) { notes.sort((a, b) => a - b); notes[1] += 12; }
    notes.sort((a, b) => a - b);
    return { root, notes, name: chordName(steps, d, fl.id, key), numeral: numeral(steps, d), quality: quality(steps, d) };
  }

  function numeral(steps, d) {
    const q = quality(steps, d), r = ROMAN[d];
    return q === "maj" ? r : q === "aug" ? r + "+" : q === "dim" ? r.toLowerCase() + "°" : r.toLowerCase();
  }

  function chordName(steps, d, fl, key) {
    const n = NAMES[mod(key + steps[d], 12)], q = quality(steps, d), sev = above(steps, d, 6);
    const tri = q === "min" ? "m" : q === "dim" ? "dim" : q === "aug" ? "+" : "";
    if (fl === "triad") return n + tri;
    if (fl === "power") return n + "5";
    if (fl === "sus") return n + (above(steps, d, 3) === 5 ? "sus4" : "sus2");
    if (fl === "wide") return n + (q === "min" ? "m" : "") + "(11)";
    // sevenths and ninths: the seventh's size says which
    let s;
    if (q === "maj") s = sev === 11 ? "maj7" : "7";
    else if (q === "min") s = sev === 11 ? "m(maj7)" : "m7";
    else if (q === "dim") s = sev === 9 ? "dim7" : "m7b5";
    else s = sev === 11 ? "+maj7" : "+7";
    if (fl === "seventh") return n + s;
    return n + s.replace("7", "9");
  }

  // the voicing nearest the last chord (each note as close as it can be to one of the last chord's), for smooth changes
  function nearest(c, prev) {
    if (!prev || !prev.length) return c;
    const base = [...c.notes].sort((x, y) => x - y), n = base.length;
    const cost = (ns) => ns.reduce((s, x) => s + Math.min(...prev.map((p) => Math.abs(p - x))), 0) + Math.abs(ns[0] - Math.min(...prev)) * 0.5;
    let best = base, bc = Infinity;
    for (let inv = 0; inv < n; inv++) for (const sh of [-12, 0, 12]) {
      const ns = base.map((x, i) => (i < inv ? x + 12 : x) + sh).sort((x, y) => x - y);
      if (ns[0] < 40 || ns[n - 1] > 88) continue;
      const k = cost(ns); if (k < bc) { bc = k; best = ns; }
    }
    return { ...c, notes: best };
  }

  // a MIDI note to the scale degree it's nearest (for a keyboard: every key plays a chord that fits)
  function degreeOf(key, scale, midi) {
    const steps = (SCALES[scale] || SCALES.minor).steps, pc = mod(midi - key, 12);
    let best = 0, bd = 99;
    steps.forEach((s, i) => { const dd = Math.min(Math.abs(s - pc), 12 - Math.abs(s - pc)); if (dd < bd) { bd = dd; best = i; } });
    return best;
  }

  const api = { NAMES, SCALES, FLAVOURS, ROMAN, chord, nearest, degreeOf, quality: (scale, d) => quality(SCALES[scale].steps, d) };
  if (typeof globalThis !== "undefined") globalThis.HWTheory = api;
})();
