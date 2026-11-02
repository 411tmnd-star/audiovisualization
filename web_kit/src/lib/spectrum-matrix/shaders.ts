/**
 * GLSL for Spectrum Matrix (band terrain v0). Artistic: a glowing wireframe terrain over a dark surface and a horizon haze.
 * Everything is driven by uniforms and two per-vertex attributes (height and row age): no textures, no render targets.
 */

const NOISE = /* glsl */ `
float hash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}
`;

const RAMP = /* glsl */ `
vec3 matrixRamp(float s) {
  return mix(vec3(0.25, 0.78, 1.00), vec3(0.62, 0.50, 1.00), s);
}
// Height colour: deep blue in the valleys, cyan, violet, then a warm white at the crests, so the peaks carry the colour.
vec3 heightRamp(float h, float s) {
  vec3 c = mix(vec3(0.08, 0.30, 1.00), vec3(0.20, 0.82, 1.00), smoothstep(0.02, 0.30, h));
  c = mix(c, matrixRamp(0.55 + 0.45 * s), smoothstep(0.28, 0.62, h));
  return mix(c, vec3(1.00, 0.90, 1.00), smoothstep(0.85, 1.00, h) * 0.60);
}
`;

/** Shared by the surface and the lines. `aRow` is the row's age (0 newest, at the far end); `uFrac` the fraction scrolled. */
export const TERRAIN_VERT = /* glsl */ `
attribute float aH;
attribute float aRow;
uniform float uFrac;
uniform float uRowsM1;
uniform float uHalfW;
varying float vH;
varying float vD;
void main() {
  vH = aH;
  // Depth fade at the far end and a lateral fade at the sides, so neither the far rows nor the terrain edges ever show.
  vD = (aRow + uFrac) / uRowsM1 * (1.0 - smoothstep(0.70, 1.0, abs(position.x) / uHalfW));
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

/** The wireframe: cyan to violet, brighter on crests, faded in from the far end so new rows never pop in. */
export const LINE_FRAG = /* glsl */ `
precision highp float;
uniform float uExposure;
uniform float uColour;
uniform float uGain;
varying float vH;
varying float vD;
${RAMP}
void main() {
  float far = smoothstep(0.02, 0.38, vD);
  // Brightness follows height strongly, so peaks carry the information and a loud signal does not wash the whole grid evenly.
  float lum = (0.30 + 1.10 * vH) * (0.45 + 0.90 * uExposure) * far;
  vec3 col = heightRamp(vH, uColour);
  gl_FragColor = vec4(col * lum * uGain, 1.0);
}
`;

/** The dark surface under the lines (hides the lines behind peaks). Transparent with alpha = far fade, so it melts into the haze. */
export const SURFACE_FRAG = /* glsl */ `
precision highp float;
uniform float uExposure;
uniform float uColour;
varying float vH;
varying float vD;
${RAMP}
void main() {
  float far = smoothstep(0.02, 0.38, vD);
  vec3 col = vec3(0.004, 0.010, 0.030) + heightRamp(vH, uColour) * smoothstep(0.0, 0.5, vH) * 0.16 * (0.4 + uExposure);
  gl_FragColor = vec4(col, far);
}
`;

export const PLANE_VERT = /* glsl */ `
varying vec2 vP;
void main() {
  vP = position.xy;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

/**
 * Horizon haze on a large plane behind the terrain: a glow just above the horizon line and a softer one below. Dithered so the
 * dark gradient does not band, and faded to zero well inside the plane's edges, so no boundary is ever visible.
 */
export const HAZE_FRAG = /* glsl */ `
precision highp float;
uniform float uGlow;
uniform float uExposure;
uniform float uColour;
uniform float uY0;
varying vec2 vP;
${NOISE}
${RAMP}
void main() {
  float y = vP.y - uY0;
  float up = exp(-pow(max(y, 0.0) / 1.6, 2.0)) * 0.8;
  float down = exp(-pow(min(y, 0.0) / 3.0, 2.0)) * 0.35;
  float mask = (1.0 - smoothstep(45.0, 65.0, abs(vP.x))) * (1.0 - smoothstep(24.0, 33.0, abs(vP.y)));
  vec3 col = matrixRamp(0.6 * uColour) * (up + down) * mask * (0.05 + 0.22 * uGlow) * (0.5 + 0.5 * uExposure);
  col += (hash(gl_FragCoord.xy) - 0.5) / 255.0;
  gl_FragColor = vec4(max(col, 0.0), 1.0);
}
`;
