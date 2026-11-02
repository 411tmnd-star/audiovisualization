import * as THREE from "three";

import type { TerrainAnim } from "./animator";
import {
  COLS, DEPTH, HALF_WIDTH, ROWS, UNITS_PER_S, WAVE_AMP, WAVE_K, WAVE_LIFE_S, WAVE_SLOTS, WAVE_SPEED, WAVE_WIDTH, WINDOW_S,
} from "./field";
import { TEX_W, type TerrainHistory } from "./history";
import type { TerrainParams } from "./params";
import { TERRAIN_FRAG, TERRAIN_VERT } from "./shaders";

/**
 * The Terrain scene: one connected, subdivided heightfield, seen from a fixed oblique camera above its near edge. Newest relief
 * enters at the near edge and recedes along Z; the surface is displaced in the vertex shader by the heights the history stored.
 *
 * Built once in the constructor: a static grid geometry (positions are placeholders; the shader places every vertex), one
 * ShaderMaterial, one float DataTexture that shares the history's own array (no copy). `update` writes uniforms and flags the
 * texture for upload only when the history wrote a row. A frame allocates nothing. `dispose` releases the geometry, material
 * and texture; `releaseGpu` does the same for a lost context while keeping the scene graph.
 *
 * `decor: false` switches off everything that is not the surface itself (contour lines, register tints, edge line, horizon
 * fade, shockwave): what is left is the heightfield shaded by slope, the geometry that carries the identity.
 * Sizes and rates are PROPOSED values for visual review.
 */

/** Module-level counts, so lifecycle checks can confirm every scene created was disposed. */
export const sceneStats = { created: 0, disposed: 0 };

export const CONTOUR_STEP = 0.38;
const FOV = 36;
/** Fixed camera: above and in front of the near edge, looking down the land. */
const TARGET = new THREE.Vector3(0, 0.2, -7.0);
const EYE_DIR = new THREE.Vector3(0, 0.66, 0.75).normalize();
const BASE_DISTANCE = 18.5;

const f = (n: number) => n.toFixed(5);

export interface TerrainOptions {
  /** Contours, tints, edge line, horizon fade and shockwave. Default true. The surface itself is always drawn. */
  decor?: boolean;
}

export class TerrainScene {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(FOV, 16 / 9, 0.1, 120);
  readonly decor: boolean;
  readonly mesh: THREE.Mesh;
  readonly geometry: THREE.BufferGeometry;
  readonly material: THREE.ShaderMaterial;
  readonly texture: THREE.DataTexture;
  private readonly shockT = new Float32Array(WAVE_SLOTS).fill(-1e9);
  private readonly shockS = new Float32Array(WAVE_SLOTS);
  private fitDistance = BASE_DISTANCE;
  private seenWrites = -1;
  private disposed = false;
  /** Diagnostics: how many times the history texture was flagged for upload. */
  uploads = 0;

  constructor(opts: TerrainOptions = {}) {
    this.decor = opts.decor !== false;

    // Grid of COLS x ROWS vertices; aRC = (column, row). Triangles are static.
    const n = COLS * ROWS;
    const rc = new Float32Array(n * 2);
    for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) { rc[(r * COLS + c) * 2] = c; rc[(r * COLS + c) * 2 + 1] = r; }
    const idx = new Uint32Array((COLS - 1) * (ROWS - 1) * 6);
    let k = 0;
    for (let r = 0; r < ROWS - 1; r++) for (let c = 0; c < COLS - 1; c++) {
      const a = r * COLS + c, b = a + 1, d = a + COLS, e = d + 1;
      idx[k++] = a; idx[k++] = d; idx[k++] = b;
      idx[k++] = b; idx[k++] = d; idx[k++] = e;
    }
    this.geometry = new THREE.BufferGeometry();
    this.geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    this.geometry.setAttribute("aRC", new THREE.BufferAttribute(rc, 2));
    this.geometry.setIndex(new THREE.BufferAttribute(idx, 1));

    // The history's array is attached on the first update (the texture must exist before the history is known).
    this.texture = new THREE.DataTexture(new Float32Array(TEX_W * ROWS * 4), TEX_W, ROWS, THREE.RGBAFormat, THREE.FloatType);
    this.texture.minFilter = THREE.NearestFilter;
    this.texture.magFilter = THREE.NearestFilter;
    this.texture.generateMipmaps = false;
    this.texture.needsUpdate = true;

