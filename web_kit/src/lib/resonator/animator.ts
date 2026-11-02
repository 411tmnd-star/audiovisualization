import { follow } from "../audio/features";
import type { ResonatorParams } from "./params";

/**
 * The stateful layer between the pure parameters (params.ts) and the scene.
 *
 * It holds only what the scene needs across frames: smoothed envelopes, accumulated wave and bead phases, the camera
 * drift, and three decaying impulses (orb kick, track flash, particle burst). `stepResonatorAnim` updates one
 * preallocated object in place, so a frame allocates nothing. Deterministic: the same sequence of params and time steps
 * always gives the same state. No clock, no DOM, no GPU.
 *
 * Phases accumulate from smoothed speeds (rather than time * frequency), so a change in the music bends the motion
 * and never makes it jump. Flashes are rate-limited to the same under-3-per-second budget as the other scenes.
 * All constants are PROPOSED.
 */

/** Envelope attack and release (seconds to about 63%). */
export const ATTACK_S = 0.06;
/** Attack for the ribbons, ripple and beads (the orb, its glow and the scene level keep ATTACK_S). */
export const RIBBON_ATTACK_S = 0.03;
export const RELEASE_S = 0.25;
/** Under reduced motion every envelope rises slowly too, so no change is abrupt. */
export const REDUCED_ATTACK_S = 0.35;
/** Orb kick decay time constant. */
export const KICK_DECAY_S = 0.18;
/** Track-flash decay time constant. */
export const FLASH_DECAY_S = 0.28;
/** Particle-burst decay time constant (slower: the particles drift back). */
export const BURST_DECAY_S = 0.9;
/** Minimum time between accepted onset flashes: at most about 2.9 per second, under the 3-per-second limit. */
export const FLASH_MIN_INTERVAL_S = 0.35;
/** The largest time step taken, so a stalled tab or a long frame cannot cause a jump. */
export const MAX_DT_S = 0.05;
/** Ribbon wave travel speeds at full level, radians per second. */
export const MID_WAVE_RATE = 0.9;
export const HIGH_WAVE_RATE = 2.4;
/** Idle wave travel in silence, as a multiple of the motion factor, so the water is never frozen. */
export const IDLE_WAVE_RATE = 0.35;
/** Bead orbit speed at full level, radians per second. */
export const BEAD_ORBIT_RATE = 0.5;
/** Bead pulse phase speed at full level, radians per second. */
export const BEAD_PULSE_RATE = 5.0;
/** Camera drift around the heart at full motion, radians per second. */
export const DRIFT_RATE = 0.025;

export interface ResonatorAnim {
  /** Animation time in seconds: the sum of the accepted time steps. */
  time: number;
  swell: number;
  glow: number;
  rise: number;
  radial: number;
  ripple: number;
  rippleRate: number;
  beadSpeed: number;
  exposure: number;
  atmosphere: number;
  bloom: number;
  sceneLevel: number;
  motion: number;
  /** Accumulated mid-wave and high-ripple phases, radians. Grow without wrapping. */
  phaseMid: number;
  phaseHigh: number;
  /** Accumulated bead orbit angle and bead pulse phase, radians. */
  beadPhase: number;
  beadPulse: number;
  /** Accumulated camera drift, radians. */
  drift: number;
  /** Motion-scaled time: particle drift and twinkle advance on this. */
  flow: number;
  /** Orb kick, 0..1, decaying. */
  kick: number;
  /** Gold-track flash, 0..1, decaying. */
  flash: number;
  /** Particle burst, 0..1, decaying. */
  burst: number;
  /** Time of the last accepted onset. */
  lastFlashAt: number;
  /** Diagnostics: onsets accepted and refused by the rate limit. */
  flashesAccepted: number;
  flashesRejected: number;
}

