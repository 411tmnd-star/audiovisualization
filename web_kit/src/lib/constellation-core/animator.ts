import { follow } from "../audio/features";
import type { CoreParams } from "./params";

/**
 * The stateful layer between the pure parameters (params.ts) and the scene.
 *
 * It holds only what the scene needs across frames: smoothed envelopes, the accumulated orbit phase, the camera drift,
 * the beam impulse with its decay, and the ring pulse with its rate limit. `stepCoreAnim` updates one preallocated
 * object in place, so a frame allocates nothing. Deterministic: the same sequence of params and time steps always gives
 * the same state. No clock, no DOM, no GPU.
 *
 * Copied and adapted from Accretion's animator (`jet` is `beam`, `flare` is `pulse`). All constants are PROPOSED.
 */

/** Envelope attack and release (seconds to about 63%). */
export const ATTACK_S = 0.03;
export const RELEASE_S = 0.22;
/** Under reduced motion every envelope rises slowly too, so no change is abrupt. */
export const REDUCED_ATTACK_S = 0.35;
/** Beam impulse decay time constant. */
export const BEAM_DECAY_S = 0.3;
/** Pulse decay time constant. */
export const PULSE_DECAY_S = 0.3;
/** Minimum time between accepted pulses: at most about 2.9 per second, under the 3-per-second limit. */
export const PULSE_MIN_INTERVAL_S = 0.35;
/** The largest time step taken, so a stalled tab or a long frame cannot cause a jump. */
export const MAX_DT_S = 0.05;
/** Angular speed of the innermost orbit at full orbit speed, radians per second. */
export const ORBIT_SPIN = 0.55;
/** Camera drift around the core at full motion, radians per second. */
export const DRIFT_RATE = 0.03;
/** Number of rings a pulse can light, in turn. */
export const RING_COUNT = 3;

export interface CoreAnim {
  /** Animation time in seconds: the sum of the accepted time steps. */
  time: number;
  swell: number;
  glow: number;
  orbitSpeed: number;
  colour: number;
  shimmer: number;
  exposure: number;
  sceneLevel: number;
  motion: number;
  /** Accumulated orbit rotation in radians. Grows without wrapping, so speed changes bend the motion. */
  phase: number;
  /** Accumulated camera drift in radians. */
  drift: number;
  /** Motion-scaled time: drift, beam flow and twinkle advance on this, so reduced motion slows them without a jump. */
  flow: number;
  /** Beam impulse, 0..1, decaying. */
  beam: number;
  /** Pulse intensity, 0..1, decaying. */
  pulse: number;
  /** Which ring the current pulse lights (0..RING_COUNT-1), advancing with every accepted pulse. */
  pulseRing: number;
  /** Time of the last accepted pulse. */
  lastPulseAt: number;
  /** Diagnostics: pulses accepted and pulses refused by the rate limit. */
  pulsesAccepted: number;
  pulsesRejected: number;
}

export function createCoreAnim(): CoreAnim {
  return {
    time: 0, swell: 0, glow: 0, orbitSpeed: 0, colour: 0, shimmer: 0, exposure: 0, sceneLevel: 0, motion: 0.25,
    phase: 0, drift: 0, flow: 0, beam: 0, pulse: 0, pulseRing: 0, lastPulseAt: -Infinity, pulsesAccepted: 0, pulsesRejected: 0,
  };
}

const finite01 = (x: number) => (Number.isFinite(x) ? Math.min(1, Math.max(0, x)) : 0);
/** One envelope step. A module-level function, so a frame creates no closures. */
const env = (prev: number, target: number, dt: number, attack: number) => finite01(follow(prev, finite01(target), dt, attack, RELEASE_S));

/**
 * Advances the animation by `dtS` seconds towards the given parameters and returns the same object.
 * Invalid or negative steps advance nothing; steps longer than MAX_DT_S are shortened.
 */
export function stepCoreAnim(a: CoreAnim, p: CoreParams, dtS: number, reduced: boolean): CoreAnim {
  const dt = Number.isFinite(dtS) && dtS > 0 ? Math.min(dtS, MAX_DT_S) : 0;
  if (dt === 0) return a;
  a.time += dt;

  const att = reduced ? REDUCED_ATTACK_S : ATTACK_S;
  a.swell = env(a.swell, p.swell, dt, att);
  a.glow = env(a.glow, p.glow, dt, att);
  a.orbitSpeed = env(a.orbitSpeed, p.orbitSpeed, dt, att);
  a.colour = env(a.colour, p.colour, dt, att);
  a.shimmer = env(a.shimmer, p.shimmer, dt, att);
  a.exposure = env(a.exposure, p.exposure, dt, att);
  a.sceneLevel = env(a.sceneLevel, p.sceneLevel, dt, att);
  a.motion = env(a.motion, p.motion, dt, att);

  // Motion accumulates from the smoothed speeds, so a sudden change in mids bends the orbit rather than jumping it.
  a.phase += dt * ORBIT_SPIN * a.orbitSpeed;
  a.drift += dt * DRIFT_RATE * a.motion;
  a.flow += dt * a.motion;

  // Beam: an impulse that decays, retriggered by a stronger bass hit. Never above the strongest input.
  a.beam = Math.max(a.beam * Math.exp(-dt / BEAM_DECAY_S), finite01(p.beam));

  // Pulse: rate-limited, then decaying. Each accepted pulse lights the next ring.
  const decayed = a.pulse * Math.exp(-dt / PULSE_DECAY_S);
  const incoming = finite01(p.pulse);
  if (incoming > 0 && a.time - a.lastPulseAt >= PULSE_MIN_INTERVAL_S) {
    a.pulse = Math.max(decayed, incoming);
    a.lastPulseAt = a.time;
    a.pulsesAccepted++;
    a.pulseRing = a.pulsesAccepted % RING_COUNT;
  } else {
    if (incoming > 0) a.pulsesRejected++;
    a.pulse = decayed;
  }
  return a;
}
