/**
 * GLSL for Terrain. The land is ONE static mesh of COLS x ROWS vertices whose heights are read from the history texture
 * (history.ts): the vertex shader displaces each vertex by the stored height of its row and column and places the row on the Z
 * axis by its own recorded time against the displayed clock `uNow`. Nothing is uploaded per frame except the clock; the texture
 * is re-uploaded only when a row is written. No lights, no textures other than the history, no render targets, no post-processing.
 *
 * The fragment shader shades the SURFACE (derivative normals give slope shading from one fixed direction, so relief reads with
 * no lights in the scene) and, as decoration that can be switched off (`uDecor` = 0), adds contour lines, register tints, the
 * leading-edge line, the unrecorded-span darkening and the colour fade at the horizon. Colours are written raw (a ShaderMaterial
 * does no colour-space conversion): amber #FF9900, cyan #00F0FF, electric violet #9D00FF on dark slate.
 *
 * Defines supplied by scene.ts: COLS_I, ROWS_I, COLS_F, WINDOW_S, UPS, HALF_W, WAVE_SLOTS, WAVE_LIFE, WAVE_SPEED, WAVE_AMP,
 * WAVE_W, WAVE_K, CONTOUR. The shock wave in the vertex shader mirrors `shockWave` in field.ts.
 */

export const TERRAIN_VERT = /* glsl */ `
attribute vec2 aRC;
uniform sampler2D uRows;
uniform int uHead;
uniform float uNow;
uniform float uWave;
uniform float uShockT[WAVE_SLOTS];
uniform float uShockS[WAVE_SLOTS];
varying vec3 vWorld;
varying vec4 vParts;
varying float vAge;
varying float vVoid;
varying float vH;

void main() {
  int c = int(aRC.x + 0.5);
  int r = int(aRC.y + 0.5);
  int slot = (uHead - 1 - r + ROWS_I * 2) % ROWS_I;
  vec4 p = texelFetch(uRows, ivec2(c, slot), 0);
  vec4 m = texelFetch(uRows, ivec2(COLS_I, slot), 0);
  float valid = step(0.5, m.y);
  // An unwritten or too-old row lies exactly on the far edge, flat; the soft horizon lowers the last fifth of the window.
  float age = valid > 0.5 ? clamp(uNow - m.x, -0.15, WINDOW_S) : WINDOW_S;
  float fade = 1.0 - smoothstep(0.78, 1.0, age / WINDOW_S);
  float xn = aRC.x / (COLS_F - 1.0) * 2.0 - 1.0;
  float z = -age * UPS;
  vec4 q = p * fade * valid;
  float y = q.x + q.y + q.z + q.w;

  // Travelling shockwave of recent onsets: a longitudinal packet that outruns the land and decays. Not stored in the record.
  float wv = 0.0;
  for (int i = 0; i < WAVE_SLOTS; i++) {
    float ta = uNow - uShockT[i];
    if (ta >= 0.0 && ta <= WAVE_LIFE) {
      float dz = -z - ta * (UPS + WAVE_SPEED);
      float env = exp(-(dz * dz) / (WAVE_W * WAVE_W));
      wv += uShockS[i] * WAVE_AMP * exp(-ta / (WAVE_LIFE * 0.45)) * env * cos(dz * WAVE_K) * (1.0 - smoothstep(0.7, 1.0, ta / WAVE_LIFE));
    }
  }
  float lat = (0.6 + 0.4 * exp(-(xn * xn) / 0.7)) * (1.0 - smoothstep(0.78, 1.0, abs(xn)));
  y += wv * lat * fade * valid * uWave;

  vec3 w = vec3(xn * HALF_W, y, z);
  vWorld = w;
  vParts = q;
  vAge = age;
  vVoid = m.z * valid;
  vH = y;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(w, 1.0);
}
`;

export const TERRAIN_FRAG = /* glsl */ `
precision highp float;
uniform float uIllum;
uniform float uDecor;
varying vec3 vWorld;
varying vec4 vParts;
varying float vAge;
varying float vVoid;
varying float vH;

const vec3 AMBER = vec3(1.0, 0.60, 0.0);
const vec3 CYAN = vec3(0.0, 0.94, 1.0);
const vec3 VIOLET = vec3(0.616, 0.0, 1.0);
const vec3 BG = vec3(0.016, 0.024, 0.043);
const vec3 LIGHT = vec3(-0.62, 0.50, 0.60);

float contour(float k) {
  float fw = max(fwidth(k), 1e-4);
  float line = 1.0 - clamp(abs(fract(k) - 0.5) / fw - 0.6, 0.0, 1.0);
  // Where the lines would be denser than the pixels (a cliff), let them go instead of filling the face.
  return line * (1.0 - smoothstep(0.30, 0.70, fw));
}

void main() {
  vec3 dx = dFdx(vWorld);
  vec3 dy = dFdy(vWorld);
  vec3 n = normalize(cross(dx, dy));
  if (n.y < 0.0) n = -n;
  float lam = max(dot(n, normalize(LIGHT)), 0.0);

  // Surface: dark slate, shaded by slope. This alone is the geometry's read.
  vec3 col = mix(vec3(0.020, 0.032, 0.062), vec3(0.17, 0.25, 0.36), 0.04 + 0.96 * lam * lam);
  col += vec3(0.018, 0.030, 0.052) * clamp(vH * 0.5, 0.0, 1.5);

  if (uDecor > 0.5) {
    float ab = clamp(vParts.x / 1.5, 0.0, 1.0);
    float cy = clamp(abs(vParts.y) / 0.6, 0.0, 1.0);
    float vi = clamp(vParts.z / 0.18, 0.0, 1.0);
    vec3 accent = AMBER * ab + CYAN * cy + VIOLET * vi;
    float strength = clamp(ab + cy + vi, 0.0, 1.0);
    vec3 hue = accent / max(max(accent.r, max(accent.g, accent.b)), 0.05);
    col += accent * 0.24;

    // Topographic contours: minor every CONTOUR of height, major every fifth; tinted by the register that built the slope.
    float minor = contour(vH / CONTOUR);
    float major = contour(vH / (CONTOUR * 4.0));
    float line = max(minor * 0.42, major * 0.95);
    vec3 lineCol = mix(vec3(0.30, 0.42, 0.52), hue, strength);
    col = mix(col, lineCol * (0.55 + 0.9 * uIllum), line * clamp(0.35 + 0.65 * strength, 0.0, 1.0));

    // The leading edge: where the newest row meets the camera.
    float edge = 1.0 - smoothstep(0.0, 0.045, vAge);
    col += vec3(0.20, 0.52, 0.62) * edge * (0.35 + 0.65 * uIllum);

    // An unrecorded span (a seek or a stall) lies flat and dim: the land does not invent what it did not hear.
    col = mix(col, col * vec3(0.55, 0.6, 0.7), vVoid);

    // Aerial perspective: the land takes on the haze colour with distance, then dissolves into the background at the horizon.
    float dist01 = vAge / WINDOW_S;
    col = mix(col, vec3(0.05, 0.09, 0.16), 0.22 * smoothstep(0.35, 0.90, dist01));
    col = mix(BG, col, 1.0 - smoothstep(0.62, 1.0, dist01));
    // The sides dissolve too, so the land reads as terrain that goes on and not as a slab with an outline.
    col = mix(BG, col, 1.0 - smoothstep(0.80, 1.0, abs(vWorld.x) / HALF_W));
  }
  gl_FragColor = vec4(col, 1.0);
}
`;
