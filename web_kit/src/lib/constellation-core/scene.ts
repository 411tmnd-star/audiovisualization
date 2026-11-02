import * as THREE from "three";

import type { CoreAnim } from "./animator";
import { BEAM_FRAG, BEAM_STRIP_FRAG, BEAM_VERT, BODY_VERT, CORE_FRAG, HALO_FRAG, ORB_FRAG, PLANE_VERT, RING_FRAG, STAR_FRAG, STAR_VERT } from "./shaders";

/**
 * The Constellation Core scene: a glowing core, three tilted orbit rings with travelling heads, eight glass-like orbs, a
 * vertical beam and a star field. Everything is built once in the constructor. `update` writes uniforms and transforms
 * only, so a frame allocates nothing. `dispose` releases every geometry and material the scene created.
 *
 * Visual hierarchy, by brightness and draw order: core and its rim, then rings and orbs, then the beam, then stars.
 * Sizes, colours and rates are PROPOSED values for visual review, not measured quantities.
 */

/** Module-level counts, so lifecycle checks can confirm every scene created was disposed. */
export const sceneStats = { created: 0, disposed: 0 };

export const CORE_RADIUS = 1.5;
/** Orbit radii, tilts (about X, about Z, radians), speeds relative to phase, and orbs per ring. */
export const RING_RADII = [3.4, 4.7, 6.0] as const;
export const RING_TILTS = [[0.35, 0.25], [-0.5, -0.4], [0.9, 0.1]] as const;
export const RING_SPEEDS = [1.0, 0.7, 0.5] as const;
export const ORBS_PER_RING = [2, 3, 3] as const;
const ORB_SIZES = [0.26, 0.34, 0.22, 0.40, 0.28, 0.30, 0.36, 0.24];
const RING_WIDTH = 0.09;
export const BEAM_POINTS_PER_SIDE = 1000;
export const STAR_COUNT = 1500;
const FOV = 36;
const BASE_DISTANCE = 14;
/** The camera moves this much closer as the music builds and peaks. */
/** How far each audio signal moves its visual: core size, camera distance, orb size (fractions). */
const CORE_SWELL = 0.14;
const CAMERA_BREATH = 0.03;
const ORB_SHIMMER = 0.22;
const SCENE_PUSH = 1.5;
const BASE_ELEVATION = 0.35;
/** The outer ring (radius 6) plus perspective margin must fit the canvas width: half-width kept in view, world units. */
export const FIT_HALF_WIDTH = 7.4;

export interface CoreView {
  /** Extra azimuth from the viewer's drag, radians. */
  azimuth: number;
  /** Extra elevation from the viewer's drag, radians. */
  elevation: number;
}

