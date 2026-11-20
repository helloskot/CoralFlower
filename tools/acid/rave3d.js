// SPDX-License-Identifier: GPL-3.0-only
// Acid Flower's 3D rave: scenes drawn with WebGL2 at the rave's own size (150 pixels tall, 240 to 560 wide), read back
// into its picture, so the punch-ins, the VJ, the scanlines, the words and the HUD go over them like the rest.
// DATA CITY (a flight between towers of scrolling glyphs; the steps light the floors, the bass sends pulses up),
// GRID DIVE (wireframe cyberspace; packets on the hats, banking on the filter), VIRUS (a lattice the squelch infects;
// REVERSE and TAPE STOP heal it), FILE SYSTEM (down corridors of files; each bass note opens one), ANTIGRAV (anti-gravity
// racers on a neon track, the camera cutting every 4 bars), FRACTAL and CHROME (raymarched: a folding corridor, liquid
// chrome), SKYFLIGHT (Drift's: slow flight over hills under a sky the weather makes). And a game: RACE, the same track
// built from the pattern, its notes the orbs to catch, its accents the boost pads, its claps the barriers.
// No WebGL2: nothing is added, and the 2D scenes carry on alone.
"use strict";
(() => {
  const R = globalThis.AcidRave;
  if (!R || !R.addScene || typeof document === "undefined") return;
  {                                                       // (WebGL2 here at all?)
    let ok = false;
    try { const c = document.createElement("canvas"), g = c.getContext("webgl2"); ok = !!g; const lx = g && g.getExtension("WEBGL_lose_context"); if (lx) lx.loseContext(); } catch (e) { ok = false; }
    if (!ok) return;
  }
  const { pal, clamp, H } = R.util;
  const TAU = Math.PI * 2, rnd = Math.random;
  const col = (i, k = 1) => { const c = pal(i); return [c[0] / 255 * k, c[1] / 255 * k, c[2] / 255 * k]; };
  const hash = (a, b) => { let h = (a * 374761393 + b * 668265263) | 0; h = (h ^ (h >>> 13)) * 1274126177; return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };
  const mulberry = (a) => () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };

  // ---------------------------------------------------------------------------------------- vectors, matrices ---
  const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]], sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const mul = (a, k) => [a[0] * k, a[1] * k, a[2] * k], dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const norm = (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
  const mad = (a, b, k) => [a[0] + b[0] * k, a[1] + b[1] * k, a[2] + b[2] * k];
  const lerp3 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
  const ID = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
  const persp = (fy, asp, n, f) => { const t = 1 / Math.tan(fy / 2), m = new Float32Array(16); m[0] = t / asp; m[5] = t; m[10] = (f + n) / (n - f); m[11] = -1; m[14] = (2 * f * n) / (n - f); return m; };
  const mmul = (a, b) => { const o = new Float32Array(16); for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) { let s = 0; for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k]; o[c * 4 + r] = s; } return o; };
  const lookAt = (e, t, up) => {
    const z = norm(sub(e, t)), x = norm(cross(up, z)), y = cross(z, x);
    return new Float32Array([x[0], y[0], z[0], 0, x[1], y[1], z[1], 0, x[2], y[2], z[2], 0, -dot(x, e), -dot(y, e), -dot(z, e), 1]);
  };
  const frameM = (p, x, y, z) => new Float32Array([x[0], x[1], x[2], 0, y[0], y[1], y[2], 0, z[0], z[1], z[2], 0, p[0], p[1], p[2], 1]);
  const rotYX = (ay, ax) => { const cy = Math.cos(ay), sy = Math.sin(ay), cx = Math.cos(ax), sx = Math.sin(ax); return frameM([0, 0, 0], [cy, 0, -sy], [sy * sx, cx, cy * sx], [sy * cx, -sx, cy * cx]); };
  const xform = (m, p) => [m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12], m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13], m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14]];

  // ------------------------------------------------------------------------------------------------ shaders ---
  const MESH_VS = `#version 300 es
layout(location=0) in vec3 aPos; layout(location=1) in vec3 aNrm; layout(location=2) in vec3 aCol; layout(location=3) in float aEm;
layout(location=4) in vec4 iA; layout(location=5) in vec4 iB; layout(location=6) in vec4 iC;
uniform mat4 uVP; uniform mat4 uM;
out vec3 vCol; out vec3 vN; out vec3 vW; out float vEm; out vec3 vB;
void main() {
  vB = aPos;
  float c = cos(iB.z), s = sin(iB.z);
  vec3 p = aPos * vec3(iB.x, iA.w, iB.y);
  p = vec3(c * p.x + s * p.z, p.y, -s * p.x + c * p.z);
  vec3 n = vec3(c * aNrm.x + s * aNrm.z, aNrm.y, -s * aNrm.x + c * aNrm.z);
  vec4 w = uM * vec4(p + iA.xyz, 1.0);
  vW = w.xyz; vN = mat3(uM) * n; vCol = aCol * iC.rgb; vEm = aEm < -0.5 ? aEm : max(aEm, iC.a);
  gl_Position = uVP * w;
}`;
  const MESH_FS = `#version 300 es
precision highp float;
in vec3 vCol; in vec3 vN; in vec3 vW; in float vEm; in vec3 vB;
uniform vec3 uFog; uniform float uFogD; uniform vec3 uLt; uniform vec3 uEye; uniform int uMode; uniform float uT; uniform float uMul;
out vec4 o;
float h21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
void main() {
  float nn = dot(vN, vN);
  vec3 n = nn > 1e-4 ? normalize(vN) : vec3(0.0, 1.0, 0.0);
  float lam = nn > 1e-4 ? 0.3 + 0.7 * abs(dot(n, uLt)) : 1.0;
  vec3 c = vCol * mix(lam, 1.0, clamp(vEm, 0.0, 1.0)) * (1.0 + max(vEm - 1.0, 0.0));
  float d = length(vW - uEye);
  if (vEm < -0.5) {                                    // a wet road: the sky's glow in it, more at a glancing angle
    vec3 vd = normalize(vW - uEye); float fr = pow(1.0 - abs(dot(n, vd)), 4.0);
    c = vCol * lam + uFog * (0.12 + fr * 1.0) + vec3(0.6, 0.7, 1.0) * fr * 0.12;
  }
  if (uMode == 1 && abs(n.y) < 0.5) {                  // windows of light, the data climbing them column by column
    vec2 uv = vec2(abs(n.x) > 0.5 ? vW.z : vW.x, vW.y) / vec2(1.1, 1.4);
    vec2 cell = floor(uv), f = fract(uv);
    float rate = 1.5 + h21(vec2(cell.x, 7.0)) * 5.0;
    float on = step(0.62, h21(vec2(cell.x, floor(cell.y - uT * rate))));
    float win = step(0.3, f.x) * step(f.x, 0.7) * step(0.35, f.y) * step(f.y, 0.75);
    float lit = mix(on * win, on * 0.36, smoothstep(45.0, 90.0, d));
    c = vCol * (0.04 + lit * (0.6 + vEm * 0.6)) + vCol * vEm * 0.08;
  }
  if (uMode == 1) {                                    // and every edge drawn in light, a pixel wide wherever it is
    vec3 q = vB + vec3(0.5, 0.0, 0.5), w = fwidth(q) * 1.3;
    vec3 e = step(min(q, 1.0 - q), w);
    if (e.x + e.y + e.z >= 2.0) c = vCol * (1.0 + vEm * 0.7);
  }
  c = mix(c, uFog, 1.0 - exp(-d * uFogD));
  o = vec4(c * uMul, 1.0);
}`;
  const FULL_VS = `#version 300 es
void main() { vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2)); gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0); }`;
  const FULL_HEAD = `#version 300 es
precision highp float;
uniform vec2 uRes; uniform float uT, uK, uA, uCut, uRs, uEnv, uW, uBloom, uBolt, uZ; uniform vec2 uMood; uniform vec3 uC1, uC2, uC3;
out vec4 o;
mat2 rot(float a) { float c = cos(a), s = sin(a); return mat2(c, -s, s, c); }
float h21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vnoise(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(h21(i), h21(i + vec2(1, 0)), f.x), mix(h21(i + vec2(0, 1)), h21(i + vec2(1, 1)), f.x), f.y); }
float fbm(vec2 p) { float s = 0.0, a = 0.5; for (int i = 0; i < 5; i++) { s += a * vnoise(p); p = p * 2.03 + 17.1; a *= 0.5; } return s; }
`;
  // the sky behind the meshes: a horizon glow (the fog's colour, so the far things melt into it), stars above, the night
  const DOME_FS = FULL_HEAD + `
uniform vec3 uF, uR, uU, uHz, uZen; uniform vec2 uTan; uniform float uOff;
void main() {
  vec2 uv = (gl_FragCoord.xy - vec2(uOff, 0.0)) / uRes * 2.0 - 1.0;
  vec3 d = normalize(uF + uR * uv.x * uTan.x + uU * uv.y * uTan.y);
  float y = d.y;
  vec3 c = mix(uHz, uZen, smoothstep(-0.05, 0.45, y));
  c += uHz * exp(-abs(y) * 30.0) * 0.6;
  vec2 sp = vec2(atan(d.x, d.z) * 120.0, y * 160.0);
  c += vec3(0.9, 0.9, 1.0) * step(0.996, h21(floor(sp))) * smoothstep(0.05, 0.3, y) * 0.8;
  o = vec4(c, 1.0);
}`;
  // FRACTAL: a corridor of folded boxes, the cutoff opening the folds, the resonance turning them, the kick a pulse
  const FRACTAL_FS = FULL_HEAD + `
float map(vec3 p) {
  p.xy *= rot(p.z * 0.04 + uT * 0.05);
  vec3 q = p; q.z = mod(q.z, 6.0) - 3.0;
  float s = 1.0;
  for (int i = 0; i < 4; i++) {
    q = abs(q) - vec3(2.0 - uCut * 0.7, 2.1, 1.5);
    q.xy *= rot(0.45 + uRs * 0.5);
    q.yz *= rot(0.25);
    q *= 1.38; s *= 1.38;
  }
  float d = length(max(abs(q) - vec3(0.9, 0.35, 0.9), 0.0)) / s;
  return max(d, 1.35 - length(p.xy));
}
void main() {
  vec2 uv = (gl_FragCoord.xy - uRes * 0.5) / uRes.y;
  vec3 ro = vec3(0.0, 0.0, uZ), rd = normalize(vec3(uv * (1.0 + uK * 0.15), 1.1));
  rd.xy *= rot(sin(uT * 0.2) * 0.3);
  float t = 0.0, gl = 0.0; int hit = 0;
  for (int i = 0; i < 72; i++) {
    float d = map(ro + rd * t);
    gl += 0.012 / (0.02 + abs(d));
    if (d < 0.002 * t) { hit = 1; break; }
    t += d * 0.9; if (t > 40.0) break;
  }
  vec3 p = ro + rd * t, c = vec3(0.0);
  if (hit == 1) {
    vec2 e = vec2(0.002, 0.0);
    vec3 n = normalize(vec3(map(p + e.xyy) - map(p - e.xyy), map(p + e.yxy) - map(p - e.yxy), map(p + e.yyx) - map(p - e.yyx)));
    float l = 0.25 + 0.75 * max(0.0, dot(n, normalize(vec3(0.3, 0.6, -0.7))));
    vec3 base = mix(uC1, uC2, 0.5 + 0.5 * sin(p.z * 0.4 + uT * 0.3));
    c = base * l + uC3 * pow(max(0.0, dot(reflect(rd, n), -rd)), 12.0) * 0.4;
  }
  c += uC3 * gl * (0.04 + uK * 0.05 + uRs * 0.03);
  c = mix(c, vec3(0.02, 0.0, 0.05), 1.0 - exp(-t * 0.06));
  o = vec4(c, 1.0);
}`;
  // CHROME: blobs of liquid metal melting into each other, a neon sky and a grid in their reflections
  const CHROME_FS = FULL_HEAD + `
float smin(float a, float b, float k) { float h = clamp(0.5 + 0.5 * (b - a) / k, 0.0, 1.0); return mix(b, a, h) - k * h * (1.0 - h); }
float map(vec3 p) {
  float d = 1e9;
  for (int i = 0; i < 5; i++) {
    float f = float(i);
    vec3 c = vec3(sin(uT * (0.5 + f * 0.13) + f * 2.1) * (0.8 + uCut * 0.6), cos(uT * (0.37 + f * 0.11) + f * 1.3) * 0.6, sin(uT * 0.29 + f * 4.0) * 0.6);
    d = smin(d, length(p - c) - (0.5 + uK * 0.16 + 0.08 * sin(uT * 2.0 + f)), 0.7 + uRs * 0.5);
  }
  return d;
}
vec3 sky(vec3 d) {
  vec3 c = mix(uC1 * 0.35, uC2 * 0.95, smoothstep(-0.1, 0.7, d.y));
  c += uC3 * pow(max(0.0, dot(d, normalize(vec3(0.3, 0.4, 1.0)))), 16.0) * 1.4;
  c += vec3(1.0) * pow(max(0.0, dot(d, normalize(vec3(-0.6, 0.8, -0.2)))), 40.0);
  if (d.y < 0.0) { vec2 g = d.xz / max(-d.y, 0.05); vec2 f = abs(fract(g * 0.5 + vec2(0.0, uT * 0.4)) - 0.5);
    c = mix(uC1 * 0.12 + vec3(0.02, 0.0, 0.05), uC3 * 0.8, smoothstep(0.45, 0.5, max(f.x, f.y)) * smoothstep(-0.9, -0.05, d.y) * 0.7); }
  return c;
}
void main() {
  vec2 uv = (gl_FragCoord.xy - uRes * 0.5) / uRes.y;
  vec3 ro = vec3(0.0, 0.2, -4.2), rd = normalize(vec3(uv, 1.25));
  ro.xz *= rot(uT * 0.15); rd.xz *= rot(uT * 0.15);
  float t = 0.0; int hit = 0;
  for (int i = 0; i < 60; i++) { float d = map(ro + rd * t); if (d < 0.003) { hit = 1; break; } t += d; if (t > 12.0) break; }
  vec3 c = sky(rd);
  if (hit == 1) {
    vec3 p = ro + rd * t; vec2 e = vec2(0.003, 0.0);
    vec3 n = normalize(vec3(map(p + e.xyy) - map(p - e.xyy), map(p + e.yxy) - map(p - e.yxy), map(p + e.yyx) - map(p - e.yyx)));
    float fr = pow(1.0 - max(0.0, dot(n, -rd)), 3.0);
    c = sky(reflect(rd, n)) * (0.6 + 0.4 * fr) * vec3(0.95, 0.97, 1.05) + uC3 * uA * 0.2;
  }
  o = vec4(c, 1.0);
}`;
  // SKYFLIGHT: hills under a sky the weather makes (dusk when calm, grey when stormy), the mood's light, clouds, an
  // aurora when it's dark, lightning in a storm; every new chord brightens it
  const SKY_FS = FULL_HEAD + `
float terr(vec2 p) { return fbm(p * 0.03) * 24.0 - 8.0; }
void main() {
  vec2 uv = (gl_FragCoord.xy - uRes * 0.5) / uRes.y;
  float storm = uW, dark = 1.0 - uMood.y;
  vec3 ro = vec3(0.0, 15.0, uZ), rd = normalize(vec3(uv.x, uv.y - 0.08, 1.0));
  rd.xy *= rot(sin(uT * 0.05) * 0.06);
  vec3 dusk = mix(vec3(0.95, 0.45, 0.55), vec3(0.25, 0.3, 0.6), dark), top = mix(vec3(0.2, 0.15, 0.45), vec3(0.02, 0.02, 0.08), dark);
  vec3 grey = vec3(0.22, 0.24, 0.3) * (1.0 - dark * 0.6);
  vec3 skyC = mix(mix(dusk, top, smoothstep(0.0, 0.5, rd.y)), grey, storm * 0.8);
  vec3 c = skyC;
  vec3 sun = normalize(vec3(0.4 - uMood.x * 0.8, 0.08 + uMood.y * 0.12, 1.0));
  c += mix(vec3(1.0, 0.7, 0.5), vec3(0.8, 0.85, 1.0), dark) * pow(max(0.0, dot(rd, sun)), 60.0) * (1.0 - storm);
  if (rd.y > 0.0) {                                     // stars and the aurora when it's dark; clouds always
    c += vec3(1.0) * step(0.997, h21(floor(rd.xy / rd.z * 220.0))) * dark * (1.0 - storm) * 0.8;
    float a = sin(rd.x * 6.0 + uT * 0.2 + sin(rd.x * 13.0 - uT * 0.3)) * 0.5 + 0.5;
    c += mix(uC1, uC2, a) * smoothstep(0.1, 0.3, rd.y) * smoothstep(0.55, 0.3, rd.y) * a * dark * (1.0 - storm) * (0.5 + uBloom * 0.6);
    vec2 cp = rd.xz / rd.y * 30.0 + vec2(0.0, uZ * 0.4 + uT * 1.5);
    float cl = smoothstep(0.55 - storm * 0.35, 0.95, fbm(cp * 0.04));
    c = mix(c, mix(vec3(1.0, 0.85, 0.9) * (1.0 - dark * 0.7), vec3(0.3, 0.32, 0.38), storm), cl * smoothstep(0.0, 0.15, rd.y) * 0.85);
  }
  float t = 0.5, h = 0.0; int hit = 0;
  for (int i = 0; i < 70; i++) { vec3 p = ro + rd * t; h = p.y - terr(p.xz); if (h < 0.02 * t) { hit = 1; break; } t += max(0.3, h * 0.6); if (t > 260.0) break; }
  if (hit == 1) {
    vec3 p = ro + rd * t; vec2 e = vec2(0.4, 0.0);
    vec3 n = normalize(vec3(terr(p.xz - e.xy) - terr(p.xz + e.xy), 0.8, terr(p.xz - e.yx) - terr(p.xz + e.yx)));
    vec3 g = mix(mix(vec3(0.2, 0.12, 0.3), vec3(0.16, 0.3, 0.26), smoothstep(-4.0, 10.0, p.y)), uC1 * 0.5, 0.25);
    float rim = pow(1.0 - max(0.0, n.y), 2.0);
    vec3 hc = g * (0.25 + 0.9 * max(0.0, dot(n, sun))) * (1.0 - dark * 0.45) + skyC * rim * 0.25;
    c = mix(hc, skyC, 1.0 - exp(-t * (0.0045 + storm * 0.008)));
  }
  c *= 1.0 + uBloom * 0.25;
  c = mix(c, vec3(0.9, 0.95, 1.0), uBolt * 0.6);
  o = vec4(c, 1.0);
}`;

  // ----------------------------------------------------------------------------------------- the GL machine ---
  // its own canvas, laid under the rave's (which then carries only the readouts, the words and the confetti), at the
  // screen's own resolution: meshes drawn multisampled (smooth edges), raymarched scenes at a lighter size and
  // smoothed up; then a pass that does what the punch-ins and the VJ do to the picture, and keeps the last frame for
  // the trails and the echo
  const VSZ = 10;                                         // (a vertex: position, normal, colour, emission)
  const POST_FS = `#version 300 es
precision highp float;
uniform sampler2D uScene, uPrev, uFrz, uBloom, uFade;
uniform vec2 uRes; uniform float uAsp, uT, uGlow, uRadial, uDof, uFadeK, uWhipX;
uniform float uUseFrz, uTear, uInv, uTape, uSag, uLp, uHp, uCrush, uGate, uSplit, uZoom, uPix, uScan, uTrail, uEcho, uMirror, uKRot, uBand, uStreak, uHueOn;
uniform vec2 uShake; uniform mat3 uHue;
out vec4 o;
float h11(float x) { return fract(sin(x * 127.1 + 1.7) * 43758.5453); }
float gLod = 0.0;
vec3 samp(vec2 p) { return uUseFrz > 0.5 ? texture(uFrz, p).rgb : textureLod(uScene, p, gLod).rgb; }
void main() {
  vec2 uv = gl_FragCoord.xy / uRes, p = uv;
  float wpx = 150.0 * uAsp;                            // (the 150-tall picture's width: the effects' own units)
  if (uPix > 1.0) { vec2 b = vec2(uPix / wpx, uPix / 150.0); p = (floor(p / b) + 0.5) * b; }
  if (uMirror > 0.5 && uMirror < 2.5) { if (p.x > 0.5) p.x = 1.0 - p.x; if (uMirror > 1.5 && p.y < 0.5) p.y = 1.0 - p.y; }
  else if (uMirror > 2.5) {                           // six mirrored wedges, turning
    vec2 q = vec2((p.x - 0.5) * uAsp, (p.y - 0.5) * 1.3); float r0 = length(q), w = 1.0471976;
    float an = atan(q.y, q.x) + uKRot; an = mod(an, 2.0 * w); if (an > w) an = 2.0 * w - an;
    p = vec2(0.5 + cos(an - uKRot) * r0 / uAsp, 0.5 + sin(an - uKRot) * r0 / 1.3);
  }
  if (uZoom != 1.0) p = 0.5 + (p - 0.5) / uZoom;
  float ys = 1.0 - p.y; ys -= uSag / 150.0 * ys; p.y = 1.0 - ys;   // (TAPE STOP: the picture sags)
  p += uShake / vec2(wpx, 150.0);
  if (uUseFrz > 0.5) { float band = floor((1.0 - p.y) * 150.0); if (h11(band + uTear) < 0.18) p.x += (h11(band * 3.1 + uTear) - 0.5) * 30.0 / wpx; }
  float sp = uSplit / wpx;
  vec2 dv0 = (uv - 0.5) * 2.0;
  gLod = uDof * smoothstep(0.3, 1.1, length(dv0 * vec2(1.0, 0.8))) * 3.5;   // (out of focus toward the edges, at speed)
  vec3 c = vec3(samp(p + vec2(sp, 0.0)).r, samp(p).g, samp(p - vec2(sp, 0.0)).b);
  if (uRadial > 0.01 || abs(uWhipX) > 0.001) {         // motion blur: out from the middle at speed, sideways on a whip-pan
    vec3 acc = c; vec2 dirv = (p - vec2(0.5, 0.55)) * uRadial * 0.05 + vec2(uWhipX * 0.03, 0.0);
    for (int i = 1; i < 8; i++) acc += samp(p - dirv * float(i));
    c = acc / 8.0;
  }
  c += texture(uBloom, uv).rgb * uGlow;               // the glow: the bright parts bleeding light
  if (uHueOn > 0.5) c = uHue * c;
  c += (1.0 - c * 1.1 - c) * uInv;
  if (uTape < 1.0) { float m = (c.r + c.g + c.b) / 3.0; c = (c + (m - c) * (1.0 - uTape)) * uTape; }
  c *= vec3(1.0 - uLp * 0.6, 1.0 - uLp * 0.5, 1.0 - uLp * 0.2); c.b += 30.0 / 255.0 * uLp;
  c += (1.0 - c) * uHp * vec3(0.35, 0.45, 0.5);
  if (uCrush > 0.5) c = floor(c * 3.0 + 0.5) / 3.0;
  vec2 dv = (uv - 0.5) * 2.0; float v = clamp(1.15 - 0.45 * dot(dv, dv), 0.35, 1.0);
  if (uScan > 0.5) v *= 0.94 + 0.06 * step(0.5, fract(gl_FragCoord.y * 0.5));
  c *= v * uGate;
  if (1.0 - uv.y < uBand) c *= 0.35;                  // (the readouts' strip along the top)
  if (uStreak > 0.3) {                                // a boost: streaks flying out from the middle
    vec2 q = (uv - vec2(0.5, 0.55)) * vec2(uAsp, 1.0); float a = atan(q.y, q.x), r = length(q);
    float s = step(0.985 - 0.015 * uStreak, h11(floor(a * 90.0) + floor(uT * 16.0) * 7.3));
    c += vec3(s * smoothstep(0.18, 0.7, r) * uStreak * 0.45);
  }
  vec3 pr = texture(uPrev, uv).rgb;
  if (uEcho > 0.5) c = max(c, pr * 0.82); else if (uTrail > 0.0) c = max(c, pr * uTrail);
  if (uFadeK > 0.0) c = mix(c, texture(uFade, uv).rgb, uFadeK);   // (from the scene before: a crossfade)
  o = vec4(c, 1.0);
}`;
  const POST_U = ["uScene", "uPrev", "uFrz", "uBloom", "uFade", "uGlow", "uRadial", "uDof", "uFadeK", "uWhipX", "uRes", "uAsp", "uT", "uUseFrz", "uTear", "uInv", "uTape", "uSag", "uLp", "uHp", "uCrush", "uGate", "uSplit", "uZoom", "uPix", "uScan", "uTrail", "uEcho", "uMirror", "uKRot", "uBand", "uStreak", "uHueOn", "uShake", "uHue"];
  // the glow: the bright parts, smaller, blurred one way then the other
  const BRIGHT_FS = `#version 300 es
precision highp float;
uniform sampler2D uSrc; uniform vec2 uRes;
out vec4 o;
void main() {
  vec2 uv = gl_FragCoord.xy / uRes, d = 0.5 / uRes;
  vec3 c = (texture(uSrc, uv + vec2(-d.x, -d.y)).rgb + texture(uSrc, uv + vec2(d.x, -d.y)).rgb + texture(uSrc, uv + vec2(-d.x, d.y)).rgb + texture(uSrc, uv + d).rgb) * 0.25;
  float l = max(c.r, max(c.g, c.b));
  o = vec4(c * smoothstep(0.42, 0.95, l), 1.0);
}`;
  const BLUR_FS = `#version 300 es
precision highp float;
uniform sampler2D uSrc; uniform vec2 uRes, uDir;
out vec4 o;
void main() {
  vec2 uv = gl_FragCoord.xy / uRes, s = uDir / uRes;
  vec3 c = texture(uSrc, uv).rgb * 0.227;
  c += (texture(uSrc, uv + s * 1.38).rgb + texture(uSrc, uv - s * 1.38).rgb) * 0.316;
  c += (texture(uSrc, uv + s * 3.23).rgb + texture(uSrc, uv - s * 3.23).rgb) * 0.070;
  o = vec4(c, 1.0);
}`;
  const TOUCH = typeof matchMedia === "function" && matchMedia("(pointer: coarse)").matches;
  class G3 {
    constructor() {
      this.cv = document.createElement("canvas"); this.cv.width = 2; this.cv.height = 2;
      this.cv.className = "viz3d"; this.cv.setAttribute("aria-hidden", "true");
      const gl = this.gl = this.cv.getContext("webgl2", { antialias: false, alpha: false, depth: false, preserveDrawingBuffer: false, powerPreference: "high-performance" });
      if (!gl) throw new Error("no WebGL2");
      this.lost = false;
      this.cv.addEventListener("webglcontextlost", (e) => { e.preventDefault(); this.lost = true; });
      this.mesh = this.prog(MESH_VS, MESH_FS);
      this.u = {}; for (const n of ["uVP", "uM", "uFog", "uFogD", "uLt", "uEye", "uMode", "uT", "uMul"]) this.u[n] = gl.getUniformLocation(this.mesh, n);
      this.post = this.prog(FULL_VS, POST_FS); this.pu = {}; for (const n of POST_U) this.pu[n] = gl.getUniformLocation(this.post, n);
      this.uMulLoc = gl.getUniformLocation(this.mesh, "uMul");
      this.bright = this.prog(FULL_VS, BRIGHT_FS); this.blur = this.prog(FULL_VS, BLUR_FS);
      this.q = 1; this.qT = 0; this.ft = 1 / 60; this.fadeK = 0;      // (the quality the frame rate allows; a crossfade)
      this.full = {}; this.empty = gl.createVertexArray();
      this.dyn = this.makeMesh(new Float32Array(VSZ * 3), gl.TRIANGLES, true);   // (lines and triangles made fresh each frame)
      this.instBuf = gl.createBuffer();
      this.meshes = {}; this.st = {};
      this.samples = Math.min(4, gl.getParameter(gl.MAX_SAMPLES) || 0);
      this.w = 0; this.h = 0; this.cur = 0; this.wasRep = false; this.box = "";
    }
    prog(vs, fs) {
      const gl = this.gl, mk = (t, src) => { const s = gl.createShader(t); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)); return s; };
      const p = gl.createProgram(); gl.attachShader(p, mk(gl.VERTEX_SHADER, vs)); gl.attachShader(p, mk(gl.FRAGMENT_SHADER, fs)); gl.linkProgram(p);
      if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
      return p;
    }
    // ---- where it sits: under the rave's canvas, the same box, as many pixels as the screen has (within a budget)
    place(rv) {
      const c = rv.cv, par = c && c.parentNode;
      if (!par || !c.isConnected) return false;
      if (this.cv.parentNode !== par) { par.insertBefore(this.cv, c); rv.glCanvas = this.cv; }
      const cw = c.offsetWidth, ch = c.offsetHeight;
      if (cw < 4 || ch < 4) return false;
      const qs = rv.vj.q3d === 1 ? 0.5 : rv.vj.q3d === 2 ? 1 : this.q;     // (Low, High, or Auto: what the frame rate allows)
      const dpr = Math.min(2, window.devicePixelRatio || 1), budget = TOUCH ? 1.3e6 : 2.6e6, k = Math.min(dpr, Math.sqrt(budget / (cw * ch))) * qs;
      const w = Math.max(2, Math.round(cw * k)), h = Math.max(2, Math.round(ch * k));
      const box = c.offsetLeft + "," + c.offsetTop + "," + cw + "," + ch;
      if (box !== this.box) {
        this.box = box; const s = this.cv.style;
        s.left = c.offsetLeft + "px"; s.top = c.offsetTop + "px"; s.width = cw + "px"; s.height = ch + "px";
        s.borderRadius = getComputedStyle(c).borderRadius;
      }
      if (w !== this.w || h !== this.h) this.targets(w, h);
      return true;
    }
    tex(w, h, mip) {
      const gl = this.gl, t = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, t); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      if (mip) gl.generateMipmap(gl.TEXTURE_2D);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, mip ? gl.LINEAR_MIPMAP_LINEAR : gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      return t;
    }
    fbo(tex, rb, depth) {
      const gl = this.gl, f = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, f);
      if (tex) gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
      if (rb) gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.RENDERBUFFER, rb);
      if (depth) gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, depth);
      return f;
    }
    rb(w, h, fmt, samples) { const gl = this.gl, r = gl.createRenderbuffer(); gl.bindRenderbuffer(gl.RENDERBUFFER, r); if (samples) gl.renderbufferStorageMultisample(gl.RENDERBUFFER, samples, fmt, w, h); else gl.renderbufferStorage(gl.RENDERBUFFER, fmt, w, h); return r; }
    targets(w, h) {
      const gl = this.gl, T = this.T;
      if (T) { for (const t of T.texs) gl.deleteTexture(t); for (const f of T.fbos) gl.deleteFramebuffer(f); for (const r of T.rbs) gl.deleteRenderbuffer(r); }
      this.w = w; this.h = h; this.cv.width = w; this.cv.height = h;
      const lw = Math.max(2, Math.round(w * 0.55)), lh = Math.max(2, Math.round(h * 0.55));
      const full = this.tex(w, h, true), low = this.tex(lw, lh, true), o0 = this.tex(w, h), o1 = this.tex(w, h), frz = this.tex(w, h), fade = this.tex(w, h);
      const bw = Math.max(2, w >> 2), bh = Math.max(2, h >> 2), b0 = this.tex(bw, bh), b1 = this.tex(bw, bh);
      const dep = this.rb(w, h, gl.DEPTH_COMPONENT24, this.samples), rbs = [dep];
      let ms = null;
      if (this.samples) { const cr = this.rb(w, h, gl.RGBA8, this.samples); rbs.push(cr); ms = this.fbo(null, cr, dep); }
      const fullF = this.fbo(full, null, this.samples ? null : dep);
      this.T = { lw, lh, full, low, out: [o0, o1], frz, ms, fullF, lowF: this.fbo(low), outF: [this.fbo(o0), this.fbo(o1)], frzF: this.fbo(frz),
        fade, fadeF: this.fbo(fade), bw, bh, b: [b0, b1], bF: [this.fbo(b0), this.fbo(b1)], texs: [full, low, o0, o1, frz, fade, b0, b1], rbs, fbos: [] };
      this.T.fbos = [ms, fullF, this.T.lowF, ...this.T.outF, this.T.frzF, this.T.fadeF, ...this.T.bF].filter(Boolean);
      for (const f of this.T.outF) { gl.bindFramebuffer(gl.FRAMEBUFFER, f); gl.clearColor(0, 0, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT); }
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    }
    // a mesh: a vertex array of [x y z, nx ny nz, r g b, emission]; instanced ones take [x y z height, w d turn -, r g b emission]
    makeMesh(data, prim, dynamic, instanced) {
      const gl = this.gl, vao = gl.createVertexArray(), vb = gl.createBuffer();
      gl.bindVertexArray(vao); gl.bindBuffer(gl.ARRAY_BUFFER, vb); gl.bufferData(gl.ARRAY_BUFFER, data, dynamic ? gl.DYNAMIC_DRAW : gl.STATIC_DRAW);
      const st = VSZ * 4;
      gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, st, 0);
      gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 3, gl.FLOAT, false, st, 12);
      gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2, 3, gl.FLOAT, false, st, 24);
      gl.enableVertexAttribArray(3); gl.vertexAttribPointer(3, 1, gl.FLOAT, false, st, 36);
      if (instanced) {
        gl.bindBuffer(gl.ARRAY_BUFFER, this.instBuf);
        for (let k = 0; k < 3; k++) { gl.enableVertexAttribArray(4 + k); gl.vertexAttribPointer(4 + k, 4, gl.FLOAT, false, 48, k * 16); gl.vertexAttribDivisor(4 + k, 1); }
      }
      gl.bindVertexArray(null);
      return { vao, vb, n: data.length / VSZ, prim, instanced };
    }
    // a frame of meshes begins: the fog, the sky, the camera (into the multisampled target)
    begin(_w, fog, fogD, eye, tgt, up, fovy = 1.05, far = 400, zen) {
      const gl = this.gl, T = this.T, h = this.h, V = this.view, x0 = V ? Math.round(V[0] * this.w) : 0, w = V ? Math.round(V[1] * this.w) : this.w;
      gl.bindFramebuffer(gl.FRAMEBUFFER, T.ms || T.fullF); this.src = "full";
      gl.viewport(x0, 0, w, h);
      gl.depthMask(true);
      const D = this.dir;                                // the director: a whip-pan on a fill, a dolly zoom on a filter sweep
      if (D && !this.noDirect) {
        if (D.whip > 0.01) { const a = D.whip * D.whip * 1.1 * D.whipDir, f = sub(tgt, eye), c = Math.cos(a), s = Math.sin(a); tgt = add(eye, [f[0] * c - f[2] * s, f[1], f[0] * s + f[2] * c]); }
        if (D.sweep > 0.02) { const f2 = fovy * (1 - 0.32 * D.sweep), k = Math.tan(fovy / 2) / Math.tan(f2 / 2); eye = add(tgt, mul(sub(eye, tgt), Math.min(k, 2.2))); fovy = f2; }
      }
      gl.enable(gl.SCISSOR_TEST); gl.scissor(x0, 0, w, h);
      gl.clearColor(fog[0], fog[1], fog[2], 1); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      gl.disable(gl.SCISSOR_TEST);
      if (zen) {                                         // (a sky first, behind everything)
        const f = norm(sub(tgt, eye)), r = norm(cross(f, up || [0, 1, 0])), u = cross(r, f), ty = Math.tan(fovy / 2);
        this.quad("dome", DOME_FS, w, h, { uF: f, uR: r, uU: u, uTan: [ty * (w / h), ty], uHz: fog, uZen: zen, uOff: x0 });
      }
      gl.enable(gl.DEPTH_TEST); gl.disable(gl.CULL_FACE); gl.disable(gl.BLEND); gl.depthMask(true);
      gl.useProgram(this.mesh); gl.bindVertexArray(null);
      this.vp = mmul(persp(fovy, w / h, 0.1, far), lookAt(eye, tgt, up || [0, 1, 0])); this.eye = eye; this.fovy = fovy; this.vw = w;
      gl.uniformMatrix4fv(this.u.uVP, false, this.vp);
      gl.uniform3fv(this.u.uFog, fog); gl.uniform1f(this.u.uFogD, fogD); gl.uniform3fv(this.u.uEye, eye);
      gl.uniform3fv(this.u.uLt, norm([0.4, 0.8, -0.45])); gl.uniform1i(this.u.uMode, 0); gl.uniform1f(this.u.uMul, 1);
      this.camR = norm(cross(norm(sub(tgt, eye)), up || [0, 1, 0])); this.camU = cross(this.camR, norm(sub(tgt, eye))); this.camF = norm(sub(tgt, eye));
    }
    dim(k) { this.gl.uniform1f(this.u.uMul, k); }        // (a reflection: the same, darker)
    glow(on) { const gl = this.gl; if (on) { gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE); gl.depthMask(false); } else { gl.disable(gl.BLEND); gl.depthMask(true); } }
    draw(m, model, inst, count, mode = 0) {
      const gl = this.gl;
      gl.uniformMatrix4fv(this.u.uM, false, model || ID); gl.uniform1i(this.u.uMode, mode);
      gl.bindVertexArray(m.vao);
      if (m.instanced) {
        gl.bindBuffer(gl.ARRAY_BUFFER, this.instBuf); gl.bufferData(gl.ARRAY_BUFFER, inst, gl.DYNAMIC_DRAW);
        gl.drawArraysInstanced(m.prim, 0, m.n, count);
      } else {
        gl.vertexAttrib4f(4, 0, 0, 0, 1); gl.vertexAttrib4f(5, 1, 1, 0, 0); gl.vertexAttrib4f(6, 1, 1, 1, 0);
        gl.drawArrays(m.prim, 0, m.n);
      }
      gl.bindVertexArray(null);
    }
    // lines with a width: each pair of vertices becomes a strip facing the camera, at least ~1.5 pixels wide however
    // far, glowing (added to what's behind)
    lines(arr, n, w = 0.05, model, k = 1) {
      if (!n) return;
      const E = this.eye, pxA = (2 * Math.tan(this.fovy / 2)) / this.h, need = n * 3 * VSZ;
      if (!this.LB || this.LB.length < need) this.LB = new Float32Array(need * 1.5);
      const L = this.LB; let o = 0;
      for (let i = 0; i + 1 < n; i += 2) {
        const a = i * VSZ, b = a + VSZ; let A = [arr[a], arr[a + 1], arr[a + 2]], B = [arr[b], arr[b + 1], arr[b + 2]];
        if (model) { A = xform(model, A); B = xform(model, B); }
        const d = sub(B, A);
        const side = (P) => { const v = sub(P, E), s0 = norm(cross(d, v)), hw = Math.max(w, Math.hypot(v[0], v[1], v[2]) * pxA * 0.8); return mul(s0, hw); };
        const sa = side(A), sb = side(B), q = [add(A, sa), sub(A, sa), sub(B, sb), add(B, sb)], src = [a, a, b, b];
        for (const j of [0, 1, 2, 0, 2, 3]) { const P = q[j], c = src[j]; L[o] = P[0]; L[o + 1] = P[1]; L[o + 2] = P[2]; L[o + 3] = L[o + 4] = L[o + 5] = 0; L[o + 6] = arr[c + 6] * k; L[o + 7] = arr[c + 7] * k; L[o + 8] = arr[c + 8] * k; L[o + 9] = arr[c + 9]; o += VSZ; }
      }
      this.glow(true); this.drawDyn(L, o / VSZ, this.gl.TRIANGLES); this.glow(false);
    }
    // vertices made this frame (lines or triangles)
    drawDyn(arr, n, prim, model) {
      if (!n) return;
      const gl = this.gl, m = this.dyn;
      gl.bindBuffer(gl.ARRAY_BUFFER, m.vb); gl.bufferData(gl.ARRAY_BUFFER, arr.subarray(0, n * VSZ), gl.DYNAMIC_DRAW);
      m.n = n; m.prim = prim; this.draw(m, model);
    }
    // one triangle over the target that's bound, with a shader of its own
    quad(key, src, w, h, U) {
      const gl = this.gl;
      let f = this.full[key];
      if (!f) { const p = this.prog(FULL_VS, src); f = this.full[key] = { p, u: {} }; for (const n of ["uRes", "uT", "uK", "uA", "uCut", "uRs", "uEnv", "uW", "uBloom", "uBolt", "uZ", "uMood", "uC1", "uC2", "uC3", "uF", "uR", "uU", "uTan", "uHz", "uZen", "uOff"]) f.u[n] = gl.getUniformLocation(p, n); }
      gl.disable(gl.DEPTH_TEST); gl.disable(gl.BLEND); gl.depthMask(false);
      gl.useProgram(f.p);
      gl.uniform2f(f.u.uRes, w, h);
      for (const k in U) { const v = U[k], loc = f.u[k]; if (loc == null) continue; if (typeof v === "number") gl.uniform1f(loc, v); else if (v.length === 2) gl.uniform2fv(loc, v); else gl.uniform3fv(loc, v); }
      gl.bindVertexArray(this.empty); gl.drawArrays(gl.TRIANGLES, 0, 3); gl.bindVertexArray(null);
      gl.depthMask(true);
    }
    // a raymarched scene: drawn at a lighter size, smoothed up by the last pass
    fullscreen(key, src, _w, U) {
      const gl = this.gl, T = this.T;
      gl.bindFramebuffer(gl.FRAMEBUFFER, T.lowF); gl.viewport(0, 0, T.lw, T.lh); this.src = "low";
      this.quad(key, src, T.lw, T.lh, U);
    }
    // a crossfade begins: the last frame shown, kept, then faded out over the next
    fadeFromLast() {
      const gl = this.gl, T = this.T; if (!T) return;
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, T.outF[this.cur ^ 1]); gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, T.fadeF);
      gl.blitFramebuffer(0, 0, this.w, this.h, 0, 0, this.w, this.h, gl.COLOR_BUFFER_BIT, gl.NEAREST);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null); this.fadeK = 1;
    }
    // the frame ends: the punch-ins and the VJ over it, then onto the screen
    end(rv) {
      const gl = this.gl, T = this.T, w = this.w, h = this.h;
      let srcTex = T.low;
      if (this.src === "full") {
        srcTex = T.full;
        if (T.ms) { gl.bindFramebuffer(gl.READ_FRAMEBUFFER, T.ms); gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, T.fullF); gl.blitFramebuffer(0, 0, w, h, 0, 0, w, h, gl.COLOR_BUFFER_BIT, gl.NEAREST); }
      }
      gl.bindTexture(gl.TEXTURE_2D, srcTex); gl.generateMipmap(gl.TEXTURE_2D);   // (the out-of-focus edges read the smaller copies)
      // the glow: the bright parts at a quarter size, blurred across then down, twice
      const glow = (rv.vj.glow == null ? 0.7 : rv.vj.glow) * (rv.calm ? 0.6 : 1);
      if (glow > 0.01) {
        const run = (prog, src, dstF, dir) => {
          gl.bindFramebuffer(gl.FRAMEBUFFER, dstF); gl.viewport(0, 0, T.bw, T.bh); gl.useProgram(prog);
          gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, src); gl.uniform1i(gl.getUniformLocation(prog, "uSrc"), 0);
          gl.uniform2f(gl.getUniformLocation(prog, "uRes"), T.bw, T.bh); if (dir) gl.uniform2f(gl.getUniformLocation(prog, "uDir"), dir[0], dir[1]);
          gl.bindVertexArray(this.empty); gl.drawArrays(gl.TRIANGLES, 0, 3);
        };
        gl.disable(gl.DEPTH_TEST); gl.disable(gl.BLEND);
        run(this.bright, srcTex, T.bF[0]);
        run(this.blur, T.b[0], T.bF[1], [1, 0]); run(this.blur, T.b[1], T.bF[0], [0, 1]);
        run(this.blur, T.b[0], T.bF[1], [2.2, 0]); run(this.blur, T.b[1], T.bF[0], [0, 2.2]);
      }
      // the frame rate: down a step when it struggles, back up when it's easy (Auto)
      this.ft = this.ft * 0.94 + Math.min(0.1, rv.dt || 0.016) * 0.06; this.qT += rv.dt || 0.016;
      if (rv.vj.q3d !== 1 && rv.vj.q3d !== 2) {
        if (this.ft > 0.026 && this.qT > 1.5 && this.q > 0.45) { this.q = Math.max(0.45, this.q * 0.85); this.qT = 0; }
        else if (this.ft < 0.0175 && this.qT > 6 && this.q < 1) { this.q = Math.min(1, this.q * 1.12); this.qT = 0; }
        else if (this.ft >= 0.0175 && this.ft <= 0.026) this.qT = Math.min(this.qT, 1.4);
      }
      this.fadeK = Math.max(0, this.fadeK - (rv.dt || 0.016) / 0.8);
      const fx = rv.fx | 0, has = (b) => (fx >> b) & 1, held = (b) => (has(b) ? Math.min(1, (rv.t - rv.fxSince[b]) / 1.4) : 0);
      const calm = rv.calm, VJ = rv.vj, rep = !!(fx & 7);
      if (rep && !this.wasRep) {                         // a repeat: this frame, held
        gl.bindFramebuffer(gl.READ_FRAMEBUFFER, this.src === "full" ? T.fullF : T.lowF); gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, T.frzF);
        const sw = this.src === "full" ? w : T.lw, sh = this.src === "full" ? h : T.lh;
        gl.blitFramebuffer(0, 0, sw, sh, 0, 0, w, h, gl.COLOR_BUFFER_BIT, gl.LINEAR);
      }
      this.wasRep = rep;
      const tempo = rv.hooks.params().tempo || 124, div = has(2) ? 0.5 : has(1) ? 1 : 2, per = (60 / tempo / 4) * div;
      const tape = has(4) ? rv.tape : 1, fr = !calm && !rv.racing && rv.accent > 0.3 ? 1 + (rv.accent > 0.7 ? 1 : 0) : 0;
      const hu = (VJ.hue || 0) * TAU, ch = Math.cos(hu), shh = Math.sin(hu), k3 = (1 - ch) / 3, s3 = Math.sqrt(1 / 3) * shh;
      const hueOn = Math.abs(VJ.hue || 0) > 0.002 && Math.abs((VJ.hue || 0) - 1) > 0.002;
      const prev = T.out[this.cur ^ 1], dst = T.outF[this.cur];
      gl.bindFramebuffer(gl.FRAMEBUFFER, dst); gl.viewport(0, 0, w, h);
      gl.disable(gl.DEPTH_TEST); gl.disable(gl.BLEND);
      gl.useProgram(this.post); const U = this.pu;
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, srcTex); gl.uniform1i(U.uScene, 0);
      gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, prev); gl.uniform1i(U.uPrev, 1);
      gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, T.frz); gl.uniform1i(U.uFrz, 2);
      gl.activeTexture(gl.TEXTURE3); gl.bindTexture(gl.TEXTURE_2D, T.b[0]); gl.uniform1i(U.uBloom, 3);
      gl.activeTexture(gl.TEXTURE4); gl.bindTexture(gl.TEXTURE_2D, T.fade); gl.uniform1i(U.uFade, 4);
      gl.activeTexture(gl.TEXTURE0);
      const f1 = (n, v) => gl.uniform1f(U[n], v);
      gl.uniform2f(U.uRes, w, h); f1("uAsp", w / h); f1("uT", rv.t);
      const D = this.dir || {};
      f1("uGlow", glow); f1("uRadial", rv.calm ? 0 : Math.max(this.blurK || 0, (D.whip || 0) * 0.5)); f1("uDof", rv.calm ? 0 : this.dofK || 0);
      f1("uFadeK", this.fadeK); f1("uWhipX", rv.calm ? 0 : (D.whip || 0) * (D.whip || 0) * (D.whipDir || 1));
      this.blurK = 0; this.dofK = 0;
      f1("uUseFrz", rep ? 1 : 0); f1("uTear", Math.floor(rv.t / per) % 997); f1("uInv", has(3) ? 0.9 : 0); f1("uTape", tape); f1("uSag", (1 - tape) * 14);
      f1("uLp", held(5)); f1("uHp", held(6)); f1("uCrush", has(7)); f1("uGate", has(8) ? ((rv.scroll * 4) % 1 < 0.5 ? 1 : calm ? 0.35 : 0.04) : 1);
      f1("uSplit", fr + Math.round((calm ? 0 : VJ.rgb || 0) * 4)); f1("uZoom", 1 + (calm ? 0 : (VJ.zoom || 0) * rv.kick * 0.3));
      f1("uPix", Math.max(has(7) ? 4 : 1, VJ.pix | 0)); f1("uScan", VJ.scan !== false ? 1 : 0);
      f1("uTrail", Math.min(0.95, VJ.trails || 0)); f1("uEcho", has(9)); f1("uMirror", VJ.mirror | 0); f1("uKRot", rv.t * 0.25);
      f1("uBand", VJ.hud ? (rv.racing ? 9 : rv.driftMode ? 0 : 8) / 150 : 0); f1("uStreak", calm ? 0 : rv.speedK || 0); f1("uHueOn", hueOn ? 1 : 0);
      gl.uniform2f(U.uShake, calm ? 0 : (rnd() - 0.5) * 3 * rv.shake, calm ? 0 : (rnd() - 0.5) * 3 * rv.shake);
      gl.uniformMatrix3fv(U.uHue, false, [ch + k3, k3 + s3, k3 - s3, k3 - s3, ch + k3, k3 + s3, k3 + s3, k3 - s3, ch + k3]);
      gl.bindVertexArray(this.empty); gl.drawArrays(gl.TRIANGLES, 0, 3); gl.bindVertexArray(null);
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, dst); gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, null);
      gl.blitFramebuffer(0, 0, w, h, 0, 0, w, h, gl.COLOR_BUFFER_BIT, gl.NEAREST);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      this.cur ^= 1; rv.speedK = 0;
    }
  }

  // ----------------------------------------------------------------------------------------- shapes to draw ---
  class Builder {                                          // (triangles and lines, flat-shaded, into one array)
    constructor() { this.a = []; }
    v(p, n, c, e) { this.a.push(p[0], p[1], p[2], n[0], n[1], n[2], c[0], c[1], c[2], e); }
    tri(p0, p1, p2, c, e = 0) { const n = norm(cross(sub(p1, p0), sub(p2, p0))); this.v(p0, n, c, e); this.v(p1, n, c, e); this.v(p2, n, c, e); }
    quad(p0, p1, p2, p3, c, e = 0) { this.tri(p0, p1, p2, c, e); this.tri(p0, p2, p3, c, e); }
    line(p0, p1, c, e = 1) { this.v(p0, [0, 0, 0], c, e); this.v(p1, [0, 0, 0], c, e); }
    // a box from its eight corners (any shape of box), or a hull between two cross-sections
    hull(f, b, c, e = 0, caps = true) {               // f, b: matching rings of points
      const n = f.length;
      for (let i = 0; i < n; i++) { const j = (i + 1) % n; this.quad(f[i], f[j], b[j], b[i], c, e); }
      if (caps) for (let i = 1; i < n - 1; i++) { this.tri(f[0], f[i], f[i + 1], c, e); this.tri(b[0], b[i + 1], b[i], c, e); }
    }
    box(x0, y0, z0, x1, y1, z1, c, e = 0) { this.hull([[x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0]], [[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]], c, e); }
    f32() { return new Float32Array(this.a); }
  }
  // the unit tower: a box standing on y = 0, 1 wide, 1 tall, 1 deep
  const unitBox = () => { const b = new Builder(); b.box(-0.5, 0, -0.5, 0.5, 1, 0.5, [1, 1, 1]); return b.f32(); };
  const unitOcta = () => { const b = new Builder(), P = [[1, 0, 0], [0, 1, 0], [-1, 0, 0], [0, -1, 0]], F = [0, 0, 1], Bk = [0, 0, -1];
    for (let i = 0; i < 4; i++) { const a = P[i], c = P[(i + 1) % 4]; b.tri(a, c, F, [1, 1, 1], 1); b.tri(c, a, Bk, [1, 1, 1], 1); } return b.f32(); };
  // an anti-gravity racer: a long wedge of a body, a canopy, two pods on short wings, a tailplane between twin fins,
  // engines that glow; the body takes its team's colour, the rest stays dark (forward is +z, 4.4 long)
  const craftMesh = () => {
    const b = new Builder(), W = [1, 1, 1], D = [0.18, 0.18, 0.22], G = [0.05, 0.08, 0.12], E = [0.6, 1, 1];
    // the body: a hull from a sharp nose back to a wide, tall tail
    const ring = (z, w, h, y0) => [[-w, y0, z], [w, y0, z], [w * 0.7, y0 + h, z], [-w * 0.7, y0 + h, z]];
    const nose = ring(2.3, 0.08, 0.06, 0.05), mid = ring(0.6, 0.5, 0.42, 0), rear = ring(-1.8, 0.62, 0.55, 0);
    b.hull(nose, mid, W, 0, false); b.hull(mid, rear, W, 0, false);
    for (let i = 1; i < 3; i++) { b.tri(nose[0], nose[i], nose[i + 1], W); b.tri(rear[0], rear[i + 1], rear[i], D); }
    // the canopy: dark glass, a low wedge on top
    b.hull([[-0.22, 0.4, 0.9], [0.22, 0.4, 0.9], [0.14, 0.44, 0.9]], [[-0.3, 0.5, -0.4], [0.3, 0.5, -0.4], [0.0, 0.72, -0.4]], G, 0.15);
    for (const s of [-1, 1]) {
      // a wing out to the pod
      b.quad([s * 0.45, 0.12, 0.2], [s * 1.15, 0.1, 0.0], [s * 1.15, 0.1, -1.3], [s * 0.55, 0.12, -1.5], D);
      // the pod: a six-sided hull, tapered at the front
      const pod = (z, r) => [0, 1, 2, 3, 4, 5].map((k) => [s * 1.3 + Math.cos((k / 6) * TAU) * r, 0.12 + Math.sin((k / 6) * TAU) * r * 0.8, z]);
      b.hull(pod(1.3, 0.08), pod(0.6, 0.28), W, 0, false); b.hull(pod(0.6, 0.28), pod(-1.9, 0.3), W, 0, false);
      const back = pod(-1.9, 0.3); for (let i = 1; i < 5; i++) b.tri(back[0], back[i + 1], back[i], E, 1.6);   // the engine's glow
      // a fin standing on the pod
      b.quad([s * 1.3, 0.35, -0.6], [s * 1.3, 0.35, -1.85], [s * 1.38, 1.0, -2.0], [s * 1.36, 0.95, -1.4], D);
    }
    b.quad([-1.38, 0.95, -1.5], [1.38, 0.95, -1.5], [1.38, 0.98, -2.0], [-1.38, 0.98, -2.0], W);   // the tailplane
    b.quad([-0.5, 0.15, -1.82], [0.5, 0.15, -1.82], [0.4, 0.5, -1.82], [-0.4, 0.5, -1.82], E, 1.4); // the main engine
    return b.f32();
  };
  // a wireframe cube's 12 edges
  const CUBE_E = [[0, 1], [1, 2], [2, 3], [3, 0], [4, 5], [5, 6], [6, 7], [7, 4], [0, 4], [1, 5], [2, 6], [3, 7]];
  const CUBE_V = [[-1, -1, -1], [1, -1, -1], [1, 1, -1], [-1, 1, -1], [-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1]];

  // ------------------------------------------------------------------------------------------------ the track ---
  // a closed loop: a wobbly circle (never crossing itself), hills; a vertical loop (drifting sideways so it never meets
  // itself) and a tunnel; the frame level except through the loop (where it goes upside down), banked into turns
  class Track {
    constructor(seed) {
      const rng = mulberry(seed), M = 1400, R0 = 280;
      const A = [2, 3, 4, 5, 7].map((k) => ({ k, a: (rng() * 46) / Math.sqrt(k), p: rng() * TAU, h: (rng() * 16) / k, q: rng() * TAU }));
      const P = [];
      for (let i = 0; i < M; i++) {
        const th = (i / M) * TAU; let r = R0, y = 0;
        for (const o of A) { r += o.a * Math.sin(o.k * th + o.p); y += o.h * Math.sin(o.k * th + o.q); }
        P.push([Math.cos(th) * r, y, Math.sin(th) * r]);
      }
      // the loop: a circle of radius RL in the vertical, laid over the track's own forward run, drifting sideways
      const L0 = Math.floor(M * 0.58), K = 70, RL = 22, SIDE = 11, BACK = 110;
      this.loop = [L0, L0 + K]; this.tunnel = [Math.floor(M * 0.22), Math.floor(M * 0.22) + 130];
      const F0 = norm(sub(P[L0 + 1], P[L0 - 1])), S0 = norm(cross(F0, [0, 1, 0]));
      const ss = (u) => u * u * (3 - 2 * u);
      let Dw = 0; for (let k = 0; k < K; k++) Dw += Math.hypot(...sub(P[L0 + k + 1], P[L0 + k]));
      const RF = RL + Dw / TAU;                          // (the track's own run, folded into the loop: a round top)
      for (let k = 0; k <= K + BACK; k++) {
        const i = L0 + k, u = Math.min(1, k / K), lat = k <= K ? SIDE * ss(u) : SIDE * (1 - ss((k - K) / BACK));
        let q = mad(P[i], S0, lat);
        if (k <= K) q = add(add(q, mul(F0, RF * Math.sin(TAU * u))), [0, RL * (1 - Math.cos(TAU * u)), 0]);
        P[i] = q;
      }
      this.P = P; this.T = []; this.R = []; this.U = []; this.cum = [0];
      for (let i = 0; i < M; i++) this.T.push(norm(sub(P[(i + 1) % M], P[(i - 1 + M) % M])));
      // the frame: level (from the world's up) everywhere but the loop; through the loop its right-hand side stays
      // square to the loop's plane, so up turns with the track (upside down at the top), then eases back to level
      const LA = L0 - 6, LB = L0 + K + 6, LE = LB + 30, Rt = [];
      for (let i = 0; i < M; i++) {
        const T1 = this.T[i], lev = norm(cross(T1, [0, 1, 0]));
        if (i <= LA || i > LE) { Rt.push(lev); continue; }
        let q = sub(S0, mul(T1, dot(S0, T1)));
        if (i > LB) q = lerp3(norm(q), lev, (i - LB) / (LE - LB));
        Rt.push(norm(q));
      }
      const curv = [];
      for (let i = 0; i < M; i++) { const a = this.T[(i - 3 + M) % M], b = this.T[(i + 3) % M]; curv.push(cross(a, b)[1]); }
      const inLoop = (i) => i > L0 - 30 && i < L0 + K + 40;
      for (let i = 0; i < M; i++) {
        let c = 0; for (let k = -6; k <= 6; k++) c += curv[(i + k + M) % M]; c /= 13;
        const bank = inLoop(i) ? 0 : clamp(-c * 4 * 1.4, -0.35, 0.35) * (i > LE + 20 || i < LA - 20 ? 1 : 0.0), roll = bank, F = this.T[i];
        const R1 = Rt[i], U1 = cross(R1, F);
        this.R.push(norm(add(mul(R1, Math.cos(roll)), mul(U1, Math.sin(roll)))));
        this.U.push(norm(sub(mul(U1, Math.cos(roll)), mul(R1, Math.sin(roll)))));
      }
      for (let i = 1; i <= M; i++) this.cum.push(this.cum[i - 1] + Math.hypot(...sub(this.P[i % M], this.P[i - 1])));
      this.L = this.cum[M]; this.M = M;
      this.loopS = [this.cum[L0], this.cum[L0 + K]]; this.tunS = [this.cum[this.tunnel[0]], this.cum[this.tunnel[1]]];
    }
    at(s) {                                              // { p, f (forward), r (right), u (up) } at s metres along
      const L = this.L, M = this.M; s = ((s % L) + L) % L;
      let lo = 0, hi = M;
      while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (this.cum[mid] <= s) lo = mid; else hi = mid; }
      const t = (s - this.cum[lo]) / (this.cum[lo + 1] - this.cum[lo]), j = (lo + 1) % M;
      return { p: lerp3(this.P[lo], this.P[j], t), f: norm(lerp3(this.T[lo], this.T[j], t)), r: norm(lerp3(this.R[lo], this.R[j], t)), u: norm(lerp3(this.U[lo], this.U[j], t)) };
    }
    inTunnel(s) { const L = this.L; s = ((s % L) + L) % L; return s > this.tunS[0] && s < this.tunS[1]; }
    // the road: dark and wet, banded, lane lines; glowing rails; gates every so often; a tunnel of rings; boost
    // chevrons (the scene's own)
    build(c1, c2, chevrons) {
      const b = new Builder(), M = this.M, HW = 4.6, [t0, t1] = this.tunnel, [l0, l1] = this.loop;
      for (let i = 0; i < M; i++) {
        const j = (i + 1) % M, P0 = this.P[i], P1 = this.P[j], R0 = this.R[i], R1 = this.R[j], U0 = this.U[i], U1 = this.U[j];
        const band = (i >> 3) & 1 ? 0.15 : 0.12, road = [band, band, band * 1.25];
        b.quad(mad(P0, R0, -HW), mad(P0, R0, HW), mad(P1, R1, HW), mad(P1, R1, -HW), road, -1);   // (-1: wet)
        if ((i >> 1) & 1) for (const x of [-1.5, 1.5]) b.quad(mad(mad(P0, R0, x - 0.08), U0, 0.02), mad(mad(P0, R0, x + 0.08), U0, 0.02), mad(mad(P1, R1, x + 0.08), U1, 0.02), mad(mad(P1, R1, x - 0.08), U1, 0.02), [0.5, 0.5, 0.6], 0.6);
        for (const [s, c] of [[-1, c1], [1, c2]]) {     // the rails: a low glowing wall each side
          const a0 = mad(P0, R0, s * HW), a1 = mad(P1, R1, s * HW);
          b.quad(a0, a1, mad(a1, U1, 0.7), mad(a0, U0, 0.7), c, 1);
        }
        const free = !(i > t0 - 10 && i < t1 + 10) && !(i > l0 - 20 && i < l1 + 20);
        if (free && i % 80 === 0) {                      // a gate: two pillars and a beam, outlined in light
          const F = this.T[i], pil = (x) => { const q = mad(P0, R0, x); return [mad(mad(q, R0, -0.35), F, -0.35), mad(mad(q, R0, 0.35), F, -0.35), mad(mad(q, R0, 0.35), F, 0.35), mad(mad(q, R0, -0.35), F, 0.35)]; };
          for (const x of [-HW - 0.6, HW + 0.6]) { const f0 = pil(x); b.hull(f0, f0.map((q) => mad(q, U0, 6)), [0.1, 0.1, 0.14]); }
          const tp = mad(P0, U0, 6), bl = [mad(mad(tp, R0, -HW - 1), F, -0.4), mad(mad(tp, R0, HW + 1), F, -0.4), mad(mad(tp, R0, HW + 1), F, 0.4), mad(mad(tp, R0, -HW - 1), F, 0.4)];
          b.hull(bl, bl.map((q) => mad(q, U0, 0.9)), (i / 80) & 1 ? c1 : c2, 1.2);
        }
        if (i >= t0 && i < t1) {                         // the tunnel: dark panels round the road, a ring of light every few
          const ring = (k, Pk, Rk, Uk) => [0, 1, 2, 3, 4, 5, 6, 7].map((n) => { const a = (n / 8) * TAU + Math.PI / 8; return add(mad(Pk, Rk, Math.cos(a) * 7), mul(Uk, 2.4 + Math.sin(a) * 6)); });
          const A = ring(i, P0, R0, U0), B2 = ring(j, P1, R1, U1);
          for (let n = 0; n < 8; n++) { const m = (n + 1) % 8; if (n === 5) continue; b.quad(A[n], A[m], B2[m], B2[n], (i % 6) === 0 ? ((i / 6) & 1 ? c1 : c2) : [0.04, 0.03, 0.07], (i % 6) === 0 ? 1.3 : 0); }
        }
        if (chevrons && i % 60 === 25 && free) {          // boost chevrons on the road, in a lane
          const x = [-3, 0, 3][Math.floor(i / 60) % 3], F = this.T[i], q = mad(mad(P0, R0, x), U0, 0.04);
          for (let k = 0; k < 3; k++) { const qq = mad(q, F, k * 1.1); b.tri(mad(qq, R0, -1.1), mad(qq, F, 1), mad(qq, R0, 1.1), [1, 0.85, 0.1], 1.2); }
        }
      }
      return b.f32();
    }
  }

  // --------------------------------------------------------------------------------------------- the scenes ---
  let g3 = null, broken = false;
  const G = () => { if (!g3 && !broken) { try { g3 = new G3(); } catch (e) { broken = true; } } return broken || (g3 && g3.lost) ? null : g3; };
  const VB = new Float32Array(VSZ * 2 * 6000);                 // (this frame's own vertices)
  const put = (o, p, c, e) => { VB[o] = p[0]; VB[o + 1] = p[1]; VB[o + 2] = p[2]; VB[o + 3] = 0; VB[o + 4] = 0; VB[o + 5] = 0; VB[o + 6] = c[0]; VB[o + 7] = c[1]; VB[o + 8] = c[2]; VB[o + 9] = e; return o + VSZ; };
  const putN = (o, p, n, c, e) => { put(o, p, c, e); VB[o + 3] = n[0]; VB[o + 4] = n[1]; VB[o + 5] = n[2]; return o + VSZ; };
  const INST = new Float32Array(12 * 2000);
  const inst = (k, x, y, z, h, w, d, rot, c, e) => { const o = k * 12; INST[o] = x; INST[o + 1] = y; INST[o + 2] = z; INST[o + 3] = h; INST[o + 4] = w; INST[o + 5] = d; INST[o + 6] = rot; INST[o + 7] = 0; INST[o + 8] = c[0]; INST[o + 9] = c[1]; INST[o + 10] = c[2]; INST[o + 11] = e; };
  const meshOf = (g, key, make, prim, instanced) => g.meshes[key] || (g.meshes[key] = g.makeMesh(make(), prim == null ? g.gl.TRIANGLES : prim, false, instanced));
  const stOf = (g, key, init) => g.st[key] || (g.st[key] = init());
  // the 2D fallback when the GL is gone (a lost context)
  const fallback = (rv) => rv.cyberspace();
  // ---- the director: everything in the 3D scenes moves on its own clock (t3, s3), slowed in a breakdown (two bars
  // without a kick); a fill whips the camera round; a fast filter sweep is a dolly zoom; every 4 bars, another angle
  const director = (g, rv) => {
    const D = g.dir || (g.dir = { slow: 1, sweep: 0, whip: 0, whipDir: 1, cutPrev: 0.3, scrollPrev: rv.scroll, t3: rv.t, s3: rv.scroll, lastKick: null, fills: [], lastFill: -99, lastHack: -99 });
    const dt = rv.dt || 0.016, playing = rv.hooks.playing(), tempo = rv.hooks.params().tempo || 124, bar = 240 / tempo;
    const quiet = playing && !rv.racing && D.lastKick != null && rv.t - D.lastKick > bar * 2;
    D.slow += ((quiet ? 0.35 : 1) - D.slow) * Math.min(1, dt * 2);
    D.t3 += dt * D.slow; D.s3 += (rv.scroll - D.scrollPrev) * D.slow; D.scrollPrev = rv.scroll;
    const cut = rv.v && rv.v.cut != null ? rv.v.cut : 0.3, vel = (cut - D.cutPrev) / Math.max(dt, 0.008); D.cutPrev = cut;
    D.sweep = rv.calm || rv.racing ? 0 : Math.max(D.sweep * Math.pow(0.25, dt), Math.min(1, Math.abs(vel) * 0.7));
    D.whip *= Math.pow(0.03, dt); if (rv.calm) D.whip = 0;
    rv.t3 = D.t3; rv.s3 = D.s3; rv.camV = Math.floor(Math.max(0, rv.bar) / 4); rv.slowmo = D.slow;
    g.noDirect = !!rv.racing;
    return D;
  };
  // ---- particles in the world: sparks, debris, shockwaves (each a streak along its motion, glowing)
  const PT = [];
  const burst = (p, n, speed, c, opts = {}) => { for (let i = 0; i < n && PT.length < 900; i++) { const a = rnd() * TAU, b = (rnd() - 0.5) * Math.PI;
    const d = [Math.cos(a) * Math.cos(b), Math.sin(b) * (opts.flat ? 0.15 : 1) + (opts.up || 0), Math.sin(a) * Math.cos(b)];
    PT.push({ p: p.slice(), v: mul(norm(d), speed * (0.4 + rnd() * 0.6)), life: (opts.life || 0.8) * (0.6 + rnd() * 0.4), max: opts.life || 0.8, c, gr: opts.gr || 0, w: opts.w || 0.05 }); } };
  const drawParts = (g, dt) => {
    let o = 0;
    for (let i = PT.length - 1; i >= 0; i--) {
      const q = PT[i]; q.life -= dt; if (q.life <= 0) { PT.splice(i, 1); continue; }
      q.v[1] -= q.gr * dt; q.p = mad(q.p, q.v, dt);
      const k = q.life / q.max, c = mul(q.c, k * 1.6);
      o = put(o, q.p, c, 1); o = put(o, mad(q.p, q.v, -0.045), mul(c, 0.2), 1);
    }
    if (o) g.lines(VB, o / VSZ, 0.05);
  };
  // ---- rain: streaks round the camera, from nowhere (a hash of where and when), leaning with the wind
  const rain = (o, eye, t, n, c, spread = 30, lean = 0.15) => {
    for (let i = 0; i < n; i++) {
      const x = eye[0] + (hash(i, 1) - 0.5) * spread * 2, z = eye[2] + (hash(i, 2) - 0.2) * spread * 2;
      const y = eye[1] + 14 - (((t * (22 + hash(i, 3) * 10) + hash(i, 4) * 30) % 30));
      o = put(o, [x, y, z], c, 1); o = put(o, [x + lean, y + 1.1, z], mul(c, 0.15), 1);
    }
    return o;
  };
  // ---- words in 3D: the rave's words (on the accents) and the bass's notes, built of glowing cubes where they float
  const W3 = [];
  const word3 = (g, s, pos, k = 0.32, c = [1, 0.9, 0.2], life = 3) => {
    if (!g.camR) return;
    const F5 = R.util.F5, cells = [];
    [...s.toUpperCase()].forEach((ch, ci) => { const f = F5[ch]; if (!f) return; for (let y = 0; y < 7; y++) for (let x = 0; x < 5; x++) if (f[y * 5 + x] === "1") cells.push([(ci * 6 + x) * k, (6 - y) * k]); });
    const wdt = (s.length * 6 - 1) * k;
    W3.push({ m: frameM(pos, mul(g.camR, -1), g.camU, mul(g.camF, -1)), cells: cells.map(([x, y]) => [x - wdt / 2, y - 3 * k]), k, c, life, max: life });
    if (W3.length > 8) W3.shift();
  };
  const drawWords = (g, dt) => {
    for (let i = W3.length - 1; i >= 0; i--) {
      const w = W3[i]; w.life -= dt; if (w.life <= 0) { W3.splice(i, 1); continue; }
      const fade = Math.min(1, w.life / 0.6, (w.max - w.life) / 0.25); let n = 0;
      for (const [x, y] of w.cells) inst(n++, x, y, 0, w.k * 0.9, w.k * 0.9, w.k * 0.9, 0, mul(w.c, fade), 1.5);
      g.draw(meshOf(g, "box", unitBox, null, true), w.m, INST.subarray(0, n * 12), n);
    }
  };
  // ---- the hack: on a fill (now and then), the camera dives into a corridor of code and comes out in another scene
  const hackDraw = (g, rv) => {
    const h = g.hack, t = (rv.t - h.t0), sh = rv.slotShift(), z = 30 * t + 60 * t * t;
    g.noDirect = true;
    const eye = [0, 0, z], tgt = [Math.sin(t * 3) * 0.3, Math.cos(t * 2.5) * 0.3, z + 10], a = t * 2.2;
    g.begin(rv.W, [0, 0.02, 0.01], 0.05, eye, tgt, [Math.sin(a), Math.cos(a), 0], 1.2 + t * 0.4);
    let n = 0; const z0 = Math.floor(z / 1.2);
    for (let j = z0; j < z0 + 60; j++) for (let s2 = 0; s2 < 4; s2++) for (let k = -2; k <= 2; k++) {
      const hs = hash(j * 4 + s2, k); if (hs < 0.25) continue;
      const along = k * 1.15, sx = [along, along, 2.6, -2.6][s2], sy = [2.6, -2.6, along, along][s2];
      inst(n++, sx, sy - 0.5, j * 1.2, 1.0, 1.0, 1.0, 0, col(sh + 60 + hs * 90), 0.2 + (hash(j, s2 + 9) < 0.1 ? 1.5 : 0));
    }
    g.draw(meshOf(g, "box", unitBox, null, true), null, INST.subarray(0, n * 12), n, 1);
    g.blurK = Math.min(1, t * 1.2);
    if (t > 1.5) { g.hack = null; rv.flash = Math.max(rv.flash, rv.calm ? 0 : 0.8); const L = R.SCENES.map((_, i) => i).filter((i) => i >= R.BUILTIN && i !== rv.scene && R.SCENES[i] !== "ANTIGRAV");
      rv.go(L[(rnd() * L.length) | 0]); g.skipFade = true; }
  };
  const scene = (name, draw, extra = {}) => R.addScene({ name, ...extra, fn() {
    const g = G(); if (!g) { fallback(this); return; }
    try {
      if (!g.place(this)) { fallback(this); return; }
      this.buf.fill(0); this.layer3d = true;            // (the rave's own picture: only what goes over the top)
      const D = director(g, this);
      if (g.lastScene !== this.scene) {                 // a new scene: a crossfade from the last frame, a clean world
        if (g.lastScene != null && g.drewAt > this.t - 0.25 && !g.skipFade) g.fadeFromLast();
        g.skipFade = false; g.lastScene = this.scene; PT.length = 0; W3.length = 0;
      }
      if (this.word && !this.racing && this.vj.words !== false && extra.mesh) {   // (the rave's words, made solid)
        const w = this.word; this.word = null;
        if (!this.calm) word3(g, w.s, add(g.eye || [0, 0, 0], mul(g.camF || [0, 0, 1], 16 + rnd() * 6)), 0.34, col(this.slotShift() + 60 + rnd() * 120, 1.2));
      }
      if (g.hack) hackDraw(g, this);
      else {
        draw.call(this, g);
        if (this.word && extra.mesh) this.word = null;
        if (g.src === "full" && !this.racing) { drawWords(g, this.dt || 0.016); drawParts(g, this.dt || 0.016); }
      }
      g.end(this); g.drewAt = this.t;
    } catch (e) { broken = true; this.layer3d = false; console.error(e); fallback(this); }
  } });
  // the smooth layer shows only under a 3D scene; the rave's canvas goes see-through over it
  R.prototype.onLayer = function (on) { if (g3) g3.cv.style.display = on ? "" : "none"; if (this.cv) this.cv.classList.toggle("is-layer", on); };
  const base = (rv) => ({ sh: rv.slotShift(), k: rv.calm ? rv.kick * 0.3 : rv.kick, a: rv.accent, v: rv.v || {} });
  const MIRROR_Y0 = new Float32Array([1, 0, 0, 0, 0, -1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
  const mirrorAt = (y) => new Float32Array([1, 0, 0, 0, 0, -1, 0, 0, 0, 0, 1, 0, 0, 2 * y, 0, 1]);

  // DATA CITY ---------------------------------------------------------------------------------------------------
  // four angles (every 4 bars): down the avenue; high over the roofs; low and fast at street level; round a tower.
  // The street is wet (the city upside down in it, darker); rain; a worm, the bass line as a ribbon of light, crawls
  // down the avenue, each note a joint at its pitch's height
  scene("DATA CITY", function (g) {
    const { sh, k, a } = base(this), t = this.t3, C = 4, st = stOf(g, "city", () => ({ dive: 0, pulses: [], worm: [] }));
    st.dive = Math.max(st.dive * Math.pow(0.4, this.dt), a > 0.9 ? 1 : 0);
    const z = this.s3 * 7, cam = this.camV % 4;
    let eye, tgt, up = [Math.sin(t * 0.23) * 0.08, 1, 0], fov = 1.05;
    if (cam === 0) { const hy = 21 + Math.sin(t * 0.17) * 6 - st.dive * 11 - k * 0.8; eye = [Math.sin(t * 0.3) * 2, hy, z]; tgt = [Math.sin(t * 0.3 + 0.7) * 3, hy - 6 - st.dive * 3, z + 30]; }
    else if (cam === 1) { eye = [Math.sin(t * 0.11) * 14, 62 - st.dive * 10, z - 20]; tgt = [0, 0, z + 34]; fov = 0.9; }
    else if (cam === 2) { eye = [Math.sin(t * 0.5) * 1.2, 2.2 + k * 0.3, z]; tgt = [Math.sin(t * 0.5 + 0.4) * 2, 4, z + 20]; fov = 1.2; }
    else { const a2 = t * 0.35, cz = Math.floor(z / C) * C + 40; eye = [12 + Math.cos(a2) * 26, 18 + Math.sin(t * 0.2) * 6, cz + Math.sin(a2) * 26]; tgt = [12, 14, cz]; fov = 0.95; }
    const fog = col(sh + 40, 0.22);
    g.begin(this.W, fog, 0.014, eye, tgt, up, fov, 400, [0.0, 0.0, 0.02]);
    const j0 = Math.floor((cam === 3 ? eye[2] - 60 : z) / C) - 1, step = this.lastStep < 0 ? 0 : this.lastStep;
    let n = 0;
    for (let j = j0; j < j0 + 40; j++) {
      if (((j % 6) + 6) % 6 === 0) continue;               // (the cross streets)
      for (let i = -9; i <= 9; i++) {
        if (Math.abs(i) < 3) continue;                     // (the avenue)
        const hsh = hash(i, j), h = 4 + hsh * hsh * (10 + Math.abs(i) * 4), lit = (Math.abs(i * 7 + j * 13) + step) % 11 === 0 ? 0.7 : 0;
        let pu = 0; for (const p of st.pulses) if (p.i === i && p.j === j) pu = Math.max(pu, 1 - (this.t - p.t));
        inst(n++, i * C, 0, j * C, h, 3, 3, 0, col(sh + hsh * 90 + (i < 0 ? 0 : 60)), lit + pu * 1.5 + k * 0.15);
      }
    }
    const box = meshOf(g, "box", unitBox, null, true), towers = INST.slice(0, n * 12);
    g.dim(0.3); g.draw(box, MIRROR_Y0, towers, n, 1); g.dim(1);     // (the wet street: the city again, upside down, dim)
    g.draw(box, null, towers, n, 1);
    // the pulses: a ring climbing its tower
    let o = 0;
    st.pulses = st.pulses.filter((p) => this.t - p.t < 1);
    for (const p of st.pulses) {
      const hsh = hash(p.i, p.j), h = 4 + hsh * hsh * (10 + Math.abs(p.i) * 4), y = (this.t - p.t) * h, x = p.i * C, zz = p.j * C, c = col(sh + 140, 1.4);
      const q = [[x - 1.6, y, zz - 1.6], [x + 1.6, y, zz - 1.6], [x + 1.6, y, zz + 1.6], [x - 1.6, y, zz + 1.6]];
      for (let e = 0; e < 4; e++) { o = put(o, q[e], c, 1); o = put(o, q[(e + 1) % 4], c, 1); }
    }
    // the floor's grid, and the avenue's light lines
    const gc = col(sh + 200, 0.35), zA = j0 * C;
    for (let i = -10; i <= 10; i++) { o = put(o, [i * C - C / 2, 0.01, zA - 4], gc, 1); o = put(o, [i * C - C / 2, 0.01, zA + 170], gc, 1); }
    for (let j = j0; j < j0 + 40; j++) { o = put(o, [-36, 0.01, j * C - C / 2], gc, 1); o = put(o, [36, 0.01, j * C - C / 2], gc, 1); }
    const ac = col(sh + 60, 1);
    for (let j = j0; j < j0 + 34; j++) if (((j + step) & 3) === 0) { o = put(o, [-0.15, 0.02, j * C], ac, 1); o = put(o, [-0.15, 0.02, j * C + 1.6], ac, 1); o = put(o, [0.15, 0.02, j * C], ac, 1); o = put(o, [0.15, 0.02, j * C + 1.6], ac, 1); }
    g.lines(VB, o / VSZ, 0.06);
    // the worm: its joints crawl on down the avenue; a smooth ribbon through them, and its reflection
    for (const p of st.worm) p[2] += this.dt * 9 * this.slowmo;
    st.worm = st.worm.filter((p) => p[2] < z + 220).slice(-26);
    if (st.worm.length > 1) {
      o = 0; const wc = col(sh + 100, 1.5);
      for (let i = 0; i + 1 < st.worm.length; i++) {
        const p0 = st.worm[Math.max(0, i - 1)], p1 = st.worm[i], p2 = st.worm[i + 1], p3 = st.worm[Math.min(st.worm.length - 1, i + 2)];
        let prev = p1;
        for (let s2 = 1; s2 <= 6; s2++) {                // (Catmull-Rom, six pieces to a joint)
          const u = s2 / 6, u2 = u * u, u3 = u2 * u, cr = (a0, a1, a2, a3) => 0.5 * (2 * a1 + (-a0 + a2) * u + (2 * a0 - 5 * a1 + 4 * a2 - a3) * u2 + (-a0 + 3 * a1 - 3 * a2 + a3) * u3);
          const q = [cr(p0[0], p1[0], p2[0], p3[0]), cr(p0[1], p1[1], p2[1], p3[1]) + Math.sin(this.t * 6 + i + u) * 0.25, cr(p0[2], p1[2], p2[2], p3[2])];
          const fade = (i + u) / st.worm.length; o = put(o, prev, mul(wc, fade), 1); o = put(o, q, mul(wc, fade), 1); prev = q;
        }
      }
      g.lines(VB, o / VSZ, 0.22); g.lines(VB, o / VSZ, 0.22, MIRROR_Y0, 0.3);
    }
    // the rain (heavier as the resonance rises)
    o = rain(0, eye, this.t, 160 + Math.round((this.v.reso || 0.5) * 240), col(sh + 180, 0.55), 34, 0.25);
    g.lines(VB, o / VSZ, 0.012);
    st.z = z;
  }, { hacker: true, mesh: true });

  // GRID DIVE ---------------------------------------------------------------------------------------------------
  // three angles: diving forward; looking back at where it's been; straight down at the grid rushing under. The
  // floor mirrors the cubes; the bass's notes fly past as words
  scene("GRID DIVE", function (g) {
    const { sh, k, v } = base(this), t = this.t3, st = stOf(g, "dive", () => ({ pk: [] }));
    const z = this.s3 * 7, roll = ((v.cut || 0.3) - 0.5) * 0.9 + Math.sin(t * 0.4) * 0.15, cam = this.camV % 3;
    let eye = [Math.sin(t * 0.25) * 2, 1.2 + Math.sin(t * 0.33) * 0.8, z], tgt = [Math.sin(t * 0.25 + 0.5) * 3, 1, z + 20], up = [Math.sin(roll), Math.cos(roll), 0];
    if (cam === 1) { eye = [Math.sin(t * 0.25) * 2, 2.2, z + 18]; tgt = [Math.sin(t * 0.25 + 0.5) * 2, 1, z - 6]; }
    else if (cam === 2) { eye = [0, 14, z + 4]; tgt = [0, -1, z + 10]; up = [Math.sin(t * 0.2), 0, Math.cos(t * 0.2)]; }
    g.begin(this.W, [0.01, 0.0, 0.035], 0.018, eye, tgt, up, 1.1 + k * 0.08, 400, [0.0, 0.0, 0.01]);
    const fl = this.calm ? 0 : Math.max(this.clap, this.flash * 0.5), gc = col(sh + 170, 0.75 + fl), cc = col(sh + 120, 0.45 + fl);
    let o = 0;
    const zb = Math.min(eye[2], tgt[2]) - 10, z0 = Math.floor(zb / 2) * 2;
    for (const [y, c] of [[-1, gc], [7, cc]]) {
      for (let x = -40; x <= 40; x += 2) { o = put(o, [x, y, zb], c, 1); o = put(o, [x, y, zb + 110], c, 1); }
      for (let zz = z0; zz < zb + 110; zz += 2) { o = put(o, [-40, y, zz], c, 1); o = put(o, [40, y, zz], c, 1); }
    }
    // packets along the lines
    if (this.hat > 0.9 && !st.hat) for (let i = 0; i < 3; i++) st.pk.push({ x: Math.round((rnd() - 0.5) * 30) * 2, y: rnd() < 0.5 ? -1 : 7, z: z + 70 + rnd() * 30, v: 40 + rnd() * 40 });
    st.hat = this.hat > 0.9;
    const pc = col(sh + 40, 1.6);
    st.pk = st.pk.filter((p) => p.z > zb);
    for (const p of st.pk) { p.z -= p.v * this.dt * this.slowmo; o = put(o, [p.x, p.y, p.z], pc, 2); o = put(o, [p.x, p.y, p.z + 3], [pc[0] * 0.3, pc[1] * 0.3, pc[2] * 0.3], 1); }
    g.lines(VB, o / VSZ, 0.035);
    // data cubes, turning, swelling on the kick; and their reflections in the floor
    o = 0;
    for (let i = Math.floor(zb / 9); i < Math.floor(zb / 9) + 13; i++) {
      const hs = hash(i, 5); if (hs < 0.35) continue;
      const cxyz = [(hash(i, 1) - 0.5) * 26, 1.5 + hash(i, 2) * 4, i * 9], s = 1.1 + hs * 1.2 + k * 0.5, ay = t * (0.5 + hs), ax = t * 0.7;
      const m = rotYX(ay, ax), c = col(28 + ((sh + hs * 120 + 60) % 196), 1.6);
      for (const [p, q] of CUBE_E) { o = put(o, add(cxyz, mul(xform(m, CUBE_V[p]), s)), c, 1); o = put(o, add(cxyz, mul(xform(m, CUBE_V[q]), s)), c, 1); }
    }
    g.lines(VB, o / VSZ, 0.04); g.lines(VB, o / VSZ, 0.04, mirrorAt(-1), 0.3);
    st.z = z;
  }, { hacker: true, mesh: true });

  // VIRUS -------------------------------------------------------------------------------------------------------
  // the lattice the squelch infects; a worm (the bass line) crawls through it a node a step, infecting as it goes;
  // two angles: the slow orbit, and close in among the nodes
  const VN = 7, VS = 1.7;
  scene("VIRUS", function (g) {
    const { sh, k, v } = base(this), t = this.t3, NN = VN * VN * VN;
    const st = stOf(g, "virus", () => ({ inf: new Float32Array(NN), tgt: new Uint8Array(NN), step: -1, flash: 0, worm: [(rnd() * NN) | 0] }));
    if (!st.tgt.some((x) => x)) st.tgt[(rnd() * NN) | 0] = 1;
    const id = (x, y, z) => (x * VN + y) * VN + z, xyz = (i) => [Math.floor(i / (VN * VN)), Math.floor(i / VN) % VN, i % VN], heal = (this.fx >> 3) & 3;
    if (this.lastStep !== st.step && this.lastStep >= 0) {   // each step: the squelch spreads it; REVERSE or TAPE STOP heal
      st.step = this.lastStep;
      const sq = clamp((v.reso || 0.5) * 0.5 + (v.env || 0) * 0.6 + (v.cut || 0.3) * 0.2, 0, 1);
      const nx = st.tgt.slice();
      for (let x = 0; x < VN; x++) for (let y = 0; y < VN; y++) for (let z = 0; z < VN; z++) {
        const i = id(x, y, z);
        if (heal) { if (st.tgt[i] && rnd() < 0.3) nx[i] = 0; continue; }
        if (!st.tgt[i]) continue;
        for (const [dx, dy, dz] of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]) {
          const a = x + dx, b = y + dy, c = z + dz;
          if (a >= 0 && b >= 0 && c >= 0 && a < VN && b < VN && c < VN && rnd() < sq * 0.22) nx[id(a, b, c)] = 1;
        }
      }
      // the worm: a step to a neighbour (the clean ones first), infecting it
      const [hx, hy, hz] = xyz(st.worm[st.worm.length - 1]), opts = [];
      for (const [dx, dy, dz] of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]) {
        const a = hx + dx, b = hy + dy, c = hz + dz; if (a < 0 || b < 0 || c < 0 || a >= VN || b >= VN || c >= VN) continue;
        const j = id(a, b, c); if (st.worm.includes(j)) continue; opts.push(j);
      }
      if (opts.length) { const clean = opts.filter((j) => !nx[j]), pick = (clean.length ? clean : opts)[(rnd() * (clean.length || opts.length)) | 0]; st.worm.push(pick); if (!heal) nx[pick] = 1; }
      else st.worm = [st.worm[st.worm.length - 1]];
      if (st.worm.length > 12) st.worm.shift();
      if (this.accent > 0.9) nx[(rnd() * NN) | 0] = 1;
      st.tgt = nx;
      if (st.inf.every((q) => q > 0.92)) { st.tgt.fill(0); st.inf.fill(0); st.flash = 1; this.word = this.calm ? null : { s: "PURGED", life: 1 }; }
    }
    st.flash *= Math.pow(0.05, this.dt);
    for (let i = 0; i < NN; i++) st.inf[i] += (st.tgt[i] - st.inf[i]) * Math.min(1, this.dt * 2.5);
    const close = this.camV % 2 === 1, R0 = close ? 11.5 : 17;
    const eye = [Math.sin(t * 0.18) * R0, (close ? 2 : 5) + Math.sin(t * 0.11) * (close ? 2 : 5), Math.cos(t * 0.18) * R0];
    g.begin(this.W, [0.01, 0.0, 0.03], 0.02, eye, [0, 0, 0], [0, 1, 0], close ? 1.15 : 0.9);
    const m = rotYX(t * 0.1, 0.2), clean = col(sh + 170, 0.8), sick = [1, 0.12, 0.3], P = (x, y, z) => [(x - (VN - 1) / 2) * VS, (y - (VN - 1) / 2) * VS, (z - (VN - 1) / 2) * VS];
    let n = 0;
    for (let x = 0; x < VN; x++) for (let y = 0; y < VN; y++) for (let z = 0; z < VN; z++) {
      const i = id(x, y, z), f = st.inf[i], p = P(x, y, z), s = 0.32 + f * 0.18 + f * k * 0.25;
      inst(n++, p[0], p[1] - s / 2, p[2], s, s, s, t * f * 2, lerp3(clean, sick, f), 0.3 + f * (0.55 + k * 0.6));
    }
    g.draw(meshOf(g, "box", unitBox, null, true), m, INST.subarray(0, n * 12), n);
    let o = 0;
    for (let x = 0; x < VN; x++) for (let y = 0; y < VN; y++) for (let z = 0; z < VN; z++) {
      const i = id(x, y, z), p = P(x, y, z);
      for (const [dx, dy, dz] of [[1, 0, 0], [0, 1, 0], [0, 0, 1]]) {
        const a = x + dx, b = y + dy, c = z + dz; if (a >= VN || b >= VN || c >= VN) continue;
        const f = (st.inf[i] + st.inf[id(a, b, c)]) / 2, cc = lerp3(mul(clean, 0.3), sick, f);
        o = put(o, p, cc, 1); o = put(o, P(a, b, c), cc, 1);
      }
    }
    g.drawDyn(VB, o / VSZ, g.gl.LINES, m);
    o = 0; const wc = col(sh + 40, 1.8);                  // (the worm, bright, thick)
    for (let i = 0; i + 1 < st.worm.length; i++) { const f = (i + 1) / st.worm.length; o = put(o, P(...xyz(st.worm[i])), mul(wc, f), 1); o = put(o, P(...xyz(st.worm[i + 1])), mul(wc, f), 1); }
    g.lines(VB, o / VSZ, 0.16, m);
    if (st.flash > 0.05 && !this.calm) this.flash = Math.max(this.flash, st.flash * 0.6);
    let sum = 0; for (let i = 0; i < NN; i++) sum += st.inf[i];
    this.virusPct = Math.round((sum / NN) * 100);
  }, { hacker: true, mesh: true });

  // FILE SYSTEM -------------------------------------------------------------------------------------------------
  // three angles: down the corridor; tracking along a wall of files; overhead, looking down into it
  scene("FILE SYSTEM", function (g) {
    const { sh, k } = base(this), t = this.t3, st = stOf(g, "files", () => ({ open: [] }));
    const z = this.s3 * 6, cam = this.camV % 3;
    let eye = [Math.sin(t * 0.4) * 0.8, 2.6 + Math.sin(t * 0.27) * 0.6, z], tgt = [Math.sin(t * 0.4 + 0.4) * 1.2, 2.3, z + 14];
    if (cam === 1) { eye = [-1.8, 2.2, z + 4]; tgt = [4.2, 2.0, z + 9]; }
    else if (cam === 2) { eye = [0, 11, z - 2]; tgt = [0, 0, z + 12]; }
    g.begin(this.W, col(sh + 190, 0.1), 0.035, eye, tgt, [Math.sin(t * 0.3) * 0.05, 1, 0]);
    const D = 1.3, j0 = Math.floor(z / D) - 3;
    st.open = st.open.filter((q) => this.t - q.t < 2);
    let n = 0;
    for (let j = j0; j < j0 + 48; j++) for (const sd of [-1, 1]) for (let r = 0; r < 3; r++) {
      const hs = hash(j * 2 + (sd > 0 ? 1 : 0), r); if (hs < 0.12) continue;
      let ox = 0, rot = 0, em = 0.1;
      for (const q of st.open) if (q.j === j && q.s === sd && q.r === r) { const f = Math.sin(Math.min(1, (this.t - q.t) / 2) * Math.PI); ox = -sd * f * 1.8; rot = f * 1.2; em = 0.1 + f * 1.4; }
      inst(n++, sd * 4.2 + ox, r * 1.9, j * D, 1.5, 0.08, 1.0, rot, col(sh + hs * 70 + r * 30 + 110), em + k * 0.1);
    }
    const box = meshOf(g, "box", unitBox, null, true), cards = INST.slice(0, n * 12);
    g.dim(0.25); g.draw(box, mirrorAt(-0.1), cards, n, 1); g.dim(1);   // (a polished floor)
    g.draw(box, null, cards, n, 1);
    // the folders overhead: slabs with tabs, every 26 metres, outlined in light; the shelves; the floor
    let o = 0;
    const fc = col(sh + 50, 1.2), shc = col(sh + 200, 0.4);
    for (let f = Math.floor(z / 26) - 1; f < Math.floor(z / 26) + 4; f++) {
      const zz = f * 26 + 13, y = 6.2, q = [[-4.8, y, zz - 3], [4.8, y, zz - 3], [4.8, y, zz + 3], [-4.8, y, zz + 3]];
      for (let e = 0; e < 4; e++) { o = put(o, q[e], fc, 1); o = put(o, q[(e + 1) % 4], fc, 1); }
      const tb = [[-4.8, y, zz - 3], [-4.8, y + 0.7, zz - 2.6], [-4.8, y + 0.7, zz - 0.4], [-4.8, y, zz]];
      for (let e = 0; e < 3; e++) { o = put(o, tb[e], fc, 1); o = put(o, tb[e + 1], fc, 1); }
    }
    for (const sd of [-1, 1]) for (let r = 0; r < 4; r++) { o = put(o, [sd * 4.3, r * 1.9 - 0.05, z - 6], shc, 1); o = put(o, [sd * 4.3, r * 1.9 - 0.05, z + 60], shc, 1); }
    for (let x = -3; x <= 3; x += 1.5) { o = put(o, [x, -0.1, z - 6], shc, 1); o = put(o, [x, -0.1, z + 60], shc, 1); }
    g.lines(VB, o / VSZ, 0.03);
    st.j0 = j0 + 2;
  }, { hacker: true, mesh: true });

  // ANTIGRAV (and the race) -------------------------------------------------------------------------------------
  const HW = 4.6, LANES = [-3, 0, 3], STEP_M = 6;
  const trackFor = (g, seed, sh) => {
    const key = "track" + seed + ":" + (sh & 255);
    if (g.trackKey !== key) {
      g.track = new Track(seed); g.trackKey = key;
      if (g.meshes.track) g.gl.deleteVertexArray(g.meshes.track.vao);
      g.meshes.track = g.makeMesh(g.track.build(col(sh + 150), col(sh + 30), true), g.gl.TRIANGLES);
      // the far city: dark blocks round the outside, their tops lit
      const b = new Builder(), rng = mulberry(seed ^ 0x5bd1);
      for (let i = 0; i < 160; i++) {
        const a = rng() * TAU, r = 430 + rng() * 300, x = Math.cos(a) * r, z = Math.sin(a) * r, w = 10 + rng() * 26, h = 20 + rng() * rng() * 160;
        b.box(x - w / 2, -60, z - w / 2, x + w / 2, h - 60, z + w / 2, [0.05, 0.04, 0.09]);
        b.box(x - w / 2, h - 61, z - w / 2, x + w / 2, h - 60, z + w / 2, col(sh + rng() * 200), 1);
      }
      if (g.meshes.city) g.gl.deleteVertexArray(g.meshes.city.vao);
      g.meshes.city = g.makeMesh(b.f32(), g.gl.TRIANGLES);
    }
    return g.track;
  };
  // a craft on the track: s metres along, x across, its roll, a hop; its model matrix
  const craftAt = (T, s, x, roll, bob) => {
    const f = T.at(s), p = mad(mad(f.p, f.r, x), f.u, 0.85 + bob);
    const r = norm(add(mul(f.r, Math.cos(roll)), mul(f.u, Math.sin(roll)))), u = norm(sub(mul(f.u, Math.cos(roll)), mul(f.r, Math.sin(roll))));
    return { m: frameM(p, mul(r, -1), u, f.f), p, f: f.f, r, u, tr: f };
  };
  // the exhaust: two flames out of the pods and one from the middle, longer with a boost; and the engines' light on
  // the wet road under it (drawn glowing)
  const flames = (o, c, boost, t, colr, hop = 0) => {
    const L = 0.8 + boost * 2.2 + Math.sin(t * 50) * 0.15;
    for (const [x, y, w] of [[1.3, 0.12, 0.26], [-1.3, 0.12, 0.26], [0, 0.32, 0.3]]) {
      const P = (lx, ly, lz) => add(add(add(c.p, mul(c.r, -lx)), mul(c.u, ly)), mul(c.f, lz));
      const tip = P(x, y, -1.95 - L);
      o = put(o, P(x - w, y, -1.92), colr, 1); o = put(o, P(x + w, y, -1.92), colr, 1); o = put(o, tip, [colr[0] * 0.2, colr[1] * 0.2, colr[2] * 0.4], 1);
      o = put(o, P(x, y - w * 0.8, -1.92), colr, 1); o = put(o, P(x, y + w * 0.8, -1.92), colr, 1); o = put(o, tip, [colr[0] * 0.2, colr[1] * 0.2, colr[2] * 0.4], 1);
    }
    const k = 0.35 / (1 + hop * 3), cc = mul(colr, k), back = 2 + boost * 5;   // (the glow on the road)
    const base0 = mad(mad(c.p, c.u, -0.83 - hop), c.f, -1.9), side = mul(c.r, 1.4);
    o = put(o, add(base0, side), cc, 1); o = put(o, sub(base0, side), cc, 1); o = put(o, mad(base0, c.f, -back), [0, 0, 0], 1);
    return o;
  };
  const TEAM = (sh, i) => col(28 + ((sh + [0, 50, 100, 150, 25, 75, 125, 175][i % 8]) % 196));   // (never the palette's dark ends)
  const raceFog = (sh, wx) => wx === 2 ? lerp3(col(sh + 40, 0.3), [0.09, 0.1, 0.13], 0.6) : col(sh + 40, 0.3);
  const RACE_ZEN = [0.0, 0.0, 0.03];
  const drawWorld = (g) => { const k = R.debug3D.skip; if (!k.track) g.draw(g.meshes.track); if (!k.city) g.draw(g.meshes.city); };

  scene("ANTIGRAV", function (g) {
    if (this.racing) { race.draw(this, g); return; }
    const { sh, a } = base(this), t = this.t3, T = trackFor(g, 1 + (this.hooks.slot() | 0), sh);
    const st = stOf(g, "ag", () => ({ boost: 0 }));
    st.boost = Math.max(st.boost * Math.pow(0.3, this.dt), a > 0.9 ? 1 : 0);
    const s0 = this.s3 * 24 + st.boost * 2;
    // the pack: five craft, jostling
    const pack = [];
    for (let i = 0; i < 5; i++) {
      const ds = [0, -9, 7, -18, 15][i] + Math.sin(t * 0.31 + i * 2.1) * 5 + (i === 0 ? st.boost * 4 : 0), x = Math.sin(t * 0.47 + i * 1.7) * 2.6;
      const roll = Math.cos(t * 0.47 + i * 1.7) * -0.35;
      pack.push({ c: craftAt(T, s0 + ds, x, roll, Math.sin(t * 5 + i) * 0.06), i });
    }
    const lead = pack[0].c, cam = this.camV % 4, f0 = T.at(s0);
    let eye, tgt, up = lead.u, fov = 1.0 + st.boost * 0.15;
    if (cam === 0) { eye = add(add(lead.p, mul(lead.f, -8)), mul(f0.u, 2.4)); tgt = add(add(lead.p, mul(lead.f, 7)), mul(f0.u, 0.6)); }
    else if (cam === 1) {                                 // trackside: a post up ahead, watching them come by
      const ps = Math.floor((s0 + 40) / 90) * 90 + 45, pf = T.at(ps), sd = (Math.floor((s0 + 40) / 90) & 1) ? 1 : -1;
      eye = add(add(pf.p, mul(pf.r, sd * (HW + 2.5))), mul(pf.u, 1.6)); tgt = add(lead.p, mul(f0.u, 0.4)); up = pf.u; fov = 0.75;
    } else if (cam === 2) {                               // in front, low, looking back at the pack
      const fa = T.at(s0 + 26); eye = add(add(fa.p, mul(fa.u, 1.3)), mul(fa.r, 2.2)); tgt = add(lead.p, mul(f0.u, 0.4)); up = fa.u; fov = 0.85;
    }
    else { eye = add(add(lead.p, mul(f0.u, 26)), mul(lead.f, -14)); tgt = add(lead.p, mul(lead.f, 12)); }
    g.begin(this.W, raceFog(sh), 0.0045, eye, tgt, up, fov, 1400, RACE_ZEN);
    drawWorld(g);
    const cm = meshOf(g, "craft", craftMesh);
    for (const q of pack) drawCraft(g, cm, q.c.m, TEAM(sh, q.i));
    g.glow(true); let o = 0;
    for (const q of pack) o = flames(o, q.c, q.i === 0 ? st.boost : 0.2, this.t + q.i, col(sh + 130, 1));
    g.drawDyn(VB, o / VSZ, g.gl.TRIANGLES); g.glow(false);
    if (st.boost > 0.5 && rnd() < 0.5) burst(mad(lead.p, lead.f, -2.4), 3, 9, col(sh + 130, 1.2), { life: 0.4 });
    if (st.boost > 0.3 && cam !== 1) { speedLines(this, st.boost); g.blurK = st.boost * 0.6; g.dofK = st.boost * 0.7; }
  }, { mesh: true });
  // a craft in its team's colour (the mesh's white parts take it)
  const drawCraft = (g, cm, m, c) => {
    const gl = g.gl;
    gl.uniformMatrix4fv(g.u.uM, false, m); gl.uniform1i(g.u.uMode, 0);
    gl.bindVertexArray(cm.vao); gl.vertexAttrib4f(4, 0, 0, 0, 1); gl.vertexAttrib4f(5, 1, 1, 0, 0); gl.vertexAttrib4f(6, c[0], c[1], c[2], 0);
    gl.drawArrays(gl.TRIANGLES, 0, cm.n); gl.bindVertexArray(null);
  };
  // streaks from the middle out, on a boost (the last pass draws them)
  const speedLines = (rv, k) => { rv.speedK = k; };
  // FRACTAL, CHROME, SKYFLIGHT ----------------------------------------------------------------------------------
  const unis = (rv, extra) => {
    const { sh, k, a, v } = base(rv);
    return { uT: rv.t3, uK: k, uA: rv.calm ? 0 : a, uCut: v.cut == null ? 0.3 : v.cut, uRs: v.reso == null ? 0.6 : v.reso, uEnv: v.env || 0,
      uC1: col(sh + 140), uC2: col(sh + 60), uC3: col(sh + 200), ...extra };
  };
  scene("FRACTAL", function (g) { g.fullscreen("fractal", FRACTAL_FS, this.W, unis(this, { uZ: this.s3 * 1.5 })); });
  scene("CHROME", function (g) { g.fullscreen("chrome", CHROME_FS, this.W, unis(this, {})); });
  scene("SKYFLIGHT", function (g) {
    const d = this.driftInfo || {}, drift = !!this.driftMode;
    const st = stOf(g, "sky", () => ({ z: 0, bolt: 0 }));
    st.z += this.dt * this.slowmo * (drift ? 4 : 2 + (this.hooks.params().tempo || 120) / 30);
    const w = drift ? d.w || 0 : 0.1;
    if (w > 0.8 && rnd() < this.dt * (w - 0.8) * 1.2 && !this.calm) st.bolt = 1;
    st.bolt *= Math.pow(0.002, this.dt);
    g.fullscreen("sky", SKY_FS, this.W, unis(this, { uZ: st.z, uW: w, uMood: [drift ? d.mx || 0.5 : 0.5, drift ? d.my || 0.5 : 0.6], uBloom: this.bloom || 0, uBolt: st.bolt }));
  }, { calm: true });

  // ------------------------------------------------------------------------------------------------- the race ---
  // the pattern, laid down the track: each step is 6 metres; a note is an orb in its lane (its pitch picks it), an
  // accent a boost pad (and a hop), a snare or clap where nothing plays a barrier; some claps an EMP, an open hat a
  // shield. The craft is where the music is, always on the beat, so catching is steering. One player: seven rivals
  // move ahead and behind with how it goes, and a ghost of the best run on this track (the pattern makes the track:
  // the same pattern, the same track; the best five scores kept). Two players: a screen each, side by side.
  const patternSeed = (p) => {
    const len = p.len || 16, s = JSON.stringify([len, p.bass.slice(0, len).map((b) => (b.on ? [b.note, b.oct || 0, b.acc ? 1 : 0] : 0)), p.drums.map((r) => r.slice(0, len).map((x) => (x ? 1 : 0)).join(""))]);
    let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0) % 1000003;
  };
  const store = { get(k, d) { try { return JSON.parse(localStorage.getItem("acid-flower-race-" + k)) || d; } catch { return d; } }, set(k, v) { try { localStorage.setItem("acid-flower-race-" + k, JSON.stringify(v)); } catch {} } };
  const WX = ["CLEAR", "RAIN", "STORM"];
  const race = {
    on: false, two: false, beat: 0,
    player(i) { return { i, x: this.two ? (i ? 1.5 : -1.5) : 0, vx: 0, steer: 0, target: null, score: 0, combo: 0, best: 0, boost: 0, slow: 0, shake: 0, shield: 0, hop: 0, msg: null, taken: new Set(), rec: [] }; },
    start(rv, two) {
      if (two != null) this.two = !!two;
      const p = rv.hooks.pattern();
      this.on = true; rv.racing = true; this.state = "wait"; this.abs = null; this.items = new Map();
      this.seed = patternSeed(p); this.laps = 3; this.wx = this.seed % 3; this.bolt = 0;
      this.P = this.two ? [this.player(0), this.player(1)] : [this.player(0)];
      this.riv = this.two ? [] : [-14, 10, -26, 22, 4, -6, 34].map((d, i) => ({ d, pace: 1, x: LANES[i % 3], ph: rnd() * TAU }));
      this.ghost = this.two ? null : store.get("ghost-" + this.seed, null); this.board = store.get("board-" + this.seed, []);
      rv.go(R.SCENES.indexOf("ANTIGRAV"));
    },
    stop(rv) { this.on = false; rv.racing = false; },
    item(p, abs) {                                       // what the pattern puts at an absolute step
      if (this.items.has(abs)) return this.items.get(abs);
      const len = p.len || 16, i = ((abs % len) + len) % len, b = p.bass[i], D = p.drums, hs = hash(abs, this.seed);
      let it = null;
      if (b && b.on) it = { k: b.acc ? "boost" : "orb", lane: (((b.note + (b.oct || 0) * 5) % 3) + 3) % 3 };
      else if (D[2] && D[2][i] && hs < 0.3) it = { k: "emp", lane: (hash(abs, 7) * 3) | 0 };
      else if ((D[2] && D[2][i]) || (D[1] && D[1][i])) it = { k: "wall", lane: (hs * 3) | 0 };
      else if (D[4] && D[4][i] && hs < 0.5) it = { k: "shield", lane: (hash(abs, 9) * 3) | 0 };
      this.items.set(abs, it);
      if (this.items.size > 400) this.items.delete(this.items.keys().next().value);
      return it;
    },
    onStep(rv, m, T) {
      const p = rv.hooks.pattern(), len = p.len || 16;
      if (this.abs == null) { this.abs = m.step; this.last = m.step; }
      else { let dlt = m.step - this.last; if (dlt <= 0) dlt += len; this.abs += dlt; this.last = m.step; }
      this.tStep = performance.now(); this.stepDur = 60000 / (rv.hooks.params().tempo || 124) / 4;
      if (this.state === "wait") { this.go0 = (Math.floor(this.abs / 16) + 2) * 16; this.state = "count"; this.items.clear(); }
      if (this.state === "count" && this.abs >= this.go0) { this.state = "race"; this.startAbs = this.go0; for (const q of this.P) q.msg = { s: "GO!", t: 1 }; }
      if (this.state === "count") { const left = Math.ceil((this.go0 - this.abs) / 4); if (left !== this.cd && left <= 3) { this.cd = left; for (const q of this.P) q.msg = { s: String(left), t: 0.6 }; } }
      if (this.state === "done" && this.abs >= this.next) this.start(rv);
      if (this.state !== "race") return;
      const it = this.item(p, this.abs), k = this.abs - this.startAbs;
      for (const q of this.P) {
        q.rec[k] = Math.round(q.x * 20);                 // (for the ghost)
        if (!it || q.taken.has(this.abs)) continue;
        const hit = Math.abs(q.x - LANES[it.lane]) < 1.4;
        if (it.k === "wall") {
          if (!hit) continue;
          if (q.shield) { q.shield = 0; q.msg = { s: "SAVED", t: 0.6 }; this.fx(q, "shield"); continue; }
          q.combo = 0; q.slow = 1; q.shake = 1; rv.shake = Math.max(rv.shake, 1); q.msg = { s: "OUCH", t: 0.6 }; this.fx(q, "crash");
        } else if (hit) {
          q.taken.add(this.abs);
          if (it.k === "shield") { q.shield = 1; q.msg = { s: "SHIELD", t: 0.7 }; this.fx(q, "shield"); continue; }
          if (it.k === "emp") {                          // the EMP: the craft ahead knocked back (or, two up, the other one shaken)
            q.msg = { s: "EMP", t: 0.7 }; this.fx(q, "emp");
            if (this.two) { const o = this.P[1 - q.i]; if (o.shield) o.shield = 0; else { o.slow = 1; o.shake = 1; o.combo = 0; o.msg = { s: "HIT", t: 0.6 }; } }
            else for (const r of this.riv) if (r.d > 0 && r.d < 90) r.d -= 30;
            continue;
          }
          q.combo++; q.best = Math.max(q.best, q.combo);
          const mult = Math.min(8, 1 + (q.combo >> 3));
          q.score += (it.k === "boost" ? 50 : 10) * mult;
          if (it.k === "boost") { q.boost = 1; q.hop = 1; q.msg = { s: "BOOST", t: 0.7 }; rv.flash = Math.max(rv.flash, rv.calm ? 0 : 0.2); this.fx(q, "boost"); }
          else { q.boost = Math.max(q.boost, 0.25); this.fx(q, "orb"); }
          if (mult > 1 && q.combo % 8 === 0) q.msg = { s: "X" + mult, t: 0.8 };
        } else if (it.k === "orb" || it.k === "boost") { if (q.combo >= 8) q.msg = { s: "MISS", t: 0.5 }; q.combo = 0; q.slow = Math.max(q.slow, 0.3); }
      }
      const lap = Math.floor((k * STEP_M) / this.L);
      if (lap >= this.laps) this.finish(rv);
    },
    fx(q, kind) { (this.fxq = this.fxq || []).push([q.i, kind]); },
    finish(rv) {
      this.state = "done"; this.next = this.abs + 64;
      if (this.two) { const [a, b] = this.P, w = a.score === b.score ? 0 : a.score > b.score ? 1 : 2; for (const q of this.P) q.msg = { s: w ? "P" + w + " WINS" : "DRAW", t: 5 }; return; }
      const q = this.P[0]; this.place = this.pos();
      q.msg = { s: "FINISH P" + this.place, t: 4 };
      const board = this.board.concat([{ s: q.score, d: new Date().toISOString().slice(0, 10) }]).sort((x, y) => y.s - x.s).slice(0, 5);
      this.rank = board.findIndex((e) => e.s === q.score) + 1; this.board = board; store.set("board-" + this.seed, board);
      if (!this.ghost || q.score > this.ghost.s) { store.set("ghost-" + this.seed, { s: q.score, x: q.rec }); this.newBest = true; } else this.newBest = false;
    },
    pos() { return 1 + this.riv.filter((r) => r.d > 0).length; },
    steerP(q, dt) {                                      // steering: the keys, or a finger's place
      const want = q.target != null ? q.target * HW * 0.85 : q.x + q.steer * 6;
      const tx = clamp(want, -HW + 1.2, HW - 1.2), ax = (tx - q.x) * 60 - q.vx * 14;
      q.vx += ax * dt; q.x = clamp(q.x + q.vx * dt, -HW + 1, HW - 1);
      q.boost *= Math.pow(0.35, dt); q.slow *= Math.pow(0.25, dt); q.shake *= Math.pow(0.02, dt); q.hop *= Math.pow(0.04, dt);
    },
    draw(rv, g) {
      const { sh } = base(rv), t = rv.t, dt = rv.dt, T = trackFor(g, 7 + this.seed, sh);
      this.L = T.L;
      const frac = this.abs == null ? 0 : clamp((performance.now() - this.tStep) / (this.stepDur || 120), 0, 1);
      const sPlay = this.abs == null ? 0 : (this.abs + frac) * STEP_M;
      for (const q of this.P) this.steerP(q, dt);
      if (this.two) {                                    // (two craft side by side: they bump)
        const [a, b] = this.P, d = b.x - a.x;
        if (Math.abs(d) < 1.8) { const push = (1.8 - Math.abs(d)) * 0.5 * Math.sign(d || 1); a.x -= push; b.x += push; a.vx -= push * 8; b.vx += push * 8; }
      }
      const pace = 1 + this.P[0].boost * 0.5 - this.P[0].slow * 0.4;
      if (this.state === "race") for (const r of this.riv) {   // the rivals: each its own changing pace
        r.pace = 1.03 + Math.sin(t * 0.13 + r.ph) * 0.07;
        r.d = clamp(r.d + (r.pace - pace) * 9 * dt, -120, 160);
        let lx = LANES[(hash((t * 0.4 + r.ph) | 0, 3) * 3) | 0];
        if (Math.abs(r.d) < 7 && Math.abs(lx - this.P[0].x) < 2.5) lx = this.P[0].x > 0 ? -3 : 3;
        r.x += (lx - r.x) * dt * 1.2;
      }
      // the weather: rain in some, a storm (and lightning) in others
      if (this.wx === 2 && rnd() < dt * 0.25 && !rv.calm) this.bolt = 1;
      this.bolt *= Math.pow(0.003, dt);
      const fog = this.bolt > 0.05 ? lerp3(raceFog(sh, this.wx), [0.8, 0.85, 1], this.bolt * 0.6) : raceFog(sh, this.wx);
      const crafts = this.P.map((q) => ({ q, c: craftAt(T, sPlay, q.x, -q.vx * 0.06, Math.sin(t * 6 + q.i) * 0.05 + Math.sin(Math.min(1, 1 - q.hop) * Math.PI) * q.hop * 1.6 + (rv.calm ? 0 : q.shake * Math.sin(t * 60) * 0.1)) }));
      const rivs = this.riv.map((r, i) => ({ c: craftAt(T, sPlay + r.d, r.x, Math.sin(t + r.ph) * 0.2, Math.sin(t * 5 + i) * 0.05), i: i + 1, d: r.d }));
      let ghost = null;
      if (this.ghost && this.state === "race") { const k = this.abs - this.startAbs, a = this.ghost.x[k], b = this.ghost.x[k + 1]; if (a != null) ghost = craftAt(T, sPlay, ((a + ((b == null ? a : b) - a) * frac) / 20), 0, Math.sin(t * 6) * 0.05); }
      // the particles the moment made (by the craft that made them)
      for (const [pi, kind] of this.fxq || []) {
        const c = crafts[pi] && crafts[pi].c; if (!c) continue;
        if (kind === "crash") burst(c.p, 26, 14, [1, 0.3, 0.2], { gr: 18, life: 1.1, up: 0.5 });
        else if (kind === "boost") burst(mad(c.p, c.f, -2), 18, 12, [1, 0.85, 0.2], { life: 0.6 });
        else if (kind === "orb") burst(c.p, 8, 7, col(sh + 200, 1.2), { life: 0.5 });
        else if (kind === "shield") burst(c.p, 24, 9, [0.3, 0.9, 1], { flat: true, life: 0.7 });
        else if (kind === "emp") burst(c.p, 60, 30, [0.6, 0.6, 1], { flat: true, life: 0.8 });
      }
      this.fxq = [];
      const views = this.two ? [[0, 0.5], [0.5, 0.5]] : [null];
      views.forEach((V, vi) => {
        const me = crafts[vi].c, q = this.P[vi], f0 = T.at(sPlay);
        g.view = V;
        const eye = add(add(me.p, mul(f0.f, -7.5 + q.boost * 1.5)), mul(f0.u, 2.6)), tgt = add(add(me.p, mul(f0.f, 8)), mul(f0.u, 0.4));
        g.begin(rv.W, fog, this.wx === 2 ? 0.007 : 0.0045, eye, tgt, f0.u, 1.05 + q.boost * 0.22, 1400, RACE_ZEN);
        drawWorld(g);
        // the items: the next 60 steps (each player's own taken ones gone)
        const p = rv.hooks.pattern(), oc = col(sh + 200, 1.4);
        let n = 0, o = 0;
        if (this.abs != null && this.state !== "wait" && this.state !== "done") for (let s = this.abs + 1; s < this.abs + 60; s++) {
          if (this.state === "count" && s < this.go0) continue;
          const it = this.item(p, s); if (!it || q.taken.has(s)) continue;
          const f = T.at(s * STEP_M), pos = mad(f.p, f.r, LANES[it.lane]);
          if (it.k === "orb") { const c = mad(pos, f.u, 1.0); inst(n++, c[0], c[1] - 0.45, c[2], 0.9, 0.9, 0.9, t * 3 + s, oc, 1.2); }
          else if (it.k === "wall") { const c = mad(pos, f.u, 0.02); inst(n++, c[0], c[1], c[2], 1.3, 2.4, 0.5, Math.atan2(f.f[0], f.f[2]), [1, 0.1, 0.15], 1 + 0.4 * Math.sin(t * 10)); }
          else if (it.k === "shield") { const c = mad(pos, f.u, 1.1); inst(n++, c[0], c[1] - 0.6, c[2], 1.2, 1.2, 1.2, t * 2, [0.3, 0.9, 1], 1.4); }
          else if (it.k === "emp") { const c = mad(pos, f.u, 1.0); for (let j = 0; j < 3; j++) inst(n++, c[0], c[1] - 0.4 + j * 0.1, c[2], 0.25, 1.6 - j * 0.4, 1.6 - j * 0.4, t * 4 + j, [0.7, 0.6, 1], 1.6); }
          else {                                         // a boost pad: three chevrons, flashing
            const e = 1 + 0.6 * Math.sin(t * 14 + s);
            for (let kk = 0; kk < 3; kk++) {
              const qq = mad(mad(pos, f.u, 0.05), f.f, kk * 1.1 - 1.1), cc = [1 * e, 0.85 * e, 0.1];
              o = putN(o, mad(qq, f.r, -1.2), f.u, cc, 1.3); o = putN(o, mad(qq, f.f, 1.1), f.u, cc, 1.3); o = putN(o, mad(qq, f.r, 1.2), f.u, cc, 1.3);
            }
          }
        }
        if (n) g.draw(meshOf(g, "box", unitBox, null, true), null, INST.subarray(0, n * 12), n);
        if (o) g.drawDyn(VB, o / VSZ, g.gl.TRIANGLES);
        const cm = meshOf(g, "craft", craftMesh);
        crafts.forEach(({ q: qq, c }) => drawCraft(g, cm, c.m, TEAM(sh, qq.i * 4)));
        for (const r of rivs) if (r.d > -12 && r.d < 400) drawCraft(g, cm, r.c.m, TEAM(sh, r.i));
        g.glow(true); o = 0;
        if (ghost) { drawCraft(g, cm, ghost.m, [0.25, 0.45, 0.6]); }   // (the ghost: a hologram of the best run)
        crafts.forEach(({ q: qq, c }) => {
          o = flames(o, c, qq.boost, t + qq.i, col(sh + 130, 1.2), qq.hop);
          if (qq.shield) { const sc = [0.15, 0.5, 0.6]; for (let j = 0; j < 12; j++) { const a0 = (j / 12) * TAU + t * 3, a1 = ((j + 1) / 12) * TAU + t * 3, ctr = mad(c.p, c.u, 0.3);
            const P0 = add(add(ctr, mul(c.r, Math.cos(a0) * 2.6)), mul(c.f, Math.sin(a0) * 2.9)), P1 = add(add(ctr, mul(c.r, Math.cos(a1) * 2.6)), mul(c.f, Math.sin(a1) * 2.9));
            o = put(o, P0, sc, 1); o = put(o, P1, sc, 1); o = put(o, mad(ctr, c.u, 1.6), [0, 0, 0], 1); } }
        });
        for (const r of rivs) if (r.d > -12 && r.d < 200) o = flames(o, r.c, 0.25, t + r.i, col(sh + 130, 0.9));
        g.drawDyn(VB, o / VSZ, g.gl.TRIANGLES); g.glow(false);
        if (q.boost > 0.5 && rnd() < 0.6) burst(mad(me.p, me.f, -2.4), 2, 8, col(sh + 130, 1.2), { life: 0.35 });
        drawParts(g, vi === 0 ? dt : 0);                  // (both views see the same sparks)
        if (this.wx) { o = rain(0, eye, t, this.wx === 2 ? 420 : 220, [0.45, 0.55, 0.7], 26, 0.4); g.lines(VB, o / VSZ, 0.012); }
      });
      g.view = null;
      const lead = this.P.reduce((a2, b2) => (b2.boost > a2.boost ? b2 : a2));
      if (lead.boost > 0.3) { speedLines(rv, lead.boost); g.blurK = lead.boost * (this.two ? 0.2 : 0.4); g.dofK = this.two ? 0 : lead.boost * 0.6; }
      for (const q of this.P) q.spd = Math.round((STEP_M / ((this.stepDur || 120) / 1000)) * 3.6 * 2.2 * (1 + q.boost * 0.5 - q.slow * 0.4));
      if (this.bolt > 0.6 && !rv.calm) rv.flash = Math.max(rv.flash, 0.15);
    },
    hud(rv) {
      const W = rv.W, [v0, v1] = rv.view, Y = R.util.YEL, Wh = R.util.WHITE, P = R.util.PINK, C = R.util.CYAN, B = rv.buf;
      for (let y = 0; y < 9; y++) for (let x = 0; x < W; x++) { const i = (y * W + x) * 3; B[i] *= 0.3; B[i + 1] *= 0.3; B[i + 2] *= 0.3; }
      const lap = this.state === "race" ? Math.min(this.laps, 1 + Math.floor(((this.abs - this.startAbs) * STEP_M) / (this.L || 1))) : this.state === "done" ? this.laps : 1;
      const halves = this.two ? [[v0, (v0 + v1) >> 1], [(v0 + v1) >> 1, v1]] : [[v0, v1]];
      if (this.two) for (let y = 0; y < H; y++) { const x = (v0 + v1) >> 1, i = (y * W + x) * 3; B[i] = B[i + 1] = B[i + 2] = 40; }
      halves.forEach(([a, b], i) => {
        const q = this.P[i], mid = (a + b) / 2;
        if (this.two) rv.text3("P" + (i + 1), a + 2, 2, i ? C : Y);
        else rv.text3("P" + this.pos() + "/" + (this.riv.length + 1), a + 2, 2, Y);
        const sc = String(q.score).padStart(6, "0"); rv.text3(sc, b - 2 - sc.length * 4, 2, Wh);
        const mult = Math.min(8, 1 + (q.combo >> 3));
        if (q.combo > 1) { const cs = "X" + mult + " " + q.combo; rv.text3(cs, b - 2 - cs.length * 4, H - 8, mult > 1 ? P : Wh); }
        if (q.spd) rv.text3(q.spd + " KMH", a + 2, H - 8, Y);
        const bw = 30; rv.rect(a + 2, H - 13, bw, 3, [40, 30, 60]); rv.rect(a + 2, H - 13, Math.round(bw * clamp(q.boost, 0, 1)), 3, Y);
        if (q.shield) rv.text3("SHIELD", a + 2, H - 20, C);
        if (q.msg) {
          q.msg.t -= rv.dt; if (q.msg.t <= 0) q.msg = null;
          else { const s = q.msg.s, k = s.length > 6 || this.two ? 2 : 3; rv.text5(s, (mid - (s.length * 6 * k) / 2) | 0, 40, k, /OUCH|MISS|HIT/.test(s) ? P : Y, true); }
        }
      });
      const mid = (v0 + v1) / 2, lp = "LAP " + lap + "/" + this.laps + (this.wx ? " " + WX[this.wx] : "");
      rv.text3(lp, (this.two ? mid - lp.length * 2 : v0 + 34) | 0, this.two ? 11 : 2, C);
      if (this.state === "wait") { const s = "PRESS PLAY"; rv.text5(s, (mid - s.length * 6) | 0, 60, 2, Y, true); }
      if (!this.two && this.state !== "done") {
        const best = this.ghost ? this.ghost.s : 0, beat = Math.max(this.beat || 0, 0);
        const s = (beat ? "BEAT " + beat : best ? "BEST " + best : ""); if (s) rv.text3(s, (mid - s.length * 2) | 0, 11, beat && this.P[0].score >= beat ? R.util.LIME : Wh);
      }
      if (this.state === "done" && !this.two) {
        const q = this.P[0], lines = ["SCORE " + q.score + "  BEST COMBO " + q.best + (this.newBest ? "  NEW BEST" : "") + (this.beat ? (q.score >= this.beat ? "  BEATEN!" : "  " + (this.beat - q.score) + " SHORT") : "")];
        this.board.forEach((e, i) => lines.push((i + 1) + ". " + String(e.s).padStart(6, " ") + "  " + e.d + (i + 1 === this.rank ? " <" : "")));
        lines.forEach((s, i) => rv.text3(s, (mid - s.length * 2) | 0, 72 + i * 8, i === 0 ? Wh : i === this.rank ? Y : C));
      }
      if (this.state === "done" && this.two) { const s = this.P[0].score + "  :  " + this.P[1].score; rv.text3(s, (mid - s.length * 2) | 0, 72, Wh); }
    },
  };
  R.prototype.raceHud = function () { race.hud(this); };
  // the race's controls: acid.js calls these
  R.prototype.race = function (on, two) { if (on) race.start(this, two); else race.stop(this); return race.on; };
  R.prototype.raceSteer = function (d, pl = 0) { const q = race.P && race.P[pl]; if (q) { q.steer = d; q.target = null; } };   // -1, 0, 1 (the keys)
  R.prototype.raceTo = function (x, pl = 0) { const q = race.P && race.P[pl]; if (q) q.target = x == null ? null : clamp(x * 2 - 1, -1, 1); };   // a finger, 0..1 across
  R.prototype.raceBeat = function (n) { race.beat = Math.max(0, n | 0); };
  R.prototype.raceInfo = function () {
    const q = race.P ? race.P[0] : {};
    return { on: race.on, two: race.two, state: race.state, score: q.score || 0, combo: q.combo || 0, pos: race.on && !race.two ? race.pos() : 0, x: q.x || 0, abs: race.abs, boost: q.boost || 0,
      seed: race.seed, best: race.ghost ? race.ghost.s : 0, scores: race.P ? race.P.map((p) => p.score) : [], shield: q.shield || 0, weather: WX[race.wx || 0] };
  };
  // the race hears the steps; the 3D scenes the rest (from the sound's news)
  const ev = R.prototype.event;
  R.prototype.event = function (m) {
    const last = this.lastStep;
    ev.call(this, m);
    const g = g3, name = R.SCENES[this.scene];
    if (race.on && this.racing && m.step >= 0 && m.step !== last && m.playing) race.onStep(this, m, g && g.track);
    if (!g || !m.playing) return;
    const D = g.dir;
    if (D) {
      if ((m.hits & 1) && !((m.fx >> 11) & 1)) D.lastKick = this.t;   // (a kick, unless DRUMS OUT has them)
      if (m.step >= 0 && m.step !== last) {                // a fill: three snare or clap hits in four steps
        D.fills.push(m.hits & 6 ? 1 : 0); if (D.fills.length > 4) D.fills.shift();
        const bar = 240 / (this.hooks.params().tempo || 124);
        if (D.fills.reduce((a, b) => a + b, 0) >= 3 && this.t - D.lastFill > bar) {
          D.lastFill = this.t; D.fills = [];
          if (!this.calm && !this.racing) { D.whip = 1; D.whipDir = rnd() < 0.5 ? -1 : 1; }
          const sc = R.SCENES[this.scene], x3 = this.scene >= R.BUILTIN;
          if (x3 && /DATA CITY|GRID DIVE|VIRUS|FILE SYSTEM/.test(sc) && this.auto && !this.racing && !this.calm && !g.hack && this.t - D.lastHack > bar * 8) { D.lastHack = this.t; g.hack = { t0: this.t }; }
        }
      }
    }
    if (name === "DATA CITY" && m.note >= 0) {           // a bass note: a pulse up a tower near the front, a joint of the worm
      const st = g.st.city; if (st && st.z != null) {
        const j = Math.floor(st.z / 4) + 4 + ((rnd() * 10) | 0); st.pulses.push({ i: (rnd() < 0.5 ? -1 : 1) * (3 + ((rnd() * 3) | 0)), j: j % 6 ? j : j + 1, t: this.t });
        const pc = ((m.note % 24) + 24) % 24; st.worm.push([(pc / 23 - 0.5) * 6, 1.5 + pc * 0.45, st.z + 46]);
      }
    }
    if (name === "FILE SYSTEM" && m.note >= 0) {         // a bass note opens a file just ahead
      const st = g.st.files; if (st && st.j0 != null) st.open.push({ j: st.j0 + 6 + ((rnd() * 10) | 0), s: rnd() < 0.5 ? -1 : 1, r: (rnd() * 3) | 0, t: this.t });
    }
    if (name === "GRID DIVE" && m.note >= 0 && !this.calm && (m.accHit || rnd() < 0.3)) {   // the notes fly past, as words
      const st = g.st.dive; if (st && st.z != null) word3(g, R.util.NOTES[((m.note % 12) + 12) % 12] + (Math.floor(m.note / 12) - 1), [(rnd() - 0.5) * 16, 1 + rnd() * 4, st.z + 30 + rnd() * 10], 0.22, col(this.slotShift() + 30 + rnd() * 160, 1.3), 2.6);
    }
  };
  R.has3D = true;
  R.debug3D = { get g() { return g3; }, race, skip: {} };   // (for the tests)
})();