    this.material = new THREE.ShaderMaterial({
      vertexShader: TERRAIN_VERT,
      fragmentShader: TERRAIN_FRAG,
      uniforms: {
        uRows: { value: this.texture },
        uHead: { value: 0 },
        uNow: { value: 0 },
        uWave: { value: 1 },
        uIllum: { value: 0.4 },
        uDecor: { value: this.decor ? 1 : 0 },
        uShockT: { value: this.shockT },
        uShockS: { value: this.shockS },
      },
      defines: {
        COLS_I: COLS, ROWS_I: ROWS, COLS_F: f(COLS), WINDOW_S: f(WINDOW_S), UPS: f(UNITS_PER_S), HALF_W: f(HALF_WIDTH),
        WAVE_SLOTS, WAVE_LIFE: f(WAVE_LIFE_S), WAVE_SPEED: f(WAVE_SPEED), WAVE_AMP: f(WAVE_AMP), WAVE_W: f(WAVE_WIDTH), WAVE_K: f(WAVE_K),
        CONTOUR: f(CONTOUR_STEP),
      },
      side: THREE.DoubleSide,
    });
    this.mesh = new THREE.Mesh(this.geometry, this.material);
    this.mesh.frustumCulled = false; // the shader moves every vertex; the placeholder bounds are meaningless
    this.scene.add(this.mesh);

    this.placeCamera();
    sceneStats.created++;
  }

  get resourceCounts() {
    return { geometries: 1, materials: 1, textures: 1 };
  }

  get uniforms() {
    return this.material.uniforms;
  }

  get distance(): number {
    return this.fitDistance;
  }

  /** Call when the canvas size or pixel ratio changes. Framing keeps the full width of the near edge in view. */
  setViewport(cssWidth: number, cssHeight: number, _pixelRatio: number): void {
    if (cssWidth < 1 || cssHeight < 1) return;
    const aspect = cssWidth / cssHeight;
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
    const tanHalf = Math.tan((FOV * Math.PI) / 360);
    // Depth of the near edge along the view axis, relative to the distance of the target: keep its full width on screen.
    const fwd = EYE_DIR.clone().negate();
    const nearOffset = new THREE.Vector3(0, 0, 0).sub(TARGET).dot(fwd);
    const wide = (HALF_WIDTH * 1.06) / (tanHalf * aspect) - nearOffset;
    this.fitDistance = Math.max(BASE_DISTANCE, wide);
    this.placeCamera();
  }

  /** The camera is fixed: placed here and nowhere else, and never moves with the music. */
  private placeCamera(): void {
    this.camera.position.copy(TARGET).addScaledVector(EYE_DIR, this.fitDistance);
    this.camera.lookAt(TARGET);
    this.camera.updateMatrixWorld();
  }

  /** Writes the clock, illumination and recent onsets into uniforms and flags the texture only if the history wrote. No allocation. */
  update(h: TerrainHistory, a: TerrainAnim, p: TerrainParams): void {
    if (this.disposed) return;
    const u = this.material.uniforms;
    u.uNow.value = a.now;
    u.uIllum.value = a.illumination;
    u.uHead.value = h.headSlot;
    u.uWave.value = p.reduced ? 0 : 1;
    // Newest onsets still inside the wave's life, newest first; unused slots read a time far in the past.
    let s = 0;
    for (let i = 0; i < h.onsetCount && s < WAVE_SLOTS; i++) {
      const age = a.now - h.onsetTime(i);
      if (age > WAVE_LIFE_S) break;
      if (age < 0) continue;
      this.shockT[s] = h.onsetTime(i);
      this.shockS[s] = h.onsetStrength(i);
      s++;
    }
    for (; s < WAVE_SLOTS; s++) { this.shockT[s] = -1e9; this.shockS[s] = 0; }

    if (h.stats.writes !== this.seenWrites) {
      if (this.texture.image.data !== h.data) this.texture.image.data = h.data;
      this.texture.needsUpdate = true;
      this.seenWrites = h.stats.writes;
      this.uploads++;
    }
  }

  /** Call when the WebGL context is lost: release the renderer's records, keep the scene graph; the next update re-uploads. */
  releaseGpu(): void {
    if (this.disposed) return;
    this.geometry.dispose();
    this.material.dispose();
    this.texture.dispose();
    this.seenWrites = -1;
  }

  /** Releases the geometry, material and texture. Safe to call more than once. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.geometry.dispose();
    this.material.dispose();
    this.texture.dispose();
    this.scene.clear();
    sceneStats.disposed++;
  }
}

export const DEPTH_EXTENT = DEPTH;
