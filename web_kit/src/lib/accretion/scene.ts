import * as THREE from "three";

import type { AccretionAnim } from "./animator";
import { DISK_FRAG, HALO_FRAG, JET_FRAG, JET_VERT, PLANE_VERT, STAR_FRAG, STAR_VERT } from "./shaders";

/**
 * The Accretion v0 scene: a dark central body, a photon ring with a lensing impression, a layered accretion disk,
 * opposing jets and a star field. Everything is built once in the constructor. `update` writes uniforms and
 * transforms only, so a frame allocates nothing. `dispose` releases every geometry and material the scene created.
 *
 * Visual hierarchy, by brightness and draw order: central body and ring first, disk second, jets third, stars last.
 * Sizes, colours and rates are PROPOSED values for visual review, not physical quantities.
 */

/** Module-level counts, so lifecycle checks can confirm every scene created was disposed. */
export const sceneStats = { created: 0, disposed: 0 };

export const BODY_RADIUS = 1;
export const DISK_INNER = 1.5;
export const DISK_OUTER = 6.5;
export const JET_POINTS_PER_SIDE = 2500;
export const STAR_COUNT = 1800;
const FOV = 36;
const BASE_DISTANCE = 15.5;
/** The camera moves this much closer as the music builds and peaks. */
const SCENE_PUSH = 2.2;
const BASE_ELEVATION = 0.2;

/** Disk layers: a main sheet and two thinner sheets just above and below it, for apparent thickness. */
const LAYERS = [
  { y: 0, inner: DISK_INNER, outer: DISK_OUTER, gain: 0.85, scale: 1.0 },
  { y: 0.06, inner: DISK_INNER + 0.15, outer: DISK_OUTER - 0.8, gain: 0.45, scale: 1.6 },
  { y: -0.06, inner: DISK_INNER + 0.15, outer: DISK_OUTER - 0.8, gain: 0.45, scale: 2.3 },
];

export interface AccretionView {
  /** Extra azimuth from the viewer's drag, radians. */
  azimuth: number;
  /** Extra elevation from the viewer's drag, radians. */
  elevation: number;
}

