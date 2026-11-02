import * as THREE from "three";

import { COLS, LOBES, ROWS, rowOffset, type MatrixAnim } from "./animator";
import { HAZE_FRAG, LINE_FRAG, PLANE_VERT, SURFACE_FRAG, TERRAIN_VERT } from "./shaders";

/**
 * The Spectrum Matrix scene: a wireframe terrain over a dark surface, scrolling toward the camera, and a horizon haze.
 * Everything is built once in the constructor. `update` writes uniforms and transforms every frame, and rewrites the
 * terrain's heights only when a new row has been injected. `dispose` releases every geometry and material the scene created.
 *
 * Row `age` 0 (the newest) is at the far end and older rows are nearer the camera. The whole mesh slides toward the camera by
 * the fraction of a row scrolled, and when a row is injected the data shifts by one row while the slide resets, so the world
 * position of every row is continuous: motion never steps at the row rate.
 * Sizes, colours and rates are PROPOSED values for visual review.
 */

export const sceneStats = { created: 0, disposed: 0 };

export const WIDTH = 26;
export const SPACING = 0.5;
export const Z_FAR = -22;
/** World height of a terrain value of 1. */
export const H_MAX = 1.5;
const FOV = 36;
const BASE_DISTANCE = 17;
const BASE_ELEVATION = 0.58;
const TARGET = new THREE.Vector3(0, 0.3, -6);
const SCENE_PUSH = 1.2;
/** Half-width kept in view at the target depth, world units: the three lobes are always inside the canvas. */
export const FIT_HALF_WIDTH = 9.5;
const MAX_AZIMUTH = 0.7;

export interface MatrixView {
  /** Extra azimuth from the viewer's drag, radians. */
  azimuth: number;
  /** Extra elevation from the viewer's drag, radians. */
  elevation: number;
}

type Uniforms = Record<string, { value: number }>;

export class SpectrumMatrixScene {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(FOV, 16 / 9, 0.1, 400);
  private readonly geometries: THREE.BufferGeometry[] = [];
  private readonly materials: THREE.Material[] = [];
  private readonly terrain = new THREE.Group();
  private readonly pos: THREE.BufferAttribute;
  private readonly heightAttr: THREE.BufferAttribute;
  private readonly lineUniforms: Uniforms;
  private readonly surfaceUniforms: Uniforms;
  private readonly hazeUniforms: Uniforms;
  private lastSerial = -1;
  private fitDistance = BASE_DISTANCE;
  private disposed = false;

