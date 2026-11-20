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
  vW = w.xyz; vN = mat3(uM) * n; vCol = aCol * iC.rgb; vEm = max(aEm, iC.a);
  gl_Position = uVP * w;
}`;
  const MESH_FS = `#version 300 es
precision highp float;
in vec3 vCol; in vec3 vN; in vec3 vW; in float vEm; in vec3 vB;
uniform vec3 uFog; uniform float uFogD; uniform vec3 uLt; uniform vec3 uEye; uniform int uMode; uniform float uT;
out vec4 o;
float h21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
void main() {
  float nn = dot(vN, vN);
  vec3 n = nn > 1e-4 ? normalize(vN) : vec3(0.0, 1.0, 0.0);
  float lam = nn > 1e-4 ? 0.3 + 0.7 * abs(dot(n, uLt)) : 1.0;
  vec3 c = vCol * mix(lam, 1.0, clamp(vEm, 0.0, 1.0)) * (1.0 + max(vEm - 1.0, 0.0));
  float d = length(vW - uEye);
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
  o = vec4(c, 1.0);
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
uniform vec3 uF, uR, uU, uHz, uZen; uniform vec2 uTan;
void main() {
  vec2 uv = gl_FragCoord.xy / uRes * 2.0 - 1.0;
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
  const VSZ = 10;                                         // (a vertex: position, normal, colour, emission)
  class G3 {
    constructor() {
      this.cv = document.createElement("canvas"); this.cv.width = 240; this.cv.height = H;
      const gl = this.gl = this.cv.getContext("webgl2", { antialias: false, alpha: false, depth: true, preserveDrawingBuffer: false, powerPreference: "low-power" });
      if (!gl) throw new Error("no WebGL2");
      this.lost = false;
      this.cv.addEventListener("webglcontextlost", (e) => { e.preventDefault(); this.lost = true; });
      this.mesh = this.prog(MESH_VS, MESH_FS);
      this.u = {}; for (const n of ["uVP", "uM", "uFog", "uFogD", "uLt", "uEye", "uMode", "uT"]) this.u[n] = gl.getUniformLocation(this.mesh, n);
      this.full = {}; this.empty = gl.createVertexArray();
      this.dyn = this.makeMesh(new Float32Array(VSZ * 3), gl.TRIANGLES, true);   // (lines and triangles made fresh each frame)
      this.instBuf = gl.createBuffer();
      this.meshes = {}; this.st = {};
      this.px = null;
    }
    prog(vs, fs) {
      const gl = this.gl, mk = (t, src) => { const s = gl.createShader(t); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)); return s; };
      const p = gl.createProgram(); gl.attachShader(p, mk(gl.VERTEX_SHADER, vs)); gl.attachShader(p, mk(gl.FRAGMENT_SHADER, fs)); gl.linkProgram(p);
      if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
      return p;
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
    // a frame begins: the size, the fog, the camera
    begin(w, fog, fogD, eye, tgt, up, fovy = 1.05, far = 400, zen) {
      const gl = this.gl;
      if (this.cv.width !== w) this.cv.width = w;
      gl.viewport(0, 0, w, H);
      gl.clearColor(fog[0], fog[1], fog[2], 1); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      if (zen) {                                         // (a sky first, behind everything)
        const f = norm(sub(tgt, eye)), r = norm(cross(f, up || [0, 1, 0])), u = cross(r, f), ty = Math.tan(fovy / 2);
        this.fullscreen("dome", DOME_FS, w, { uF: f, uR: r, uU: u, uTan: [ty * (w / H), ty], uHz: fog, uZen: zen });
      }
      gl.enable(gl.DEPTH_TEST); gl.disable(gl.CULL_FACE); gl.disable(gl.BLEND); gl.depthMask(true);
      gl.useProgram(this.mesh); gl.bindVertexArray(null);
      this.vp = mmul(persp(fovy, w / H, 0.1, far), lookAt(eye, tgt, up || [0, 1, 0]));
      gl.uniformMatrix4fv(this.u.uVP, false, this.vp);
      gl.uniform3fv(this.u.uFog, fog); gl.uniform1f(this.u.uFogD, fogD); gl.uniform3fv(this.u.uEye, eye);
      gl.uniform3fv(this.u.uLt, norm([0.4, 0.8, -0.45])); gl.uniform1i(this.u.uMode, 0);
    }
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
    // vertices made this frame (lines or triangles)
    drawDyn(arr, n, prim, model) {
      if (!n) return;
      const gl = this.gl, m = this.dyn;
      gl.bindBuffer(gl.ARRAY_BUFFER, m.vb); gl.bufferData(gl.ARRAY_BUFFER, arr.subarray(0, n * VSZ), gl.DYNAMIC_DRAW);
      m.n = n; m.prim = prim; this.draw(m, model);
    }
    // a raymarched picture: one triangle over everything
    fullscreen(key, src, w, U) {
      const gl = this.gl;
      let f = this.full[key];
      if (!f) { const p = this.prog(FULL_VS, src); f = this.full[key] = { p, u: {} }; for (const n of ["uRes", "uT", "uK", "uA", "uCut", "uRs", "uEnv", "uW", "uBloom", "uBolt", "uZ", "uMood", "uC1", "uC2", "uC3", "uF", "uR", "uU", "uTan", "uHz", "uZen"]) f.u[n] = gl.getUniformLocation(p, n); }
      if (this.cv.width !== w) this.cv.width = w;
      gl.viewport(0, 0, w, H); gl.disable(gl.DEPTH_TEST); gl.disable(gl.BLEND);
      gl.useProgram(f.p);
      gl.uniform2f(f.u.uRes, w, H);
      for (const k in U) { const v = U[k], loc = f.u[k]; if (loc == null) continue; if (typeof v === "number") gl.uniform1f(loc, v); else if (v.length === 2) gl.uniform2fv(loc, v); else gl.uniform3fv(loc, v); }
      gl.bindVertexArray(this.empty); gl.drawArrays(gl.TRIANGLES, 0, 3); gl.bindVertexArray(null);
    }
    // the picture, into the rave's buffer (GL's rows run bottom-up)
    read(rv) {
      const gl = this.gl, w = rv.W, n = w * H * 4;
      if (!this.px || this.px.length !== n) this.px = new Uint8Array(n);
      gl.readPixels(0, 0, w, H, gl.RGBA, gl.UNSIGNED_BYTE, this.px);
      const P = this.px, B = rv.buf;
      for (let y = 0; y < H; y++) { let s = (H - 1 - y) * w * 4, d = y * w * 3; for (let x = 0; x < w; x++, s += 4, d += 3) { B[d] = P[s]; B[d + 1] = P[s + 1]; B[d + 2] = P[s + 2]; } }
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
  // a closed loop: a wobbly circle (never crossing itself), hills, banked into its turns; frames found by distance
  class Track {
    constructor(seed) {
      const rng = mulberry(seed), M = 900, R0 = 270;
      const A = [2, 3, 4, 5, 7].map((k) => ({ k, a: (rng() * 46) / Math.sqrt(k), p: rng() * TAU, h: (rng() * 16) / k, q: rng() * TAU }));
      this.P = []; this.T = []; this.R = []; this.U = []; this.cum = [0];
      for (let i = 0; i < M; i++) {
        const th = (i / M) * TAU; let r = R0, y = 0;
        for (const o of A) { r += o.a * Math.sin(o.k * th + o.p); y += o.h * Math.sin(o.k * th + o.q); }
        this.P.push([Math.cos(th) * r, y, Math.sin(th) * r]);
      }
      const curv = [];
      for (let i = 0; i < M; i++) {
        const a = this.P[(i - 1 + M) % M], b = this.P[(i + 1) % M];
        this.T.push(norm(sub(b, a)));
      }
      for (let i = 0; i < M; i++) { const a = this.T[(i - 3 + M) % M], b = this.T[(i + 3) % M]; curv.push(cross(a, b)[1]); }
      for (let i = 0; i < M; i++) {
        let c = 0; for (let k = -6; k <= 6; k++) c += curv[(i + k + M) % M]; c /= 13;
        const bank = clamp(-c * 4, -0.35, 0.35), F = this.T[i];
        const Rt = norm(cross(F, [0, 1, 0])), Ut = cross(Rt, F);
        this.R.push(norm(add(mul(Rt, Math.cos(bank)), mul(Ut, Math.sin(bank)))));
        this.U.push(norm(sub(mul(Ut, Math.cos(bank)), mul(Rt, Math.sin(bank)))));
      }
      for (let i = 1; i <= M; i++) this.cum.push(this.cum[i - 1] + Math.hypot(...sub(this.P[i % M], this.P[i - 1])));
      this.L = this.cum[M]; this.M = M;
    }
    at(s) {                                              // { p, f (forward), r (right), u (up) } at s metres along
      const L = this.L, M = this.M; s = ((s % L) + L) % L;
      let lo = 0, hi = M;
      while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (this.cum[mid] <= s) lo = mid; else hi = mid; }
      const t = (s - this.cum[lo]) / (this.cum[lo + 1] - this.cum[lo]), j = (lo + 1) % M;
      return { p: lerp3(this.P[lo], this.P[j], t), f: norm(lerp3(this.T[lo], this.T[j], t)), r: norm(lerp3(this.R[lo], this.R[j], t)), u: norm(lerp3(this.U[lo], this.U[j], t)) };
    }
    // the road: dark, banded, lane lines; glowing rails; gates every so often; boost chevrons (the scene's own)
    build(c1, c2, chevrons) {
      const b = new Builder(), M = this.M, HW = 4.6;
      for (let i = 0; i < M; i++) {
        const j = (i + 1) % M, P0 = this.P[i], P1 = this.P[j], R0 = this.R[i], R1 = this.R[j], U0 = this.U[i], U1 = this.U[j];
        const band = (i >> 2) & 1 ? 0.15 : 0.12, road = [band, band, band * 1.25];
        b.quad(mad(P0, R0, -HW), mad(P0, R0, HW), mad(P1, R1, HW), mad(P1, R1, -HW), road);
        if (i & 1) for (const x of [-1.5, 1.5]) b.quad(mad(mad(P0, R0, x - 0.08), U0, 0.02), mad(mad(P0, R0, x + 0.08), U0, 0.02), mad(mad(P1, R1, x + 0.08), U1, 0.02), mad(mad(P1, R1, x - 0.08), U1, 0.02), [0.5, 0.5, 0.6], 0.6);
        for (const [s, c] of [[-1, c1], [1, c2]]) {     // the rails: a low glowing wall each side
          const a0 = mad(P0, R0, s * HW), a1 = mad(P1, R1, s * HW);
          b.quad(a0, a1, mad(a1, U1, 0.7), mad(a0, U0, 0.7), c, 1);
        }
        if (i % 60 === 0) {                              // a gate: two pillars and a beam, outlined in light
          const F = this.T[i], pil = (x) => { const q = mad(P0, R0, x); return [mad(mad(q, R0, -0.35), F, -0.35), mad(mad(q, R0, 0.35), F, -0.35), mad(mad(q, R0, 0.35), F, 0.35), mad(mad(q, R0, -0.35), F, 0.35)]; };
          for (const x of [-HW - 0.6, HW + 0.6]) { const f0 = pil(x); b.hull(f0, f0.map((q) => mad(q, U0, 6)), [0.1, 0.1, 0.14]); }
          const t0 = mad(P0, U0, 6), bl = [mad(mad(t0, R0, -HW - 1), F, -0.4), mad(mad(t0, R0, HW + 1), F, -0.4), mad(mad(t0, R0, HW + 1), F, 0.4), mad(mad(t0, R0, -HW - 1), F, 0.4)];
          b.hull(bl, bl.map((q) => mad(q, U0, 0.9)), (i / 60) & 1 ? c1 : c2, 1.2);
        }
        if (chevrons && i % 45 === 20) {                // boost chevrons on the road, in a lane
          const x = [-3, 0, 3][Math.floor(i / 45) % 3], F = this.T[i], q = mad(mad(P0, R0, x), U0, 0.04);
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
  const scene = (name, draw, extra = {}) => R.addScene({ name, ...extra, fn() { const g = G(); if (!g) { fallback(this); return; } try { draw.call(this, g); g.read(this); streaks(this); } catch (e) { broken = true; console.error(e); fallback(this); } } });
  const base = (rv) => ({ sh: rv.slotShift(), k: rv.calm ? rv.kick * 0.3 : rv.kick, a: rv.accent, v: rv.v || {} });

  // DATA CITY ---------------------------------------------------------------------------------------------------
  scene("DATA CITY", function (g) {
    const { sh, k, a } = base(this), t = this.t, C = 4, st = stOf(g, "city", () => ({ dive: 0, pulses: [] }));
    st.dive = Math.max(st.dive * Math.pow(0.4, this.dt), a > 0.9 ? 1 : 0);
    const z = this.scroll * 7, sw = Math.sin(t * 0.3) * 2, hy = 21 + Math.sin(t * 0.17) * 6 - st.dive * 11 - k * 0.8;
    const eye = [sw, hy, z], tgt = [Math.sin(t * 0.3 + 0.7) * 3, hy - 6 - st.dive * 3, z + 30];
    const fog = col(sh + 40, 0.22);
    g.begin(this.W, fog, 0.014, eye, tgt, [Math.sin(t * 0.23) * 0.08, 1, 0], 1.05, 400, [0.0, 0.0, 0.02]);
    const j0 = Math.floor(z / C) - 1, step = this.lastStep < 0 ? 0 : this.lastStep;
    let n = 0;
    for (let j = j0; j < j0 + 36; j++) {
      if (((j % 6) + 6) % 6 === 0) continue;               // (the cross streets)
      for (let i = -9; i <= 9; i++) {
        if (Math.abs(i) < 3) continue;                     // (the avenue)
        const hsh = hash(i, j), h = 4 + hsh * hsh * (10 + Math.abs(i) * 4), lit = (Math.abs(i * 7 + j * 13) + step) % 11 === 0 ? 0.7 : 0;
        let pu = 0; for (const p of st.pulses) if (p.i === i && p.j === j) pu = Math.max(pu, 1 - (t - p.t));
        inst(n++, i * C, 0, j * C, h, 3, 3, 0, col(sh + hsh * 90 + (i < 0 ? 0 : 60)), lit + pu * 1.5 + k * 0.15);
      }
    }
    g.draw(meshOf(g, "box", unitBox, null, true), null, INST.subarray(0, n * 12), n, 1);
    // the pulses: a ring climbing its tower
    let o = 0;
    st.pulses = st.pulses.filter((p) => t - p.t < 1);
    for (const p of st.pulses) {
      const hsh = hash(p.i, p.j), h = 4 + hsh * hsh * (10 + Math.abs(p.i) * 4), y = (t - p.t) * h, x = p.i * C, zz = p.j * C, c = col(sh + 140, 1.4);
      const q = [[x - 1.6, y, zz - 1.6], [x + 1.6, y, zz - 1.6], [x + 1.6, y, zz + 1.6], [x - 1.6, y, zz + 1.6]];
      for (let e = 0; e < 4; e++) { o = put(o, q[e], c, 1); o = put(o, q[(e + 1) % 4], c, 1); }
    }
    // the floor's grid, and the avenue's light lines
    const gc = col(sh + 200, 0.35);
    for (let i = -10; i <= 10; i++) { o = put(o, [i * C - C / 2, 0.01, z - 4], gc, 1); o = put(o, [i * C - C / 2, 0.01, z + 150], gc, 1); }
    for (let j = j0; j < j0 + 36; j++) { o = put(o, [-36, 0.01, j * C - C / 2], gc, 1); o = put(o, [36, 0.01, j * C - C / 2], gc, 1); }
    const ac = col(sh + 60, 1);
    for (let j = j0; j < j0 + 30; j++) if (((j + step) & 3) === 0) { o = put(o, [-0.15, 0.02, j * C], ac, 1); o = put(o, [-0.15, 0.02, j * C + 1.6], ac, 1); o = put(o, [0.15, 0.02, j * C], ac, 1); o = put(o, [0.15, 0.02, j * C + 1.6], ac, 1); }
    g.drawDyn(VB, o / VSZ, g.gl.LINES);
    st.z = z;
  }, { hacker: true });

  // GRID DIVE ---------------------------------------------------------------------------------------------------
  scene("GRID DIVE", function (g) {
    const { sh, k, v } = base(this), t = this.t, st = stOf(g, "dive", () => ({ pk: [] }));
    const z = this.scroll * 7, roll = ((v.cut || 0.3) - 0.5) * 0.9 + Math.sin(t * 0.4) * 0.15;
    const eye = [Math.sin(t * 0.25) * 2, 1.2 + Math.sin(t * 0.33) * 0.8, z], tgt = [Math.sin(t * 0.25 + 0.5) * 3, 1, z + 20];
    g.begin(this.W, [0.0, 0.0, 0.02], 0.028, eye, tgt, [Math.sin(roll), Math.cos(roll), 0], 1.1 + k * 0.08);
    const fl = this.calm ? 0 : Math.max(this.clap, this.flash * 0.5), gc = col(sh + 170, 0.55 + fl), cc = col(sh + 120, 0.3 + fl);
    let o = 0;
    const z0 = Math.floor(z / 2) * 2;
    for (const [y, c] of [[-1, gc], [7, cc]]) {
      for (let x = -40; x <= 40; x += 2) { o = put(o, [x, y, z - 2], c, 1); o = put(o, [x, y, z + 100], c, 1); }
      for (let zz = z0; zz < z + 100; zz += 2) { o = put(o, [-40, y, zz], c, 1); o = put(o, [40, y, zz], c, 1); }
    }
    // packets along the lines
    if (this.hat > 0.9 && !st.hat) for (let i = 0; i < 3; i++) st.pk.push({ x: Math.round((rnd() - 0.5) * 30) * 2, y: rnd() < 0.5 ? -1 : 7, z: z + 70 + rnd() * 30, v: 40 + rnd() * 40 });
    st.hat = this.hat > 0.9;
    const pc = col(sh + 40, 1.6);
    st.pk = st.pk.filter((p) => p.z > z - 4);
    for (const p of st.pk) { p.z -= p.v * this.dt; o = put(o, [p.x, p.y, p.z], pc, 2); o = put(o, [p.x, p.y, p.z + 3], [pc[0] * 0.3, pc[1] * 0.3, pc[2] * 0.3], 1); }
    // data cubes, turning, swelling on the kick
    for (let i = Math.floor(z / 9); i < Math.floor(z / 9) + 12; i++) {
      const hs = hash(i, 5); if (hs < 0.35) continue;
      const cxyz = [(hash(i, 1) - 0.5) * 26, 1.5 + hash(i, 2) * 4, i * 9], s = 1.1 + hs * 1.2 + k * 0.5, ay = t * (0.5 + hs), ax = t * 0.7;
      const m = rotYX(ay, ax), c = col(28 + ((sh + hs * 120 + 60) % 196), 1.6);
      for (const [p, q] of CUBE_E) { o = put(o, add(cxyz, mul(xform(m, CUBE_V[p]), s)), c, 1); o = put(o, add(cxyz, mul(xform(m, CUBE_V[q]), s)), c, 1); }
    }
    g.drawDyn(VB, o / VSZ, g.gl.LINES);
  }, { hacker: true });

  // VIRUS -------------------------------------------------------------------------------------------------------
  const VN = 7, VS = 1.7;
  scene("VIRUS", function (g) {
    const { sh, k, v } = base(this), t = this.t, NN = VN * VN * VN;
    const st = stOf(g, "virus", () => ({ inf: new Float32Array(NN), tgt: new Uint8Array(NN), step: -1, flash: 0 }));
    if (!st.tgt.some((x) => x)) st.tgt[(rnd() * NN) | 0] = 1;
    const id = (x, y, z) => (x * VN + y) * VN + z, heal = (this.fx >> 3) & 3;
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
      if (this.accent > 0.9) nx[(rnd() * NN) | 0] = 1;
      st.tgt = nx;
      if (st.inf.every((q) => q > 0.92)) { st.tgt.fill(0); st.inf.fill(0); st.flash = 1; this.word = this.calm ? null : { s: "PURGED", life: 1 }; }
    }
    st.flash *= Math.pow(0.05, this.dt);
    for (let i = 0; i < NN; i++) st.inf[i] += (st.tgt[i] - st.inf[i]) * Math.min(1, this.dt * 2.5);
    const eye = [Math.sin(t * 0.18) * 17, 5 + Math.sin(t * 0.11) * 5, Math.cos(t * 0.18) * 17];
    g.begin(this.W, [0.01, 0.0, 0.03], 0.02, eye, [0, 0, 0], [0, 1, 0], 0.9);
    const m = rotYX(t * 0.1, 0.2), clean = col(sh + 170, 0.8), sick = [1, 0.12, 0.3], P = (x, y, z) => [(x - (VN - 1) / 2) * VS, (y - (VN - 1) / 2) * VS, (z - (VN - 1) / 2) * VS];
    let n = 0;
    for (let x = 0; x < VN; x++) for (let y = 0; y < VN; y++) for (let z = 0; z < VN; z++) {
      const i = id(x, y, z), f = st.inf[i], p = P(x, y, z), s = 0.32 + f * 0.18 + f * k * 0.25;
      inst(n++, p[0], p[1] - s / 2, p[2], s, s, s, t * f * 2, lerp3(clean, sick, f), 0.35 + f * (1 + k));
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
    if (st.flash > 0.05 && !this.calm) this.flash = Math.max(this.flash, st.flash * 0.6);
    let sum = 0; for (let i = 0; i < NN; i++) sum += st.inf[i];
    this.virusPct = Math.round((sum / NN) * 100);
  }, { hacker: true });

  // FILE SYSTEM -------------------------------------------------------------------------------------------------
  scene("FILE SYSTEM", function (g) {
    const { sh, k } = base(this), t = this.t, st = stOf(g, "files", () => ({ open: [] }));
    const z = this.scroll * 6, eye = [Math.sin(t * 0.4) * 0.8, 2.6 + Math.sin(t * 0.27) * 0.6, z], tgt = [Math.sin(t * 0.4 + 0.4) * 1.2, 2.3, z + 14];
    g.begin(this.W, col(sh + 190, 0.1), 0.035, eye, tgt, [Math.sin(t * 0.3) * 0.05, 1, 0]);
    const D = 1.3, j0 = Math.floor(z / D) - 1;
    st.open = st.open.filter((q) => t - q.t < 2);
    let n = 0;
    for (let j = j0; j < j0 + 46; j++) for (const sd of [-1, 1]) for (let r = 0; r < 3; r++) {
      const hs = hash(j * 2 + (sd > 0 ? 1 : 0), r); if (hs < 0.12) continue;
      let ox = 0, rot = 0, em = 0.1;
      for (const q of st.open) if (q.j === j && q.s === sd && q.r === r) { const f = Math.sin(Math.min(1, (t - q.t) / 2) * Math.PI); ox = -sd * f * 1.8; rot = f * 1.2; em = 0.1 + f * 1.4; }
      inst(n++, sd * 4.2 + ox, r * 1.9, j * D, 1.5, 0.08, 1.0, rot, col(sh + hs * 70 + r * 30 + 110), em + k * 0.1);
    }
    g.draw(meshOf(g, "box", unitBox, null, true), null, INST.subarray(0, n * 12), n, 1);
    // the folders overhead: slabs with tabs, every 26 metres, outlined in light; the shelves; the floor
    let o = 0;
    const fc = col(sh + 50, 1.2), shc = col(sh + 200, 0.4);
    for (let f = Math.floor(z / 26); f < Math.floor(z / 26) + 4; f++) {
      const zz = f * 26 + 13, y = 6.2, q = [[-4.8, y, zz - 3], [4.8, y, zz - 3], [4.8, y, zz + 3], [-4.8, y, zz + 3]];
      for (let e = 0; e < 4; e++) { o = put(o, q[e], fc, 1); o = put(o, q[(e + 1) % 4], fc, 1); }
      const tb = [[-4.8, y, zz - 3], [-4.8, y + 0.7, zz - 2.6], [-4.8, y + 0.7, zz - 0.4], [-4.8, y, zz]];
      for (let e = 0; e < 3; e++) { o = put(o, tb[e], fc, 1); o = put(o, tb[e + 1], fc, 1); }
    }
    for (const sd of [-1, 1]) for (let r = 0; r < 4; r++) { o = put(o, [sd * 4.3, r * 1.9 - 0.05, z - 3], shc, 1); o = put(o, [sd * 4.3, r * 1.9 - 0.05, z + 60], shc, 1); }
    for (let x = -3; x <= 3; x += 1.5) { o = put(o, [x, -0.1, z - 3], shc, 1); o = put(o, [x, -0.1, z + 60], shc, 1); }
    g.drawDyn(VB, o / VSZ, g.gl.LINES);
    st.j0 = j0;
  }, { hacker: true });

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
        const a = rng() * TAU, r = 420 + rng() * 300, x = Math.cos(a) * r, z = Math.sin(a) * r, w = 10 + rng() * 26, h = 20 + rng() * rng() * 160;
        b.box(x - w / 2, -60, z - w / 2, x + w / 2, h - 60, z + w / 2, [0.05, 0.04, 0.09]);
        b.box(x - w / 2, h - 61, z - w / 2, x + w / 2, h - 60, z + w / 2, col(sh + rng() * 200), 1);
      }
      if (g.meshes.city) g.gl.deleteVertexArray(g.meshes.city.vao);
      g.meshes.city = g.makeMesh(b.f32(), g.gl.TRIANGLES);
    }
    return g.track;
  };
  // a craft on the track: s metres along, x across, its roll; its model matrix
  const craftAt = (T, s, x, roll, bob) => {
    const f = T.at(s), p = mad(mad(f.p, f.r, x), f.u, 0.85 + bob);
    const r = norm(add(mul(f.r, Math.cos(roll)), mul(f.u, Math.sin(roll)))), u = norm(sub(mul(f.u, Math.cos(roll)), mul(f.r, Math.sin(roll))));
    return { m: frameM(p, mul(r, -1), u, f.f), p, f: f.f, r, u };
  };
  // the exhaust: two flames out of the pods and one from the middle, longer with a boost (drawn glowing)
  const flames = (o, c, boost, t, colr) => {
    const L = 0.8 + boost * 2.2 + Math.sin(t * 50) * 0.15;
    for (const [x, y, w] of [[1.3, 0.12, 0.26], [-1.3, 0.12, 0.26], [0, 0.32, 0.3]]) {
      const P = (lx, ly, lz) => add(add(add(c.p, mul(c.r, -lx)), mul(c.u, ly)), mul(c.f, lz));
      const tip = P(x, y, -1.95 - L);
      o = put(o, P(x - w, y, -1.92), colr, 1); o = put(o, P(x + w, y, -1.92), colr, 1); o = put(o, tip, [colr[0] * 0.2, colr[1] * 0.2, colr[2] * 0.4], 1);
      o = put(o, P(x, y - w * 0.8, -1.92), colr, 1); o = put(o, P(x, y + w * 0.8, -1.92), colr, 1); o = put(o, tip, [colr[0] * 0.2, colr[1] * 0.2, colr[2] * 0.4], 1);
    }
    return o;
  };
  const TEAM = (sh, i) => col(28 + ((sh + [0, 50, 100, 150, 25, 75, 125, 175][i % 8]) % 196));   // (never the palette's dark ends)
  const raceFog = (sh) => col(sh + 40, 0.3);
  const RACE_ZEN = [0.0, 0.0, 0.03];
  const drawWorld = (g, T, sh) => { const k = R.debug3D.skip; if (!k.track) g.draw(g.meshes.track); if (!k.city) g.draw(g.meshes.city); };

  scene("ANTIGRAV", function (g) {
    if (this.racing) { race.draw(this, g); return; }
    const { sh, a } = base(this), t = this.t, T = trackFor(g, 1 + (this.hooks.slot() | 0), sh);
    const st = stOf(g, "ag", () => ({ boost: 0 }));
    st.boost = Math.max(st.boost * Math.pow(0.3, this.dt), a > 0.9 ? 1 : 0);
    const s0 = this.scroll * 24 + st.boost * 2;
    // the pack: five craft, jostling
    const pack = [];
    for (let i = 0; i < 5; i++) {
      const ds = [0, -9, 7, -18, 15][i] + Math.sin(t * 0.31 + i * 2.1) * 5 + (i === 0 ? st.boost * 4 : 0), x = Math.sin(t * 0.47 + i * 1.7) * 2.6;
      const roll = Math.cos(t * 0.47 + i * 1.7) * -0.35;
      pack.push({ c: craftAt(T, s0 + ds, x, roll, Math.sin(t * 5 + i) * 0.06), i });
    }
    const lead = pack[0].c, cam = ((this.bar >> 2) % 4 + 4) % 4, f0 = T.at(s0);
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
    drawWorld(g, T, sh);
    const cm = meshOf(g, "craft", craftMesh);
    for (const q of pack) drawCraft(g, cm, q.c.m, TEAM(sh, q.i));
    g.glow(true); let o = 0;
    for (const q of pack) o = flames(o, q.c, q.i === 0 ? st.boost : 0.2, t + q.i, col(sh + 130, 1));
    g.drawDyn(VB, o / VSZ, g.gl.TRIANGLES); g.glow(false);
    if (st.boost > 0.3 && cam !== 1) speedLines(this, st.boost);
  });
  // a craft in its team's colour (the mesh's white parts take it)
  const drawCraft = (g, cm, m, c) => {
    const gl = g.gl;
    gl.uniformMatrix4fv(g.u.uM, false, m); gl.uniform1i(g.u.uMode, 0);
    gl.bindVertexArray(cm.vao); gl.vertexAttrib4f(4, 0, 0, 0, 1); gl.vertexAttrib4f(5, 1, 1, 0, 0); gl.vertexAttrib4f(6, c[0], c[1], c[2], 0);
    gl.drawArrays(gl.TRIANGLES, 0, cm.n); gl.bindVertexArray(null);
  };
  // streaks from the middle out, on a boost (into the 2D picture, after the read)
  const speedLines = (rv, k) => { rv.speedK = k; };
  const streaks = (rv) => {
    const k = rv.speedK || 0; if (k < 0.3 || rv.calm) return;
    const cx = rv.W / 2, cy = H * 0.45;
    for (let i = 0; i < 26 * k; i++) {
      const a = rnd() * TAU, r0 = 30 + rnd() * 50, r1 = r0 + 15 + rnd() * 40 * k;
      rv.line(cx + Math.cos(a) * r0 * 1.6, cy + Math.sin(a) * r0, cx + Math.cos(a) * r1 * 1.6, cy + Math.sin(a) * r1, [255, 255, 255], 0.25 * k, false);
    }
    rv.speedK = 0;
  };

  // FRACTAL, CHROME, SKYFLIGHT ----------------------------------------------------------------------------------
  const unis = (rv, extra) => {
    const { sh, k, a, v } = base(rv);
    return { uT: rv.t, uK: k, uA: rv.calm ? 0 : a, uCut: v.cut == null ? 0.3 : v.cut, uRs: v.reso == null ? 0.6 : v.reso, uEnv: v.env || 0,
      uC1: col(sh + 140), uC2: col(sh + 60), uC3: col(sh + 200), ...extra };
  };
  scene("FRACTAL", function (g) { g.fullscreen("fractal", FRACTAL_FS, this.W, unis(this, { uZ: this.scroll * 1.5 })); });
  scene("CHROME", function (g) { g.fullscreen("chrome", CHROME_FS, this.W, unis(this, {})); });
  scene("SKYFLIGHT", function (g) {
    const d = this.driftInfo || {}, drift = !!this.driftMode;
    const st = stOf(g, "sky", () => ({ z: 0, bolt: 0 }));
    st.z += this.dt * (drift ? 4 : 2 + (this.hooks.params().tempo || 120) / 30);
    const w = drift ? d.w || 0 : 0.1;
    if (w > 0.8 && rnd() < this.dt * (w - 0.8) * 1.2 && !this.calm) st.bolt = 1;
    st.bolt *= Math.pow(0.002, this.dt);
    g.fullscreen("sky", SKY_FS, this.W, unis(this, { uZ: st.z, uW: w, uMood: [drift ? d.mx || 0.5 : 0.5, drift ? d.my || 0.5 : 0.6], uBloom: this.bloom || 0, uBolt: st.bolt }));
  }, { calm: true });

  // ------------------------------------------------------------------------------------------------- the race ---
  // the pattern, laid down the track: each step is 6 metres; a note is an orb in its lane (its pitch picks it), an
  // accent a boost pad, a clap or snare where nothing plays a barrier; the craft is where the music is, always on the
  // beat, so catching is steering; rivals ahead and behind move with how well it goes
  const race = {
    on: false,
    start(rv) {
      this.on = true; rv.racing = true; this.state = "wait"; this.abs = null; this.score = 0; this.combo = 0; this.best = 0; this.x = 0; this.vx = 0; this.steer = 0; this.target = null;
      this.boost = 0; this.slow = 0; this.seed = ((Date.now() / 1000) | 0) & 0xffff; this.laps = 3; this.items = new Map(); this.taken = new Set(); this.msg = null; this.shake = 0;
      this.riv = [-14, 10, -26, 22, 4, -6, 34].map((d, i) => ({ d, pace: 1, x: LANES[i % 3], ph: rnd() * TAU }));
      rv.go(R.SCENES.indexOf("ANTIGRAV"));
    },
    stop(rv) { this.on = false; rv.racing = false; },
    item(p, abs) {                                       // what the pattern puts at an absolute step
      if (this.items.has(abs)) return this.items.get(abs);
      const len = p.len || 16, i = ((abs % len) + len) % len, b = p.bass[i];
      let it = null;
      if (b && b.on) it = { k: b.acc ? "boost" : "orb", lane: (((b.note + (b.oct || 0) * 5) % 3) + 3) % 3 };
      else if ((p.drums[2] && p.drums[2][i]) || (p.drums[1] && p.drums[1][i])) it = { k: "wall", lane: (hash(abs, this.seed) * 3) | 0 };
      this.items.set(abs, it);
      if (this.items.size > 400) { const first = this.items.keys().next().value; this.items.delete(first); }
      return it;
    },
    onStep(rv, m) {
      const p = rv.hooks.pattern(), len = p.len || 16;
      if (this.abs == null) { this.abs = m.step; this.last = m.step; }
      else { let dlt = m.step - this.last; if (dlt <= 0) dlt += len; this.abs += dlt; this.last = m.step; }
      this.tStep = performance.now(); this.stepDur = 60000 / (rv.hooks.params().tempo || 124) / 4;
      if (this.state === "wait") { this.go0 = (Math.floor(this.abs / 16) + 2) * 16; this.state = "count"; this.items.clear(); }
      if (this.state === "count" && this.abs >= this.go0) { this.state = "race"; this.startAbs = this.go0; this.msg = { s: "GO!", t: 1 }; }
      if (this.state === "count") { const left = Math.ceil((this.go0 - this.abs) / 4); if (left !== this.cd && left <= 3) { this.cd = left; this.msg = { s: String(left), t: 0.6 }; } }
      if (this.state === "done" && this.abs >= this.next) this.start(rv);
      if (this.state !== "race") return;
      const it = this.item(p, this.abs);              // the craft is over this step's item now
      if (it && !this.taken.has(this.abs)) {
        const hit = Math.abs(this.x - LANES[it.lane]) < 1.4;
        if (it.k === "wall") { if (hit) { this.combo = 0; this.slow = 1; this.shake = 1; rv.shake = Math.max(rv.shake, 1); this.msg = { s: "OUCH", t: 0.6 }; } }
        else if (hit) {
          this.combo++; this.best = Math.max(this.best, this.combo);
          const mult = Math.min(8, 1 + (this.combo >> 3));
          this.score += (it.k === "boost" ? 50 : 10) * mult; this.taken.add(this.abs);
          if (it.k === "boost") { this.boost = 1; this.msg = { s: "BOOST", t: 0.7 }; rv.flash = Math.max(rv.flash, rv.calm ? 0 : 0.25); }
          else this.boost = Math.max(this.boost, 0.25);
          rv.sparks(it.k === "boost" ? 14 : 5);
          if (mult > 1 && this.combo % 8 === 0) this.msg = { s: "X" + mult, t: 0.8 };
        } else { if (this.combo >= 8) this.msg = { s: "MISS", t: 0.5 }; this.combo = 0; this.slow = Math.max(this.slow, 0.3); }
      }
      const lap = Math.floor(((this.abs - this.startAbs) * STEP_M) / this.L);
      if (lap >= this.laps) { this.state = "done"; this.next = this.abs + 48; this.place = this.pos(); this.msg = { s: "FINISH P" + this.place, t: 4 }; }
    },
    pos() { return 1 + this.riv.filter((r) => r.d > 0).length; },
    draw(rv, g) {
      const { sh } = base(rv), t = rv.t, dt = rv.dt, T = trackFor(g, 7 + this.seed, sh);
      this.L = T.L;
      // where the music is: the step and how far into it
      const frac = this.abs == null ? 0 : clamp((performance.now() - this.tStep) / (this.stepDur || 120), 0, 1);
      const sPlay = this.abs == null ? 0 : (this.abs + frac) * STEP_M;
      // steering: the keys, or a finger's place
      const want = this.target != null ? this.target * HW * 0.85 : this.x + this.steer * 6;
      const tx = clamp(want, -HW + 1.2, HW - 1.2), ax = (tx - this.x) * 60 - this.vx * 14;
      this.vx += ax * dt; this.x = clamp(this.x + this.vx * dt, -HW + 1, HW - 1);
      this.boost *= Math.pow(0.35, dt); this.slow *= Math.pow(0.25, dt); this.shake *= Math.pow(0.02, dt);
      const pace = 1 + this.boost * 0.5 - this.slow * 0.4;
      if (this.state === "race") for (const r of this.riv) {   // the rivals: each its own changing pace
        r.pace = 1.03 + Math.sin(t * 0.13 + r.ph) * 0.07;
        r.d = clamp(r.d + (r.pace - pace) * 9 * dt, -120, 160);
        let lx = LANES[(hash((t * 0.4 + r.ph) | 0, 3) * 3) | 0];
        if (Math.abs(r.d) < 7 && Math.abs(lx - this.x) < 2.5) lx = this.x > 0 ? -3 : 3;   // (side by side: they keep out of the way)
        r.x += (lx - r.x) * dt * 1.2;
      }
      const me = craftAt(T, sPlay, this.x, -this.vx * 0.06, Math.sin(t * 6) * 0.05 + (rv.calm ? 0 : this.shake * Math.sin(t * 60) * 0.1));
      const f0 = T.at(sPlay);
      const eye = add(add(me.p, mul(f0.f, -7.5 + this.boost * 1.5)), mul(f0.u, 2.6)), tgt = add(add(me.p, mul(f0.f, 8)), mul(f0.u, 0.4));
      g.begin(rv.W, raceFog(sh), 0.0045, eye, tgt, f0.u, 1.05 + this.boost * 0.22, 1400, RACE_ZEN);
      drawWorld(g, T, sh);
      // the items: the next 60 steps
      const p = rv.hooks.pattern(), oc = col(sh + 200, 1.4);
      let n = 0, o = 0;
      if (this.abs != null && this.state !== "wait") for (let s = this.abs + 1; s < this.abs + 60; s++) {
        if (this.state === "count" && s < this.go0) continue;
        if (this.state === "done") break;
        const it = this.item(p, s); if (!it || this.taken.has(s)) continue;
        const f = T.at(s * STEP_M), q = mad(f.p, f.r, LANES[it.lane]);
        if (it.k === "orb") { const c = mad(q, f.u, 1.0); inst(n++, c[0], c[1] - 0.45, c[2], 0.9, 0.9, 0.9, t * 3 + s, oc, 1.2); }
        else if (it.k === "wall") {
          const c = mad(q, f.u, 0.02), e = 1 + 0.4 * Math.sin(t * 10);
          inst(n++, c[0], c[1], c[2], 1.3, 2.4, 0.5, Math.atan2(f.f[0], f.f[2]), [1, 0.1, 0.15], e);
        } else {                                       // a boost pad: three chevrons, flashing
          const e = 1 + 0.6 * Math.sin(t * 14 + s);
          for (let kk = 0; kk < 3; kk++) {
            const qq = mad(mad(q, f.u, 0.05), f.f, kk * 1.1 - 1.1), cc = [1 * e, 0.85 * e, 0.1];
            o = putN(o, mad(qq, f.r, -1.2), f.u, cc, 1.3); o = putN(o, mad(qq, f.f, 1.1), f.u, cc, 1.3); o = putN(o, mad(qq, f.r, 1.2), f.u, cc, 1.3);
          }
        }
      }
      if (n) g.draw(meshOf(g, "box", unitBox, null, true), null, INST.subarray(0, n * 12), n);
      if (o) g.drawDyn(VB, o / VSZ, g.gl.TRIANGLES);
      const cm = meshOf(g, "craft", craftMesh);
      drawCraft(g, cm, me.m, TEAM(sh, 0));
      const rivs = this.riv.map((r, i) => ({ c: craftAt(T, sPlay + r.d, r.x, Math.sin(t + r.ph) * 0.2, Math.sin(t * 5 + i) * 0.05), i: i + 1, d: r.d }));
      for (const q of rivs) if (q.d > -12 && q.d < 400) drawCraft(g, cm, q.c.m, TEAM(sh, q.i));
      g.glow(true); o = 0;
      o = flames(o, me, this.boost, t, col(sh + 130, 1.2));
      for (const q of rivs) if (q.d > -12 && q.d < 200) o = flames(o, q.c, 0.25, t + q.i, col(sh + 130, 0.9));
      g.drawDyn(VB, o / VSZ, g.gl.TRIANGLES); g.glow(false);
      if (this.boost > 0.3) speedLines(rv, this.boost);
      this.spd = Math.round((STEP_M / ((this.stepDur || 120) / 1000)) * 3.6 * 2.2 * pace);
    },
    hud(rv) {
      const W = rv.W, [v0, v1] = rv.view, Y = R.util.YEL, Wh = R.util.WHITE, P = R.util.PINK, C = R.util.CYAN;
      const B = rv.buf;
      for (let y = 0; y < 9; y++) for (let x = 0; x < W; x++) { const i = (y * W + x) * 3; B[i] *= 0.3; B[i + 1] *= 0.3; B[i + 2] *= 0.3; }
      const lap = this.state === "race" ? Math.min(this.laps, 1 + Math.floor(((this.abs - this.startAbs) * STEP_M) / (this.L || 1))) : this.state === "done" ? this.laps : 1;
      rv.text3("P" + this.pos() + "/" + (this.riv.length + 1), v0 + 2, 2, Y);
      rv.text3("LAP " + lap + "/" + this.laps, v0 + 30, 2, C);
      const sc = String(this.score).padStart(6, "0"); rv.text3(sc, v1 - 2 - sc.length * 4, 2, Wh);
      const mult = Math.min(8, 1 + (this.combo >> 3));
      if (this.combo > 1) { const cs = "X" + mult + " " + this.combo; rv.text3(cs, v1 - 2 - cs.length * 4, H - 8, mult > 1 ? P : Wh); }
      if (this.spd) { const s = this.spd + " KMH"; rv.text3(s, v0 + 2, H - 8, Y); }
      const bw = 30, bx = v0 + 2; rv.rect(bx, H - 13, bw, 3, [40, 30, 60]); rv.rect(bx, H - 13, Math.round(bw * clamp(this.boost, 0, 1)), 3, Y);
      if (this.state === "wait") { const s = "PRESS PLAY"; rv.text5(s, ((v0 + v1) / 2 - s.length * 6) | 0, 60, 2, Y, true); }
      if (this.msg) {
        this.msg.t -= rv.dt; if (this.msg.t <= 0) this.msg = null;
        else { const s = this.msg.s, k = s.length > 6 ? 2 : 3; rv.text5(s, ((v0 + v1) / 2 - (s.length * 6 * k) / 2) | 0, 40, k, s === "OUCH" || s === "MISS" ? P : Y, true); }
      }
      if (this.state === "done") { const s = "SCORE " + this.score + "  BEST COMBO " + this.best; rv.text3(s, ((v0 + v1) / 2 - s.length * 2) | 0, 72, Wh); }
    },
  };
  R.prototype.raceHud = function () { race.hud(this); };
  // the race's controls: acid.js calls these
  R.prototype.race = function (on) { if (on) race.start(this); else race.stop(this); return race.on; };
  R.prototype.raceSteer = function (d) { race.steer = d; race.target = null; };     // -1, 0, 1 (the keys)
  R.prototype.raceTo = function (x) { race.target = x == null ? null : clamp(x * 2 - 1, -1, 1); };   // a finger, 0..1 across
  R.prototype.raceInfo = function () { return { on: race.on, state: race.state, score: race.score, combo: race.combo, pos: race.on ? race.pos() : 0, x: race.x, abs: race.abs, boost: race.boost }; };
  // the race hears the steps; the 3D scenes the rest (from the sound's news)
  const ev = R.prototype.event;
  R.prototype.event = function (m) {
    const last = this.lastStep;
    ev.call(this, m);
    if (race.on && this.racing && m.step >= 0 && m.step !== last && m.playing) race.onStep(this, m);
    const g = g3, name = R.SCENES[this.scene];
    if (!g || !m.playing) return;
    if (name === "DATA CITY" && m.note >= 0) {           // a bass note: a pulse up a tower near the front
      const st = g.st.city; if (st && st.z != null) { const j = Math.floor(st.z / 4) + 4 + ((rnd() * 10) | 0); st.pulses.push({ i: (rnd() < 0.5 ? -1 : 1) * (3 + ((rnd() * 3) | 0)), j: j % 6 ? j : j + 1, t: this.t }); }
    }
    if (name === "FILE SYSTEM" && m.note >= 0) {         // a bass note opens a file just ahead
      const st = g.st.files; if (st && st.j0 != null) st.open.push({ j: st.j0 + 6 + ((rnd() * 10) | 0), s: rnd() < 0.5 ? -1 : 1, r: (rnd() * 3) | 0, t: this.t });
    }
  };
  R.has3D = true;
  R.debug3D = { get g() { return g3; }, race, skip: {} };   // (for the tests)
})();