/** A small deterministic generator, so the stars and jet seeds are the same on every load. */
function lcg(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

type Uniforms = Record<string, { value: number }>;

export class AccretionScene {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(FOV, 16 / 9, 0.1, 400);
  private readonly geometries: THREE.BufferGeometry[] = [];
  private readonly materials: THREE.Material[] = [];
  private readonly body: THREE.Mesh;
  private readonly halo: THREE.Mesh;
  private readonly diskUniforms: Uniforms[] = [];
  private readonly haloUniforms: Uniforms;
  private readonly jetUniforms: Uniforms;
  private readonly starUniforms: Uniforms;
  private disposed = false;

  constructor() {
    const rand = lcg(20261013);

    // Stars: far away, depth-tested so the shadow hides those behind it.
    const starGeo = this.own(new THREE.BufferGeometry());
    const pos = new Float32Array(STAR_COUNT * 3);
    const mag = new Float32Array(STAR_COUNT);
    const tint = new Float32Array(STAR_COUNT);
    for (let i = 0; i < STAR_COUNT; i++) {
      const u = rand() * 2 - 1;
      const th = rand() * Math.PI * 2;
      const rr = 80 + rand() * 40;
      const s = Math.sqrt(1 - u * u);
      pos[i * 3] = rr * s * Math.cos(th);
      pos[i * 3 + 1] = rr * u;
      pos[i * 3 + 2] = rr * s * Math.sin(th);
      mag[i] = Math.pow(rand(), 3);
      tint[i] = rand();
    }
    starGeo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    starGeo.setAttribute("aMag", new THREE.BufferAttribute(mag, 1));
    starGeo.setAttribute("aTint", new THREE.BufferAttribute(tint, 1));
    this.starUniforms = { uFlow: { value: 0 }, uTwinkle: { value: 0 }, uScale: { value: 1 }, uExposure: { value: 0 } };
    const stars = new THREE.Points(starGeo, this.ownMat(this.additive(STAR_VERT, STAR_FRAG, this.starUniforms, true)));
    stars.renderOrder = -1;
    stars.frustumCulled = false;
    this.scene.add(stars);

    // Central body: black, and it writes depth so the far side of the disk is hidden behind it.
    this.body = new THREE.Mesh(this.own(new THREE.SphereGeometry(BODY_RADIUS, 64, 32)), this.ownMat(new THREE.MeshBasicMaterial({ color: 0x000000 })));
    this.body.renderOrder = 0;
    this.scene.add(this.body);

    // Disk layers in the XZ plane.
    for (let i = 0; i < LAYERS.length; i++) {
      const L = LAYERS[i];
      const u: Uniforms = {
        uPhase: { value: 0 }, uFlow: { value: 0 }, uTurb: { value: 0 }, uColour: { value: 0 }, uExposure: { value: 0 },
        uHeat: { value: 0 }, uDetail: { value: 0 }, uInner: { value: L.inner }, uOuter: { value: L.outer }, uLayer: { value: i },
        uGain: { value: L.gain }, uScale: { value: L.scale }, uCamAngle: { value: 0 }, uFlare: { value: 0 }, uFlareAngle: { value: 0 },
      };
      this.diskUniforms.push(u);
      const mesh = new THREE.Mesh(this.own(new THREE.RingGeometry(L.inner - 0.05, L.outer, 160, 6)), this.ownMat(this.additive(PLANE_VERT, DISK_FRAG, u, true)));
      mesh.rotation.x = -Math.PI / 2;
      mesh.position.y = L.y;
      mesh.renderOrder = 1;
      this.scene.add(mesh);
    }

    // Jets: two opposing streams of points.
    const N = JET_POINTS_PER_SIDE * 2;
    const jetGeo = this.own(new THREE.BufferGeometry());
    const seed = new Float32Array(N);
    const side = new Float32Array(N);
    const jit = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) {
      seed[i] = rand();
      side[i] = i < JET_POINTS_PER_SIDE ? 1 : -1;
      const ang = rand() * Math.PI * 2;
      const rad = Math.sqrt(rand());
      jit[i * 3] = Math.cos(ang) * rad;
      jit[i * 3 + 1] = Math.sin(ang) * rad;
      jit[i * 3 + 2] = rand();
    }
    jetGeo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(N * 3), 3));
    jetGeo.setAttribute("aSeed", new THREE.BufferAttribute(seed, 1));
    jetGeo.setAttribute("aSide", new THREE.BufferAttribute(side, 1));
    jetGeo.setAttribute("aJit", new THREE.BufferAttribute(jit, 3));
    this.jetUniforms = { uFlow: { value: 0 }, uJet: { value: 0 }, uSpeed: { value: 0.18 }, uLength: { value: 9 }, uScale: { value: 1 } };
    const jets = new THREE.Points(jetGeo, this.ownMat(this.additive(JET_VERT, JET_FRAG, this.jetUniforms, true)));
    jets.renderOrder = 2;
    jets.frustumCulled = false;
    this.scene.add(jets);

    // Photon ring, halo and lensing impression on a camera-facing plane, drawn last over everything else.
    this.haloUniforms = { uRim: { value: 0 }, uExposure: { value: 0 }, uColour: { value: 0 }, uDiskBright: { value: 0 }, uRadius: { value: BODY_RADIUS } };
    this.halo = new THREE.Mesh(this.own(new THREE.PlaneGeometry(18, 18)), this.ownMat(this.additive(PLANE_VERT, HALO_FRAG, this.haloUniforms, false)));
    this.halo.renderOrder = 3;
    this.scene.add(this.halo);

    sceneStats.created++;
  }

  /** Number of GPU-backed resources this scene owns. */
  get resourceCounts(): { geometries: number; materials: number } {
    return { geometries: this.geometries.length, materials: this.materials.length };
  }

  /** Call when the canvas size or pixel ratio changes. */
  setViewport(cssWidth: number, cssHeight: number, pixelRatio: number): void {
    if (cssWidth < 1 || cssHeight < 1) return;
    this.camera.aspect = cssWidth / cssHeight;
    this.camera.updateProjectionMatrix();
    const pxHeight = cssHeight * pixelRatio;
    // Point sizes: jets scale with distance; stars are a fixed screen size scaled for the pixel ratio.
    this.jetUniforms.uScale.value = pxHeight * 0.06;
    this.starUniforms.uScale.value = pixelRatio;
  }

  /** Writes the animation state into uniforms and transforms. No allocation. */
  update(a: AccretionAnim, view: AccretionView): void {
    if (this.disposed) return;
    const az = a.orbit + view.azimuth;
    const el = Math.min(1.1, Math.max(0.05, BASE_ELEVATION + view.elevation));
    const dist = BASE_DISTANCE - SCENE_PUSH * a.sceneLevel;
    const ce = Math.cos(el);
    this.camera.position.set(dist * ce * Math.sin(az), dist * Math.sin(el), dist * ce * Math.cos(az));
    this.camera.lookAt(0, 0, 0);

    // Bass swells the body slightly; the ring follows its edge.
    const scale = BODY_RADIUS * (1 + 0.04 * a.horizon);
    this.body.scale.setScalar(scale / BODY_RADIUS);
    this.halo.quaternion.copy(this.camera.quaternion);

    // Camera direction in the disk's local polar angle (the disk is rotated -90 degrees about X).
    const camAngle = Math.atan2(-Math.cos(az), Math.sin(az));
    for (let i = 0; i < this.diskUniforms.length; i++) {
      const u = this.diskUniforms[i];
      u.uPhase.value = a.diskPhase;
      u.uFlow.value = a.flow;
      u.uTurb.value = a.diskTurbulence;
      u.uColour.value = a.diskColour;
      u.uExposure.value = a.exposure;
      u.uHeat.value = a.rimGlow;
      u.uDetail.value = a.detail;
      u.uCamAngle.value = camAngle;
      u.uFlare.value = a.flare;
      u.uFlareAngle.value = a.flareAngle;
    }

    const h = this.haloUniforms;
    h.uRim.value = a.rimGlow;
    h.uExposure.value = a.exposure;
    h.uColour.value = a.diskColour;
    h.uDiskBright.value = a.exposure * (0.4 + 0.6 * a.rimGlow);
    h.uRadius.value = scale;

    // A faint steady jet glow scales with loudness, so the jets stay part of the scene; impulses add to it, scaled to 0.7
    // so the jets stay third in the visual hierarchy, after the central body and the disk.
    const j = this.jetUniforms;
    j.uFlow.value = a.flow;
    j.uJet.value = Math.min(1, 0.7 * a.jet + 0.06 * a.exposure);

    const s = this.starUniforms;
    s.uFlow.value = a.flow;
    s.uTwinkle.value = a.detail;
    s.uExposure.value = a.exposure;
  }

  /**
   * Call when the WebGL context is lost. Releases the renderer's records of this scene's GPU objects while the
   * context is lost (when the deletes are silent no-ops), but keeps the scene graph. On the next draw after the
   * context is restored, Three.js uploads the same geometries and materials into the new context. Without this,
   * records from the old context survive the restore and a later dispose deletes them on the wrong context, which
   * the browser reports as "object does not belong to this context".
   */
  releaseGpu(): void {
    if (this.disposed) return;
    for (const g of this.geometries) g.dispose();
    for (const m of this.materials) m.dispose();
  }

  /** Releases every geometry and material. Safe to call more than once. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const g of this.geometries) g.dispose();
    for (const m of this.materials) m.dispose();
    this.scene.clear();
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

  private additive(vertexShader: string, fragmentShader: string, uniforms: Uniforms, depthTest: boolean): THREE.ShaderMaterial {
    return new THREE.ShaderMaterial({
      vertexShader,
      fragmentShader,
      uniforms,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      depthTest,
    });
  }
}