export function createResonatorAnim(): ResonatorAnim {
  return {
    time: 0, swell: 0, glow: 0, rise: 0, radial: 0, ripple: 0, rippleRate: 0, beadSpeed: 0, exposure: 0, atmosphere: 0, bloom: 0, sceneLevel: 0, motion: 0.25,
    phaseMid: 0, phaseHigh: 0, beadPhase: 0, beadPulse: 0, drift: 0, flow: 0, kick: 0, flash: 0, burst: 0, lastFlashAt: -Infinity, flashesAccepted: 0, flashesRejected: 0,
  };
}

const finite01 = (x: number) => (Number.isFinite(x) ? Math.min(1, Math.max(0, x)) : 0);
/** One envelope step. A module-level function, so a frame creates no closures. */
const env = (prev: number, target: number, dt: number, attack: number) => finite01(follow(prev, finite01(target), dt, attack, RELEASE_S));

/**
 * Advances the animation by `dtS` seconds towards the given parameters and returns the same object.
 * Invalid or negative steps advance nothing; steps longer than MAX_DT_S are shortened.
 */
export function stepResonatorAnim(a: ResonatorAnim, p: ResonatorParams, dtS: number, reduced: boolean): ResonatorAnim {
  const dt = Number.isFinite(dtS) && dtS > 0 ? Math.min(dtS, MAX_DT_S) : 0;
  if (dt === 0) return a;
  a.time += dt;

  const att = reduced ? REDUCED_ATTACK_S : ATTACK_S;
  const fast = reduced ? REDUCED_ATTACK_S : RIBBON_ATTACK_S;
  // The orb keeps a fluid rise (its criteria: no one-frame jump over 0.25, a restrained swell); the ribbons and beads respond faster.
  a.swell = env(a.swell, p.swell, dt, att);
  a.glow = env(a.glow, p.glow, dt, att);
  a.rise = env(a.rise, p.rise, dt, fast);
  a.radial = env(a.radial, p.radial, dt, fast);
  a.ripple = env(a.ripple, p.ripple, dt, fast);
  a.rippleRate = env(a.rippleRate, p.rippleRate, dt, fast);
  a.beadSpeed = env(a.beadSpeed, p.beadSpeed, dt, fast);
  a.exposure = env(a.exposure, p.exposure, dt, att);
  a.atmosphere = env(a.atmosphere, p.atmosphere, dt, att);
  a.bloom = env(a.bloom, p.bloom, dt, att);
  a.sceneLevel = env(a.sceneLevel, p.sceneLevel, dt, att);
  a.motion = env(a.motion, p.motion, dt, att);

  // Waves travel from the smoothed levels plus a small idle rate, so a sudden change bends the motion rather than jumping it.
  a.phaseMid += dt * (IDLE_WAVE_RATE * a.motion + MID_WAVE_RATE * a.rise * a.motion);
  a.phaseHigh += dt * (IDLE_WAVE_RATE * a.motion + HIGH_WAVE_RATE * a.rippleRate);
  a.beadPhase += dt * BEAD_ORBIT_RATE * a.beadSpeed;
  a.beadPulse += dt * BEAD_PULSE_RATE * a.beadSpeed;
  a.drift += dt * DRIFT_RATE * a.motion;
  a.flow += dt * a.motion;

  // Kick: an impulse that decays, retriggered by a stronger bass hit. Never above the strongest input.
  a.kick = Math.max(a.kick * Math.exp(-dt / KICK_DECAY_S), finite01(p.kick));

  // Flash and burst: decay, then an onset is accepted only if the rate limit allows it.
  const flashDecayed = a.flash * Math.exp(-dt / FLASH_DECAY_S);
  const burstDecayed = a.burst * Math.exp(-dt / BURST_DECAY_S);
  const incoming = finite01(p.flash);
  if (incoming > 0 && a.time - a.lastFlashAt >= FLASH_MIN_INTERVAL_S) {
    a.flash = Math.max(flashDecayed, incoming);
    a.burst = Math.max(burstDecayed, finite01(p.burst));
    a.lastFlashAt = a.time;
    a.flashesAccepted++;
  } else {
    if (incoming > 0) a.flashesRejected++;
    a.flash = flashDecayed;
    a.burst = burstDecayed;
  }
  return a;
}
