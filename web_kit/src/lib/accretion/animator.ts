import { follow } from "../audio/features";
import type { AccretionParams } from "./params";

/**
 * The stateful layer between the pure parameters (params.ts) and the scene.
 *
 * It holds only what the scene needs across frames: smoothed envelopes, the accumulated disk phase, the camera
 * drift, the jet impulse with its decay, and the flare with its rate limit. `stepAccretionAnim` updates one
 * preallocated object in place, so a frame allocates nothing. It is deterministic: the same sequence of params and
 * time steps always gives the same state. No clock, no DOM, no GPU.
 *
 * All constants are PROPOSED starting values, to be tuned with real audio.
 */

/** Envelope attack and release (seconds to about 63%). Short attack keeps hits readable; longer release avoids flicker. */
export const ATTACK_S = 0.03;
export const RELEASE_S = 0.22;
/** Under reduced motion every envelope rises slowly too, so no change is abrupt. */
export const REDUCED_ATTACK_S = 0.35;
/** Jet impulse decay time constant. */
export const JET_DECAY_S = 0.3;
/** Flare decay time constant. */
export const FLARE_DECAY_S = 0.3;
/** Minimum time between accepted flares: at most about 2.9 per second, under the 3-per-second flash limit. */
export const FLARE_MIN_INTERVAL_S = 0.35;
/** The largest time step taken, so a stalled tab or a long frame cannot cause a jump. Matches Squall. */
export const MAX_DT_S = 0.05;
/** Inner-edge angular speed of the disk pattern at full disk speed, radians per second. */
export const DISK_SPIN = 0.9;
/** Camera drift around the disk at full motion, radians per second. */
export const ORBIT_RATE = 0.035;
/** Golden angle: each accepted flare appears at a new, evenly spread position on the disk. */
const GOLDEN_ANGLE = 2.399963229728653;

export interface AccretionAnim {
  /** Animation time in seconds: the sum of the accepted time steps. */
  time: number;
  horizon: number;
  rimGlow: number;
  diskSpeed: number;
  diskTurbulence: number;
  diskColour: number;
  detail: number;
  exposure: number;
  sceneLevel: number;
  motion: number;
  /** Accumulated disk rotation in radians. Grows without wrapping, so differential rotation stays continuous. */
  diskPhase: number;
  /** Accumulated camera drift in radians. */
  orbit: number;
  /** Motion-scaled time: drift, jet flow and twinkle advance on this, so reduced motion slows them without a jump. */
  flow: number;
  /** Jet impulse, 0..1, decaying. */
  jet: number;
  /** Flare intensity, 0..1, decaying. */
  flare: number;
  /** Angle, in the disk's rotating frame, of the most recent flare. */
  flareAngle: number;
  /** Time of the last accepted flare. */
  lastFlareAt: number;
  /** Diagnostics: flares accepted and flares refused by the rate limit. */
  flaresAccepted: number;
  flaresRejected: number;
}

export function createAccretionAnim(): AccretionAnim {
  return {
    time: 0,
    horizon: 0,
    rimGlow: 0,
    diskSpeed: 0,
    diskTurbulence: 0,
    diskColour: 0,
    detail: 0,
    exposure: 0,
    sceneLevel: 0,
    motion: 0.25,
    diskPhase: 0,
    orbit: 0,
    flow: 0,
    jet: 0,
    flare: 0,
    flareAngle: 0,
    lastFlareAt: -Infinity,
    flaresAccepted: 0,
    flaresRejected: 0,
  };
}

const finite01 = (x: number) => (Number.isFinite(x) ? Math.min(1, Math.max(0, x)) : 0);
/** One envelope step. A module-level function, so a frame creates no closures. */
const env = (prev: number, target: number, dt: number, attack: number) => finite01(follow(prev, finite01(target), dt, attack, RELEASE_S));

/**
 * Advances the animation by `dtS` seconds towards the given parameters and returns the same object.
 * Invalid or negative steps advance nothing; steps longer than MAX_DT_S are shortened.
 */
export function stepAccretionAnim(a: AccretionAnim, p: AccretionParams, dtS: number, reduced: boolean): AccretionAnim {
  const dt = Number.isFinite(dtS) && dtS > 0 ? Math.min(dtS, MAX_DT_S) : 0;
  if (dt === 0) return a;
  a.time += dt;

  const att = reduced ? REDUCED_ATTACK_S : ATTACK_S;
  a.horizon = env(a.horizon, p.horizon, dt, att);
  a.rimGlow = env(a.rimGlow, p.rimGlow, dt, att);
  a.diskSpeed = env(a.diskSpeed, p.diskSpeed, dt, att);
  a.diskTurbulence = env(a.diskTurbulence, p.diskTurbulence, dt, att);
  a.diskColour = env(a.diskColour, p.diskColour, dt, att);
  a.detail = env(a.detail, p.detail, dt, att);
  a.exposure = env(a.exposure, p.exposure, dt, att);
  a.sceneLevel = env(a.sceneLevel, p.sceneLevel, dt, att);
  a.motion = env(a.motion, p.motion, dt, att);

  // Motion accumulates from the smoothed speeds, so a sudden change in mids bends the rotation rather than jumping it.
  a.diskPhase += dt * DISK_SPIN * a.diskSpeed;
  a.orbit += dt * ORBIT_RATE * a.motion;
  a.flow += dt * a.motion;

  // Jet: an impulse that decays, retriggered by a stronger bass hit. Never above the strongest input.
  a.jet = Math.max(a.jet * Math.exp(-dt / JET_DECAY_S), finite01(p.jet));

  // Flare: rate-limited, then decaying.
  const decayed = a.flare * Math.exp(-dt / FLARE_DECAY_S);
  const incoming = finite01(p.flare);
  if (incoming > 0 && a.time - a.lastFlareAt >= FLARE_MIN_INTERVAL_S) {
    a.flare = Math.max(decayed, incoming);
    a.lastFlareAt = a.time;
    a.flaresAccepted++;
    a.flareAngle = (a.flaresAccepted * GOLDEN_ANGLE) % (2 * Math.PI);
  } else {
    if (incoming > 0) a.flaresRejected++;
    a.flare = decayed;
  }
  return a;
}
