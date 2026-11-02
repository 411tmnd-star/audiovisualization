import * as THREE from "three";

import type { ResonatorAnim } from "./animator";
import {
  BAR_FRAG, BAR_VERT, BEAD_FRAG, BEAD_VERT, BODY_VERT, FILAMENT_FRAG, FILAMENT_VERT, FLOOR_FRAG, FLOOR_VERT, HALO_FRAG, HALO_VERT,
  PARTICLE_FRAG, PARTICLE_VERT, PLASMA_FRAG, RIBBON_FRAG, RIBBON_VERT, RIM_FRAG, TRACK_FRAG, TRACK_VERT,
} from "./shaders";

/**
 * The Resonator scene: a glass orb with a plasma heart, 24 fluid ribbon rings on the X-Z plane, five gold light tracks with
 * instanced node beads, two arcs of spectrum-style bars, a dark floor carrying a mirrored copy of the light, and a
 * suspended particle field. Everything is built once in the constructor. `update` writes uniforms and transforms only, so
 * a frame allocates nothing. `dispose` releases every geometry, material and texture the scene created.
 *
 * Draw order (transparent objects, by group render order): mirrored light (1), floor (2), light (3), halo (9). The opaque
 * heart and the transmissive orb are drawn before all of them.
 *
 * Quality tiers. "full" gives the orb real transmission (the scene is drawn once more into a render target) and the mirrored
 * floor. "lite" turns both off: the orb becomes a translucent shell and the floor only shows a glow pool. Sizes, colours and
 * rates are PROPOSED values for visual review, not measured quantities.
 */

/** Module-level counts, so lifecycle checks can confirm every scene created was disposed. */
export const sceneStats = { created: 0, disposed: 0 };

export type ResonatorQuality = "full" | "lite";

/** Ribbon rings (the brief asks for 16-32), their inner and outer radius, and the half-width of the first ring's ribbon. */
export const RING_COUNT = 24;
export const R_IN = 3.0;
export const R_OUT = 9.0;
export const RIBBON_HALF_WIDTH = 0.085;
export const RIBBON_SEGMENTS = 192;
/** Light-track radii and the number of node beads on each. */
export const TRACK_RADII = [3.7, 4.8, 6.0, 7.3, 8.6] as const;
export const BEADS_PER_TRACK = [20, 26, 32, 38, 44] as const;
export const TRACK_SEGMENTS = 256;
const TRACK_HALF = 0.35;
const TRACK_Y = 0.03;
/** Spectrum-style bars: two arcs, one amber (mids) on the second track and one cyan (highs) on the third. */
export const BARS_PER_ARC = 150;
/** Heart: orb radius and height. The ribbon plane is y = 0. */
export const ORB_RADIUS = 1.7;
export const HEART_Y = 0.25;
const PLASMA_RADIUS = 0.52;
export const FLOOR_Y = -1.1;
export const PARTICLE_COUNT = 900;
const PARTICLE_R0 = 3.0;
const PARTICLE_R1 = 14;
const PARTICLE_Y0 = -0.8;
const PARTICLE_H = 9;
const FOV = 36;
const BASE_DISTANCE = 17;
/** The camera moves this much closer as the music builds and peaks. */
const SCENE_PUSH = 1.4;
const BASE_ELEVATION = 0.36;
const LOOK_AT_Y = 0.35;
/** The outer ribbon (radius 9) plus wave and perspective margin must fit the canvas width: half-width kept in view, world units. */
export const FIT_HALF_WIDTH = 9.8;
/** Fraction of the half vertical field of view the near edge of the outer ribbon may use. */
export const FIT_VERTICAL = 0.85;
/** Orb scale at full bass and at a full bass hit, as a fraction. */
const ORB_SWELL = 0.10;
const ORB_KICK = 0.10;
/** Warm point light in the heart, in candela-like units (three.js physical lights). */
const LIGHT_BASE = 1.2;
const LIGHT_GAIN = 5;
const HALO_SIZE = 10;

export interface ResonatorView {
  /** Extra azimuth from the viewer's drag, radians. */
  azimuth: number;
  /** Extra elevation from the viewer's drag, radians. */
  elevation: number;
}

export interface ResonatorOptions {
  quality?: ResonatorQuality;
}

