// SPDX-License-Identifier: GPL-3.0-only
// Acid Flower's power-on sounds, made here sample by sample (no recordings): the boot's soundtrack, laid out on the
// boot animation's own clock (rave.js bootScene), and a short "enter" for the Start button. Each returns a stereo pair
// of Float32Arrays; acid.js plays them through the page's AudioContext. test_acid.mjs checks them.
//   0.08 s  the CRT: a thump, a high whine          0.38 s  the line opening: a zap; static to 0.9 s
//   0.95 s  the BIOS: a key click for every letter, a beep for every OK; a modem's chirps under the loading bar
//   2.2 s   the flower forming: a rising whoosh     3.3 s   the name: a glitch blip for every letter
//   3.8 s   SYSTEM READY: an acid chord stab and a kick
"use strict";
(() => {
  const BIOS = [["ACIDFLOWER BIOS 1.0", ""], ["CORE: SQUELCH UNIT X1", "OK"], ["MEMORY 4096K", "OK"], ["OSCILLATORS SAW SQR", "OK"],
                ["LADDER FILTER 24DB", "OK"], ["RESONANCE CALIBRATE", "OK"], ["SEQUENCER 16 STEPS", "OK"], ["DRUM BANK 5 VOICES", "OK"],
                ["PUNCH-IN FX 12", "OK"], ["MOUNT /DEV/RAVE", "OK"], ["LOADING ACID.SYS", ""]];
  const READY = 3.8;
  let seed = 12345;
  const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };

  function bootSound(sr) {
    seed = 12345;
    const n = Math.ceil(sr * 5.4), L = new Float32Array(n), R = new Float32Array(n);
    const add = (t, f) => { const i0 = Math.round(t * sr); for (let i = 0; i < n - i0; i++) { const v = f(i / sr, i); if (v === null) break; const [l, r] = v; L[i0 + i] += l; R[i0 + i] += r; } };
    const mono = (g) => (x) => [x * g[0], x * g[1]];
    // the CRT: a low thump, then the high whine of a tube warming
    add(0.08, (t) => (t > 0.4 ? null : mono([0.55, 0.55])(Math.sin(2 * Math.PI * (48 + 40 * Math.exp(-t * 30)) * t) * Math.exp(-t * 9))));
    add(0.1, (t) => (t > 0.85 ? null : mono([0.012, 0.012])(Math.sin(2 * Math.PI * 7800 * t) * Math.min(1, t * 20) * (1 - t / 0.85))));
    // the line opening: a zap sweeping up; then static
    add(0.38, (t) => { if (t > 0.3) return null; const f = 200 + 2200 * (t / 0.3); return mono([0.12, 0.12])(((t * f) % 1) * 2 - 1) .map((v) => v * Math.exp(-t * 6)); });
    let lp = 0;
    add(0.42, (t) => { if (t > 0.48) return null; lp += (rnd() * 2 - 1 - lp) * 0.35; const e = Math.min(1, t * 12) * (1 - t / 0.48); return [lp * 0.22 * e, lp * 0.2 * e]; });
    // the BIOS: a key click for every letter (60 a second), a beep for each OK; the modem's chirps under the bar
    BIOS.forEach(([line, ok], i) => {
      const t0 = 0.95 + i * 0.12;
      for (let k = 0; k < line.length; k++) {
        const pan = 0.5 + (rnd() - 0.5) * 0.6, amp = 0.05 + rnd() * 0.03;
        let hp = 0, prev = 0;
        add(t0 + k / 60, (t) => { if (t > 0.006) return null; const x = rnd() * 2 - 1; hp = 0.6 * (hp + x - prev); prev = x; const v = hp * amp * Math.exp(-t * 700); return [v * (1 - pan) * 2, v * pan * 2]; });
      }
      if (ok) add(t0 + 0.12, (t) => (t > 0.045 ? null : mono([0.035, 0.035])((Math.sin(2 * Math.PI * 1568 * t) > 0 ? 1 : -1) * (1 - t / 0.045))));
      if (i === BIOS.length - 1) {
        const tb = t0 + line.length / 60 + 0.25;
        add(tb, (t) => { if (t > 0.5) return null; const f = Math.floor(t * 40) % 2 ? 1200 : 2200, e = Math.min(1, t * 30) * (1 - t / 0.5); return mono([0.03, 0.03])(Math.sin(2 * Math.PI * f * t) * e); });
      }
    });
    // the flower forming: noise through a band rising, and a swelling rising tone
    let b1 = 0, b2 = 0;
    add(2.2, (t) => {
      if (t > 1.55) return null;
      const f = 300 * Math.pow(14, t / 1.55), w = Math.min(0.95, (2 * Math.PI * f) / sr), q = 0.18;
      const x = rnd() * 2 - 1; b1 += w * (x - b1 - b2 * q); b2 += w * b1;
      const e = Math.pow(t / 1.55, 1.6) * (t > 1.45 ? (1.55 - t) / 0.1 : 1), tone = Math.sin(2 * Math.PI * (110 + 330 * (t / 1.55) ** 2) * t);
      return [(b2 * 0.5 + tone * 0.05) * e, (b2 * 0.45 + tone * 0.05) * e];
    });
    // the name: a glitch blip as each letter lands (22 a second, 11 letters)
    for (let k = 0; k < 11; k++) {
      const f = [523, 659, 784, 1047, 880, 698, 587, 1175, 988, 784, 1319][k], pan = (k / 10);
      add(3.3 + k / 22, (t) => { if (t > 0.03) return null; const crushed = Math.round(Math.sin(2 * Math.PI * f * t) * 3) / 3; const v = crushed * 0.045 * (1 - t / 0.03); return [v * (1.2 - pan), v * (0.2 + pan)]; });
    }
    // SYSTEM READY: a kick and an acid chord stab, its filter closing
    add(READY, (t) => (t > 0.5 ? null : mono([0.5, 0.5])(Math.sin(2 * Math.PI * (45 + 120 * Math.exp(-t * 35)) * t) * Math.exp(-t * 7))));
    const notes = [57, 60, 64, 69, 72].map((m) => 440 * Math.pow(2, (m - 69) / 12));
    let y1 = 0, y2 = 0;
    add(READY, (t) => {
      if (t > 1.5) return null;
      let s = 0;
      for (const f of notes) s += ((t * f) % 1) * 2 - 1 + (((t * f * 1.004) % 1) * 2 - 1);
      s /= notes.length * 2;
      const fc = 180 + 5200 * Math.exp(-t * 4.5), g = Math.min(0.9, (2 * Math.PI * fc) / sr);
      y1 += g * (s - y1 - y2 * 0.5); y2 += g * y1;            // (a resonant two-pole, bright then closing)
      const e = Math.min(1, t * 200) * Math.exp(-t * 2.2);
      return [y2 * 0.55 * e, y2 * 0.5 * e];
    });
    for (let i = 0; i < n; i++) { L[i] = Math.tanh(L[i] * 1.2); R[i] = Math.tanh(R[i] * 1.2); }
    return [L, R];
  }

  // Start the machine: a zap falling into a kick
  function enterSound(sr) {
    const n = Math.ceil(sr * 0.7), L = new Float32Array(n), R = new Float32Array(n);
    let ph = 0;
    for (let i = 0; i < n; i++) {
      const t = i / sr;
      ph += (1800 * Math.exp(-t * 14) + 60) / sr;
      const zap = ((ph % 1) * 2 - 1) * 0.12 * Math.exp(-t * 10);
      const kick = t > 0.12 ? Math.sin(2 * Math.PI * (45 + 110 * Math.exp(-(t - 0.12) * 35)) * (t - 0.12)) * 0.5 * Math.exp(-(t - 0.12) * 7) : 0;
      L[i] = Math.tanh(zap + kick); R[i] = Math.tanh(zap * 0.8 + kick);
    }
    return [L, R];
  }

  globalThis.AcidBootSound = { bootSound, enterSound, READY };
})();