/** A small deterministic generator, so the stars and beam seeds are the same on every load. */
function lcg(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

type Uniforms = Record<string, { value: number }>;

export class ConstellationCoreScene {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(FOV, 16 / 9, 0.1, 400);
  /** The three ring groups (each holds its ring ribbon and its orbs), exposed for tests and framing checks. */
  readonly rings: THREE.Group[] = [];
  private readonly geometries: THREE.BufferGeometry[] = [];
  private readonly materials: THREE.Material[] = [];
  private readonly core: THREE.Mesh;
  private readonly halo: THREE.Mesh;
  private readonly strip: THREE.Mesh;
  private readonly orbs: Array<{ mesh: THREE.Mesh; ring: number; base: number; size: number }> = [];
  private readonly ringUniforms: Uniforms[] = [];
  private readonly coreUniforms: Uniforms;
  private readonly orbUniforms: Uniforms;
  private readonly haloUniforms: Uniforms;
  private readonly stripUniforms: Uniforms;
  private readonly beamUniforms: Uniforms;
  private readonly starUniforms: Uniforms;
  private fitDistance = BASE_DISTANCE;
  private disposed = false;

  constructor() {
    const rand = lcg(20261014);

    // Stars: far away, depth-tested so the core hides those behind it.
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

    // Core: opaque, writes depth, so rings and orbs behind it are hidden.
    this.coreUniforms = { uGlow: { value: 0 }, uExposure: { value: 0 }, uColour: { value: 0 }, uFlow: { value: 0 } };
    this.core = new THREE.Mesh(this.own(new THREE.SphereGeometry(CORE_RADIUS, 64, 32)), this.ownMat(this.opaque(BODY_VERT, CORE_FRAG, this.coreUniforms)));
    this.core.renderOrder = 0;
    this.scene.add(this.core);

    // Orbs share one unit-sphere geometry and one material.
    this.orbUniforms = { uShimmer: { value: 0 }, uExposure: { value: 0 }, uColour: { value: 0 }, uFlow: { value: 0 } };
    const orbGeo = this.own(new THREE.SphereGeometry(1, 24, 16));
    const orbMat = this.ownMat(this.opaque(BODY_VERT, ORB_FRAG, this.orbUniforms));

    // Rings: each ring ribbon and its orbs live in a tilted group.
    let orbIndex = 0;
    for (let i = 0; i < RING_RADII.length; i++) {
      const R = RING_RADII[i];
      const group = new THREE.Group();
      group.rotation.set(RING_TILTS[i][0], 0, RING_TILTS[i][1]);
      const u: Uniforms = {
        uInner: { value: R - RING_WIDTH / 2 }, uOuter: { value: R + RING_WIDTH / 2 }, uHead: { value: 0 },
        uPulse: { value: 0 }, uExposure: { value: 0 }, uColour: { value: 0 },
      };
      this.ringUniforms.push(u);
      const ribbon = new THREE.Mesh(this.own(new THREE.RingGeometry(R - RING_WIDTH / 2, R + RING_WIDTH / 2, 192, 1)), this.ownMat(this.additive(PLANE_VERT, RING_FRAG, u, true)));
      ribbon.rotation.x = -Math.PI / 2;
      ribbon.renderOrder = 1;
      group.add(ribbon);
      for (let k = 0; k < ORBS_PER_RING[i]; k++) {
        const orb = new THREE.Mesh(orbGeo, orbMat);
        const size = ORB_SIZES[orbIndex % ORB_SIZES.length];
        orb.scale.setScalar(size);
        orb.renderOrder = 1;
        group.add(orb);
        this.orbs.push({ mesh: orb, ring: i, base: (k / ORBS_PER_RING[i]) * Math.PI * 2 + i * 1.3, size });
        orbIndex++;
      }
      this.rings.push(group);
      this.scene.add(group);
    }

    // Beam: a strip (billboard about the vertical axis) and a narrow stream of points, both fading in from the core.
    this.stripUniforms = { uBeam: { value: 0 }, uColour: { value: 0 }, uFlow: { value: 0 }, uCoreR: { value: CORE_RADIUS } };
    this.strip = new THREE.Mesh(this.own(new THREE.PlaneGeometry(1, 20)), this.ownMat(this.additive(PLANE_VERT, BEAM_STRIP_FRAG, this.stripUniforms, true)));
    this.strip.renderOrder = 2;
    this.strip.frustumCulled = false;
    this.scene.add(this.strip);

    const N = BEAM_POINTS_PER_SIDE * 2;
    const beamGeo = this.own(new THREE.BufferGeometry());
    const seed = new Float32Array(N);
    const side = new Float32Array(N);
    const jit = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) {
      seed[i] = rand();
      side[i] = i < BEAM_POINTS_PER_SIDE ? 1 : -1;
      const ang = rand() * Math.PI * 2;
      const rad = Math.sqrt(rand());
      jit[i * 3] = Math.cos(ang) * rad;
      jit[i * 3 + 1] = Math.sin(ang) * rad;
      jit[i * 3 + 2] = rand();
    }
    beamGeo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(N * 3), 3));
    beamGeo.setAttribute("aSeed", new THREE.BufferAttribute(seed, 1));
    beamGeo.setAttribute("aSide", new THREE.BufferAttribute(side, 1));
    beamGeo.setAttribute("aJit", new THREE.BufferAttribute(jit, 3));
    this.beamUniforms = { uFlow: { value: 0 }, uBeam: { value: 0 }, uSpeed: { value: 0.16 }, uLength: { value: 8 }, uCoreR: { value: CORE_RADIUS }, uScale: { value: 1 } };
    const beam = new THREE.Points(beamGeo, this.ownMat(this.additive(BEAM_VERT, BEAM_FRAG, this.beamUniforms, true)));
    beam.renderOrder = 2;
    beam.frustumCulled = false;
    this.scene.add(beam);

    // Halo and rim band on a camera-facing plane, drawn last over everything else.
    this.haloUniforms = { uRadius: { value: CORE_RADIUS }, uGlow: { value: 0 }, uExposure: { value: 0 }, uColour: { value: 0 }, uFlow: { value: 0 } };
    this.halo = new THREE.Mesh(this.own(new THREE.PlaneGeometry(16, 16)), this.ownMat(this.additive(PLANE_VERT, HALO_FRAG, this.haloUniforms, false)));
    this.halo.renderOrder = 3;
    this.scene.add(this.halo);

    sceneStats.created++;
  }

  /** Number of GPU-backed resources this scene owns. */
  get resourceCounts(): { geometries: number; materials: number } {
    return { geometries: this.geometries.length, materials: this.materials.length };
  }

  /** The camera distance that keeps the outer ring inside the canvas width (before the scene-level push). */
  get distance(): number {
    return this.fitDistance;
  }

  /** Call when the canvas size or pixel ratio changes. Framing follows the aspect, so a narrow canvas never clips the rings. */
  setViewport(cssWidth: number, cssHeight: number, pixelRatio: number): void {
    if (cssWidth < 1 || cssHeight < 1) return;
    const aspect = cssWidth / cssHeight;
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
    const tanHalf = Math.tan((FOV * Math.PI) / 360);
    this.fitDistance = Math.max(BASE_DISTANCE, FIT_HALF_WIDTH / (tanHalf * aspect));
    this.beamUniforms.uScale.value = cssHeight * pixelRatio * 0.06;
    this.starUniforms.uScale.value = pixelRatio;
  }

  /** Writes the animation state into uniforms and transforms. No allocation. */
  update(a: CoreAnim, view: CoreView): void {
    if (this.disposed) return;
    const az = a.drift + view.azimuth;
    const el = Math.min(1.2, Math.max(0, BASE_ELEVATION + view.elevation));
    // The camera also breathes with the bass (a few percent), so a kick is felt by the whole frame and not only by the core.
    const dist = (this.fitDistance - SCENE_PUSH * a.sceneLevel) * (1 - CAMERA_BREATH * a.swell);
    const ce = Math.cos(el);
    this.camera.position.set(dist * ce * Math.sin(az), dist * Math.sin(el), dist * ce * Math.cos(az));
    this.camera.lookAt(0, 0, 0);

    // Bass swells the core; the halo follows its edge.
    const scale = 1 + CORE_SWELL * a.swell;
    this.core.scale.setScalar(scale);
    this.halo.quaternion.copy(this.camera.quaternion);
    this.strip.rotation.y = Math.atan2(this.camera.position.x, this.camera.position.z);

    // Rings: heads and orbs advance on the accumulated phase; a pulse lights one ring at a time.
    for (let i = 0; i < this.ringUniforms.length; i++) {
      const u = this.ringUniforms[i];
      u.uHead.value = a.phase * RING_SPEEDS[i];
      u.uPulse.value = i === a.pulseRing ? a.pulse : 0;
      u.uExposure.value = a.exposure;
      u.uColour.value = a.colour;
    }
    for (let k = 0; k < this.orbs.length; k++) {
      const o = this.orbs[k];
      const ang = o.base + a.phase * RING_SPEEDS[o.ring];
      const R = RING_RADII[o.ring];
      // The ribbon is rotated -90 degrees about X, so ring angle `ang` maps to (cos, 0, -sin).
      o.mesh.position.set(R * Math.cos(ang), 0, -R * Math.sin(ang));
      o.mesh.scale.setScalar(o.size * (1 + ORB_SHIMMER * a.shimmer));
    }

    const c = this.coreUniforms;
    c.uGlow.value = a.glow;
    c.uExposure.value = a.exposure;
    c.uColour.value = a.colour;
    c.uFlow.value = a.flow;

    const ob = this.orbUniforms;
    ob.uShimmer.value = a.shimmer;
    ob.uExposure.value = a.exposure;
    ob.uColour.value = a.colour;
    ob.uFlow.value = a.flow;

    const h = this.haloUniforms;
    h.uRadius.value = CORE_RADIUS * scale;
    h.uGlow.value = a.glow;
    h.uExposure.value = a.exposure;
    h.uColour.value = a.colour;
    h.uFlow.value = a.flow;

    // A faint steady beam glow scales with loudness so the beam stays part of the scene; impulses add to it, scaled to 0.7
    // so the beam stays third in the visual hierarchy, after the core and the rings.
    const beam = Math.min(1, 0.7 * a.beam + 0.08 * a.exposure);
    const s = this.stripUniforms;
    s.uBeam.value = beam;
    s.uColour.value = a.colour;
    s.uFlow.value = a.flow;
    const b = this.beamUniforms;
    b.uBeam.value = beam;
    b.uFlow.value = a.flow;

    const st = this.starUniforms;
    st.uFlow.value = a.flow;
    st.uTwinkle.value = a.shimmer;
    st.uExposure.value = a.exposure;
  }

  /**
   * Call when the WebGL context is lost. Releases the renderer's records of this scene's GPU objects while the context is
   * lost (when the deletes are silent no-ops), but keeps the scene graph; the next draw after a restore uploads the same
   * geometries and materials into the new context. Same contract as Accretion's scene.
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
    this.rings.length = 0;
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
    return new THREE.ShaderMaterial({ vertexShader, fragmentShader, uniforms, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, depthTest, side: THREE.DoubleSide });
  }

  private opaque(vertexShader: string, fragmentShader: string, uniforms: Uniforms): THREE.ShaderMaterial {
    return new THREE.ShaderMaterial({ vertexShader, fragmentShader, uniforms });
  }
}