/** A small deterministic generator, so particles, beads and bars are the same on every load. */
function lcg(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

const f = (n: number) => n.toFixed(4);

/**
 * Ribbon-strip geometry for one or more concentric rings. A vertex's `position` is not a point: x is the angle, y the side
 * (-1 or 1 across the ribbon) and z is `zOf(ring)` (a ring index for the ribbons, a radius for the tracks). The vertex
 * shader builds the real position, so the surface can be displaced on the GPU.
 */
export function ringStrip(segments: number, rings: number, zOf: (ring: number) => number): THREE.BufferGeometry {
  const verts = rings * (segments + 1) * 2;
  const pos = new Float32Array(verts * 3);
  const idx = verts > 65535 ? new Uint32Array(rings * segments * 6) : new Uint16Array(rings * segments * 6);
  let v = 0;
  let k = 0;
  for (let r = 0; r < rings; r++) {
    const z = zOf(r);
    const base = v / 2;
    for (let s = 0; s <= segments; s++) {
      const th = (s / segments) * Math.PI * 2;
      for (const side of [-1, 1]) {
        pos[v * 3] = th;
        pos[v * 3 + 1] = side;
        pos[v * 3 + 2] = z;
        v++;
      }
    }
    for (let s = 0; s < segments; s++) {
      const a = (base + s) * 2;
      idx.set([a, a + 1, a + 2, a + 1, a + 3, a + 2], k);
      k += 6;
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  return g;
}

/**
 * A small procedural equirectangular environment for the glass: a dark navy sky with a cool overhead strip and warm and
 * blue side panels. Built on the CPU, so it needs no renderer, no asset and no PMREM generator of our own.
 */
export function environmentData(width = 128, height = 64): Uint8Array {
  const out = new Uint8Array(width * height * 4);
  const soft = (x: number, a: number, b: number, e: number) => Math.min(1, Math.max(0, Math.min((x - a) / e, (b - x) / e)));
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const u = x / width;
      const v = y / height;
      let r = 0.01 + 0.09 * (1 - v) ** 2;
      let g = 0.015 + 0.14 * (1 - v) ** 2;
      let b = 0.04 + 0.30 * (1 - v) ** 2;
      const top = soft(u, 0.3, 0.7, 0.08) * soft(v, 0.02, 0.2, 0.05);
      r += 0.85 * top; g += 0.92 * top; b += 1.0 * top;
      const amber = Math.max(soft(u, 0.04, 0.14, 0.03), soft(u, 0.54, 0.64, 0.03)) * soft(v, 0.32, 0.62, 0.06);
      r += 1.0 * amber; g += 0.58 * amber; b += 0.2 * amber;
      const blue = soft(u, 0.78, 0.9, 0.03) * soft(v, 0.28, 0.5, 0.06);
      r += 0.3 * blue; g += 0.6 * blue; b += 1.0 * blue;
      const o = (y * width + x) * 4;
      out[o] = Math.round(Math.min(1, r) ** (1 / 2.2) * 255);
      out[o + 1] = Math.round(Math.min(1, g) ** (1 / 2.2) * 255);
      out[o + 2] = Math.round(Math.min(1, b) ** (1 / 2.2) * 255);
      out[o + 3] = 255;
    }
  }
  return out;
}

type Uniforms = Record<string, { value: number }>;

export class ResonatorScene {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(FOV, 16 / 9, 0.1, 200);
  readonly quality: ResonatorQuality;
  /** Exposed for tests and framing checks. */
  readonly orb: THREE.Mesh;
  readonly heart = new THREE.Group();
  readonly light: THREE.PointLight;
  readonly beads: THREE.InstancedMesh;
  readonly bars: THREE.InstancedMesh;
  readonly ribbons: THREE.Mesh;
  private readonly geometries: THREE.BufferGeometry[] = [];
  private readonly materials: THREE.Material[] = [];
  private readonly textures: THREE.Texture[] = [];
  private readonly plasma: THREE.Mesh;
  private readonly lattice: THREE.LineSegments;
  private readonly filaments: THREE.Mesh[] = [];
  private readonly halo: THREE.Mesh;
  private readonly rim: THREE.Mesh;
  private readonly mirror = new THREE.Group();
  /** Uniforms shared by every material, so one write per frame feeds both the light and its mirrored copy. */
  private readonly u: Uniforms = {};
  private fitDistance = BASE_DISTANCE;
  private disposed = false;

  constructor(opts: ResonatorOptions = {}) {
    this.quality = opts.quality ?? "full";
    const full = this.quality === "full";
    for (const k of [
      "uRise", "uRadial", "uRipple", "uRippleFreq", "uPhaseMid", "uPhaseHigh", "uExposure", "uGlow", "uFlash", "uBeadPhase", "uBeadPulse", "uBeadAmt",
      "uBarMid", "uBarHigh", "uBarPhase", "uBurst", "uFlow", "uTwinkle", "uAtmos", "uBloom", "uScale",
    ]) this.u[k] = { value: 0 };
    this.u.uRippleFreq.value = 6;
    this.u.uScale.value = 1;

    const defines = {
      RING_N: f(RING_COUNT), R_IN: f(R_IN), R_OUT: f(R_OUT), HALF_W: f(RIBBON_HALF_WIDTH), TRACK_HALF: f(TRACK_HALF), TRACK_Y: f(TRACK_Y),
      P_R0: f(PARTICLE_R0), P_R1: f(PARTICLE_R1), P_Y0: f(PARTICLE_Y0), P_H: f(PARTICLE_H),
    };
    const rand = lcg(20261021);
    // Each material gets only the uniforms its shader reads (all sharing the same value objects), so a frame uploads little.
    const uni = (names: string[], mirror?: number): Record<string, { value: number }> => {
      const o: Record<string, { value: number }> = {};
      for (const n of names) o[n] = this.u[n];
      if (mirror !== undefined) o.uMirror = { value: mirror };
      return o;
    };
    const RIBBON_U = ["uRise", "uRadial", "uRipple", "uRippleFreq", "uPhaseMid", "uPhaseHigh", "uExposure", "uGlow"];
    const TRACK_U = ["uExposure", "uFlash", "uBeadPhase"];
    const BEAD_U = ["uBeadPhase", "uBeadPulse", "uBeadAmt", "uFlash", "uExposure"];
    const BAR_U = ["uBarMid", "uBarHigh", "uBarPhase", "uFlash", "uExposure"];

    // --- shared geometry -------------------------------------------------------------------------------------------
    const ribbonGeo = this.own(ringStrip(RIBBON_SEGMENTS, RING_COUNT, (r) => r));
    const trackGeo = this.own(ringStrip(TRACK_SEGMENTS, TRACK_RADII.length, (r) => TRACK_RADII[r]));

    const beadCount = BEADS_PER_TRACK.reduce((a, b) => a + b, 0);
    const orbit = new Float32Array(beadCount * 4);
    let b = 0;
    for (let t = 0; t < TRACK_RADII.length; t++) {
      const dir = t % 2 === 0 ? 1 : -1;
      for (let i = 0; i < BEADS_PER_TRACK[t]; i++) {
        orbit.set([TRACK_RADII[t], ((i + 0.4 * (rand() - 0.5)) / BEADS_PER_TRACK[t]) * Math.PI * 2, dir * (0.95 - 0.12 * t), 0.042 + 0.03 * rand()], b * 4);
        b++;
      }
    }
    const beadGeo = this.own(new THREE.IcosahedronGeometry(1, 1));
    beadGeo.setAttribute("aOrbit", new THREE.InstancedBufferAttribute(orbit, 4));

    const barData = new Float32Array(BARS_PER_ARC * 2 * 4);
    for (let arc = 0; arc < 2; arc++) {
      for (let i = 0; i < BARS_PER_ARC; i++) {
        barData.set([(i / BARS_PER_ARC) * Math.PI * 2, TRACK_RADII[1 + arc], rand(), arc], (arc * BARS_PER_ARC + i) * 4);
      }
    }
    const barGeo = this.own(new THREE.BoxGeometry(0.045, 1, 0.045));
    barGeo.translate(0, 0.5, 0);
    barGeo.setAttribute("aBar", new THREE.InstancedBufferAttribute(barData, 4));

    // --- the light: ribbons, tracks, beads, bars (built twice: real and mirrored) -----------------------------------
    const makeLight = (mirror: number) => {
      const g = new THREE.Group();
      const sh = (vertexShader: string, fragmentShader: string, names: string[]) => this.ownMat(this.additive(vertexShader, fragmentShader, uni(names, mirror), defines));
      const ribbons = new THREE.Mesh(ribbonGeo, sh(RIBBON_VERT, RIBBON_FRAG, RIBBON_U));
      const tracks = new THREE.Mesh(trackGeo, sh(TRACK_VERT, TRACK_FRAG, TRACK_U));
      const beads = new THREE.InstancedMesh(beadGeo, sh(BEAD_VERT, BEAD_FRAG, BEAD_U), beadCount);
      const bars = new THREE.InstancedMesh(barGeo, sh(BAR_VERT, BAR_FRAG, BAR_U), BARS_PER_ARC * 2);
      for (const m of [ribbons, tracks, beads, bars]) { m.frustumCulled = false; g.add(m); }
      return { g, ribbons, beads, bars };
    };
    const real = makeLight(1);
    real.g.renderOrder = 3;
    this.ribbons = real.ribbons;
    this.beads = real.beads;
    this.bars = real.bars;

    // Two large, tilted halo rings above the plane (the reference's overhead ellipses): the same track shader, one ring each.
    for (const [radius, tiltX, tiltZ] of [[6.4, 0.5, 0.12], [8.0, -0.32, -0.2]] as const) {
      const geo = this.own(ringStrip(TRACK_SEGMENTS, 1, () => radius));
      const m = new THREE.Mesh(geo, this.ownMat(this.additive(TRACK_VERT, TRACK_FRAG, uni(TRACK_U, 0.55), defines)));
      m.frustumCulled = false;
      m.position.y = HEART_Y;
      m.rotation.set(tiltX, 0, tiltZ);
      real.g.add(m);
    }

    // Particles: a cylinder of points around the scene; their motion is entirely in the vertex shader.
    const seeds = new Float32Array(PARTICLE_COUNT * 4);
    for (let i = 0; i < seeds.length; i++) seeds[i] = rand();
    const partGeo = this.own(new THREE.BufferGeometry());
    partGeo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(PARTICLE_COUNT * 3), 3));
    partGeo.setAttribute("aSeed", new THREE.BufferAttribute(seeds, 4));
    const particles = new THREE.Points(partGeo, this.ownMat(this.additive(PARTICLE_VERT, PARTICLE_FRAG, uni(["uFlow", "uBurst", "uScale", "uAtmos", "uTwinkle"]), defines)));
    particles.frustumCulled = false;
    real.g.add(particles);
    this.scene.add(real.g);

    // --- the mirrored copy and the floor ----------------------------------------------------------------------------
    // The mirror is the same geometry flipped about the floor plane and dimmed. The floor then covers it with a dark
    // translucent surface, which is what makes it read as a reflection. Skipped in the lite tier.
    const mirrored = makeLight(0.22);
    mirrored.g.renderOrder = 1; // a nested Group's own render order replaces its parent's when sorting
    this.mirror.add(mirrored.g);
    this.mirror.scale.y = -1;
    this.mirror.position.y = 2 * FLOOR_Y;
    this.mirror.renderOrder = 1;
    this.mirror.visible = full;
    this.scene.add(this.mirror);

    const floorGeo = this.own(new THREE.CircleGeometry(30, 64));
    const floorMat = this.ownMat(new THREE.ShaderMaterial({ vertexShader: FLOOR_VERT, fragmentShader: FLOOR_FRAG, uniforms: uni(["uGlow", "uExposure"]), transparent: true, depthWrite: false }));
    const floor = new THREE.Mesh(floorGeo, floorMat);
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = FLOOR_Y;
    floor.frustumCulled = false;
    const floorGroup = new THREE.Group();
    floorGroup.renderOrder = 2;
    floorGroup.add(floor);
    this.scene.add(floorGroup);

    // --- the heart: glass orb, plasma core, filament lattice, warm light ----------------------------------------------
    const env = new THREE.DataTexture(environmentData(), 128, 64, THREE.RGBAFormat);
    env.mapping = THREE.EquirectangularReflectionMapping;
    env.colorSpace = THREE.SRGBColorSpace;
    env.magFilter = THREE.LinearFilter;
    env.minFilter = THREE.LinearFilter;
    env.generateMipmaps = false;
    env.needsUpdate = true;
    this.textures.push(env);

    const orbMat = this.ownMat(
      full
        ? new THREE.MeshPhysicalMaterial({
            color: 0xffffff, transmission: 0.95, roughness: 0.1, ior: 1.5, thickness: 0.3, metalness: 0,
            attenuationColor: new THREE.Color(0x9ac8ff), attenuationDistance: 8, envMap: env, envMapIntensity: 1.0,
          })
        : new THREE.MeshPhysicalMaterial({ color: 0xbcd8ff, transmission: 0, transparent: true, opacity: 0.28, roughness: 0.1, ior: 1.5, metalness: 0, envMap: env, envMapIntensity: 1.0, depthWrite: false }),
    );
    this.orb = new THREE.Mesh(this.own(new THREE.SphereGeometry(ORB_RADIUS, 64, 48)), orbMat);

    this.plasma = new THREE.Mesh(this.own(new THREE.SphereGeometry(PLASMA_RADIUS, 40, 28)), this.ownMat(new THREE.ShaderMaterial({ vertexShader: BODY_VERT, fragmentShader: PLASMA_FRAG, uniforms: uni(["uGlow", "uFlow"]) })));

    const filamentMat = (mix: number) => this.ownMat(new THREE.ShaderMaterial({ vertexShader: FILAMENT_VERT, fragmentShader: FILAMENT_FRAG, uniforms: { ...uni(["uGlow"]), uMix: { value: mix } } }));
    this.lattice = new THREE.LineSegments(this.own(new THREE.WireframeGeometry(new THREE.IcosahedronGeometry(1.15, 1))), filamentMat(0.55));
    const ringGeo = this.own(new THREE.TorusGeometry(1, 0.012, 6, 96));
    const ringMat = filamentMat(0);
    for (const [s, tx, tz] of [[0.98, 1.2, 0.3], [1.3, -0.6, 0.9]] as const) {
      const m = new THREE.Mesh(ringGeo, ringMat);
      m.scale.setScalar(s);
      m.rotation.set(tx, 0, tz);
      this.filaments.push(m);
      this.heart.add(m);
    }
    this.light = new THREE.PointLight(0xffa347, LIGHT_BASE, 14, 2);
    this.heart.add(this.plasma, this.lattice, this.light, this.orb);
    this.heart.position.y = HEART_Y;
    this.scene.add(this.heart);

    // The glass rim: an additive fresnel shell, drawn with the light (render order 4) so it sits over the floor and its mirror.
    this.rim = new THREE.Mesh(this.own(new THREE.SphereGeometry(ORB_RADIUS * 1.012, 48, 32)), this.ownMat(new THREE.ShaderMaterial({
      vertexShader: BODY_VERT, fragmentShader: RIM_FRAG, uniforms: uni(["uGlow", "uExposure"]), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
    })));
    this.rim.position.y = HEART_Y;
    const rimGroup = new THREE.Group();
    rimGroup.renderOrder = 4;
    rimGroup.add(this.rim);
    this.scene.add(rimGroup);

    // --- the halo (the in-scene stand-in for bloom) --------------------------------------------------------------------
    this.halo = new THREE.Mesh(this.own(new THREE.PlaneGeometry(2, 2)), this.ownMat(new THREE.ShaderMaterial({
      vertexShader: HALO_VERT, fragmentShader: HALO_FRAG, uniforms: uni(["uGlow", "uBloom", "uAtmos"]), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false,
    })));
    this.halo.position.y = HEART_Y;
    this.halo.scale.setScalar(HALO_SIZE);
    this.halo.frustumCulled = false;
    const haloGroup = new THREE.Group();
    haloGroup.renderOrder = 9;
    haloGroup.add(this.halo);
    this.scene.add(haloGroup);

    this.camera.position.set(0, 4, this.fitDistance);
    this.camera.lookAt(0, LOOK_AT_Y, 0);
    sceneStats.created++;
  }

  /** The shared uniform values the shaders read, for tests and diagnostics. Do not write to them from outside. */
  get uniforms(): Readonly<Record<string, { value: number }>> {
    return this.u;
  }

  /** What the scene owns, for lifecycle tests. */
  get resourceCounts() {
    return { geometries: this.geometries.length, materials: this.materials.length, textures: this.textures.length };
  }

  /** The camera distance that keeps the outer ribbon inside the canvas width (before the scene-level push). */
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
    // The distance must fit the width, and must also keep the front edge of the outer ribbon inside the canvas height: on a
    // wide, short canvas the ellipse's near edge is what is cropped first. Solved by bisection (only on a resize).
    const maxOffset = ((FOV * Math.PI) / 360) * FIT_VERTICAL;
    const el = BASE_ELEVATION;
    const frontOffset = (d: number) => Math.atan2(d * Math.sin(el), d * Math.cos(el) - R_OUT) - el;
    let dv = BASE_DISTANCE;
    if (frontOffset(dv) > maxOffset) {
      let lo = dv, hi = 120;
      for (let i = 0; i < 40; i++) {
        const mid = (lo + hi) / 2;
        if (frontOffset(mid) > maxOffset) lo = mid; else hi = mid;
      }
      dv = hi;
    }
    this.fitDistance = Math.max(dv, FIT_HALF_WIDTH / (tanHalf * aspect));
    this.u.uScale.value = pixelRatio * (cssHeight / 720);
  }

  /** Writes the animation state into uniforms and transforms. No allocation. */
  update(a: ResonatorAnim, view: ResonatorView): void {
    if (this.disposed) return;
    const az = a.drift + view.azimuth;
    const el = Math.min(1.2, Math.max(0.05, BASE_ELEVATION + view.elevation));
    const dist = this.fitDistance - SCENE_PUSH * a.sceneLevel;
    const ce = Math.cos(el);
    this.camera.position.set(dist * ce * Math.sin(az), LOOK_AT_Y + dist * Math.sin(el), dist * ce * Math.cos(az));
    this.camera.lookAt(0, LOOK_AT_Y, 0);

    const u = this.u;
    u.uRise.value = a.rise;
    u.uRadial.value = a.radial;
    u.uRipple.value = a.ripple;
    u.uRippleFreq.value = 6 + 10 * a.rippleRate;
    u.uPhaseMid.value = a.phaseMid;
    u.uPhaseHigh.value = a.phaseHigh;
    u.uExposure.value = a.exposure;
    u.uGlow.value = a.glow;
    u.uFlash.value = a.flash;
    u.uBeadPhase.value = a.beadPhase;
    u.uBeadPulse.value = a.beadPulse;
    u.uBeadAmt.value = a.beadSpeed;
    u.uBarMid.value = a.rise;
    u.uBarHigh.value = a.ripple;
    u.uBarPhase.value = 0.6 * a.phaseHigh + 0.4 * a.phaseMid;
    u.uBurst.value = a.burst;
    u.uFlow.value = a.flow;
    u.uTwinkle.value = a.ripple;
    u.uAtmos.value = a.atmosphere;
    u.uBloom.value = a.bloom;

    // Bass pulses the orb; the plasma inside swells further than the glass. The warm light follows the glow.
    const orbScale = 1 + ORB_SWELL * a.swell + ORB_KICK * a.kick;
    this.orb.scale.setScalar(orbScale);
    this.rim.scale.setScalar(orbScale);
    this.plasma.scale.setScalar(1 + 0.22 * a.swell + 0.1 * a.kick);
    this.lattice.rotation.set(a.flow * 0.31, a.flow * 0.5, 0);
    this.filaments[0].rotation.y = a.flow * 0.7;
    this.filaments[1].rotation.y = -a.flow * 0.5;
    this.light.intensity = LIGHT_BASE + LIGHT_GAIN * a.glow * (1 + 0.5 * a.kick);
    this.halo.quaternion.copy(this.camera.quaternion);
    this.halo.scale.setScalar(HALO_SIZE * (1 + 0.16 * a.swell + 0.1 * a.kick));
  }

  /**
   * Call when the WebGL context is lost. Releases the renderer's records of this scene's GPU objects while the context is
   * lost (when the deletes are silent no-ops), but keeps the scene graph; the next draw after a restore uploads the same
   * geometries, materials and environment texture into the new context. Same contract as the other scenes.
   */
  releaseGpu(): void {
    if (this.disposed) return;
    for (const g of this.geometries) g.dispose();
    for (const m of this.materials) m.dispose();
    for (const t of this.textures) t.dispose();
  }

  /** Releases every geometry, material and texture. Safe to call more than once. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const g of this.geometries) g.dispose();
    for (const m of this.materials) m.dispose();
    for (const t of this.textures) t.dispose();
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

  private additive(vertexShader: string, fragmentShader: string, uniforms: Record<string, { value: number }>, defines: Record<string, string>): THREE.ShaderMaterial {
    return new THREE.ShaderMaterial({ vertexShader, fragmentShader, uniforms, defines, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: true, side: THREE.DoubleSide });
  }
}