  constructor() {
    const n = ROWS * COLS;
    const positions = new Float32Array(n * 3);
    const heights = new Float32Array(n);
    const ages = new Float32Array(n);
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const i = r * COLS + c;
        positions[i * 3] = (c / (COLS - 1) - 0.5) * WIDTH;
        positions[i * 3 + 1] = 0;
        positions[i * 3 + 2] = Z_FAR + r * SPACING;
        ages[i] = r;
      }
    }
    // One set of vertex attributes shared by the surface and the lines (two index buffers over the same vertices).
    this.pos = new THREE.BufferAttribute(positions, 3);
    this.pos.setUsage(THREE.DynamicDrawUsage);
    this.heightAttr = new THREE.BufferAttribute(heights, 1);
    this.heightAttr.setUsage(THREE.DynamicDrawUsage);
    const ageAttr = new THREE.BufferAttribute(ages, 1);

    const tri: number[] = [];
    const seg: number[] = [];
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const i = r * COLS + c;
        if (c < COLS - 1) seg.push(i, i + 1);
        if (r < ROWS - 1) seg.push(i, i + COLS);
        if (r < ROWS - 1 && c < COLS - 1) tri.push(i, i + COLS, i + 1, i + 1, i + COLS, i + COLS + 1);
      }
    }
    const shared = (indices: number[]) => {
      const g = this.own(new THREE.BufferGeometry());
      g.setAttribute("position", this.pos);
      g.setAttribute("aH", this.heightAttr);
      g.setAttribute("aRow", ageAttr);
      g.setIndex(indices);
      return g;
    };

    // Haze first, behind everything, on a large plane faded out well inside its edges.
    this.hazeUniforms = { uGlow: { value: 0 }, uExposure: { value: 0 }, uColour: { value: 0 }, uY0: { value: -0.8 } };
    const haze = new THREE.Mesh(this.own(new THREE.PlaneGeometry(140, 70)), this.ownMat(this.make(PLANE_VERT, HAZE_FRAG, this.hazeUniforms, "additive", false, false)));
    haze.position.set(0, 0, -32);
    haze.renderOrder = -2;
    haze.frustumCulled = false;
    this.scene.add(haze);

    // Dark surface (writes depth, so the lines behind a peak are hidden) and the wireframe on top.
    this.surfaceUniforms = { uFrac: { value: 0 }, uRowsM1: { value: ROWS - 1 }, uHalfW: { value: WIDTH / 2 }, uExposure: { value: 0 }, uColour: { value: 0 } };
    const surfaceMat = this.ownMat(this.make(TERRAIN_VERT, SURFACE_FRAG, this.surfaceUniforms, "normal", true, true));
    surfaceMat.polygonOffset = true;
    surfaceMat.polygonOffsetFactor = 1;
    surfaceMat.polygonOffsetUnits = 1;
    const surface = new THREE.Mesh(shared(tri), surfaceMat);
    surface.renderOrder = -1;
    surface.frustumCulled = false;

    this.lineUniforms = { uFrac: { value: 0 }, uRowsM1: { value: ROWS - 1 }, uHalfW: { value: WIDTH / 2 }, uExposure: { value: 0 }, uColour: { value: 0 }, uGain: { value: 0.8 } };
    const lines = new THREE.LineSegments(shared(seg), this.ownMat(this.make(TERRAIN_VERT, LINE_FRAG, this.lineUniforms, "additive", true, false)));
    lines.renderOrder = 1;
    lines.frustumCulled = false;

    this.terrain.add(surface, lines);
    this.scene.add(this.terrain);
    sceneStats.created++;
  }

  /** Number of GPU-backed resources this scene owns. */
  get resourceCounts(): { geometries: number; materials: number } {
    return { geometries: this.geometries.length, materials: this.materials.length };
  }

  /** The camera distance that keeps the three lobes inside the canvas width (before the scene-level push). */
  get distance(): number {
    return this.fitDistance;
  }

  /** World z of the terrain row `age` rows old, given the current fraction scrolled. */
  rowZ(age: number, frac: number): number {
    return Z_FAR + (age + frac) * SPACING;
  }

  /** Call when the canvas size or pixel ratio changes. */
  setViewport(cssWidth: number, cssHeight: number, pixelRatio: number): void {
    void pixelRatio;
    if (cssWidth < 1 || cssHeight < 1) return;
    const aspect = cssWidth / cssHeight;
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
    const tanHalf = Math.tan((FOV * Math.PI) / 360);
    this.fitDistance = Math.max(BASE_DISTANCE, FIT_HALF_WIDTH / (tanHalf * aspect));
  }

  /** Writes the animation state into uniforms and transforms; rewrites the heights only when new rows arrived. */
  update(a: MatrixAnim, view: MatrixView): void {
    if (this.disposed) return;

    if (a.serial !== this.lastSerial) {
      const y = this.pos.array as Float32Array;
      const h = this.heightAttr.array as Float32Array;
      for (let r = 0; r < ROWS; r++) {
        const src = rowOffset(a, r);
        const dst = r * COLS;
        for (let c = 0; c < COLS; c++) {
          const v = a.rows[src + c];
          h[dst + c] = v;
          y[(dst + c) * 3 + 1] = v * H_MAX;
        }
      }
      this.pos.needsUpdate = true;
      this.heightAttr.needsUpdate = true;
      this.lastSerial = a.serial;
    }

    // The whole terrain slides toward the camera by the fraction of a row scrolled.
    this.terrain.position.z = a.frac * SPACING;

    const az = Math.max(-MAX_AZIMUTH, Math.min(MAX_AZIMUTH, 0.06 * Math.sin(a.scroll * 0.02) + view.azimuth));
    const el = Math.min(0.9, Math.max(0.05, BASE_ELEVATION + view.elevation));
    const dist = this.fitDistance - SCENE_PUSH * a.sceneLevel;
    const ce = Math.cos(el);
    this.camera.position.set(TARGET.x + dist * ce * Math.sin(az), TARGET.y + dist * Math.sin(el), TARGET.z + dist * ce * Math.cos(az));
    this.camera.lookAt(TARGET);

    const l = this.lineUniforms;
    l.uFrac.value = a.frac;
    l.uExposure.value = a.exposure;
    l.uColour.value = a.colour;
    const s = this.surfaceUniforms;
    s.uFrac.value = a.frac;
    s.uExposure.value = a.exposure;
    s.uColour.value = a.colour;
    const h = this.hazeUniforms;
    h.uGlow.value = a.glow;
    h.uExposure.value = a.exposure;
    h.uColour.value = a.colour;
  }

  /** Lobe centres (bass, mid, high) in world x at the terrain's mid depth, for framing checks. */
  lobeCentresX(): number[] {
    return LOBES.map((l) => l.centre * (WIDTH / 2));
  }

  /**
   * Call when the WebGL context is lost. Releases the renderer's records of this scene's GPU objects while the context is lost,
   * but keeps the scene graph; the next draw after a restore uploads them again. Same contract as the other scenes. The CPU
   * height data is untouched, and the next update re-sends it.
   */
  releaseGpu(): void {
    if (this.disposed) return;
    for (const g of this.geometries) g.dispose();
    for (const m of this.materials) m.dispose();
    this.pos.needsUpdate = true;
    this.heightAttr.needsUpdate = true;
  }

  /** Releases every geometry and material. Safe to call more than once. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const g of this.geometries) g.dispose();
    for (const m of this.materials) m.dispose();
    this.scene.clear();
    this.terrain.clear();
    sceneStats.disposed++;
  }

  private own<T extends THREE.BufferGeometry>(g: T): T {
    this.geometries.push(g);
    return g;
  }

  private ownMat<T extends THREE.Material>(m: T): T {
    this.materials.push(m);
    return m;
  }

  private make(vertexShader: string, fragmentShader: string, uniforms: Uniforms, blend: "additive" | "normal", depthTest: boolean, depthWrite: boolean): THREE.ShaderMaterial {
    return new THREE.ShaderMaterial({
      vertexShader, fragmentShader, uniforms, transparent: true,
      blending: blend === "additive" ? THREE.AdditiveBlending : THREE.NormalBlending,
      depthTest, depthWrite, side: THREE.DoubleSide,
    });
  }
}
