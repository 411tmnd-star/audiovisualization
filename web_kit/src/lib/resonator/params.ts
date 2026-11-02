import { punchOf } from "../audio/shaping";
import { SCENE_STATES, clamp01, type AudioFeatureFrame, type SceneState } from "../pipeline/contract";

/**
 * Resonator: audio features in, visual parameters out. Pure and stateless: the same frame always gives the same
 * parameters, and the frame is never changed. Uses only fields that exist on AudioFeatureFrame (bass, mid, high,
 * rmsEnergy, onsetStrength, beatDetected, bassHit, currentSceneState, isPlaying). There is no sub-bass or low-mid
 * channel in the contract: `bass` already includes the sub (20-150 Hz) and `mid` (150-2000 Hz) already contains the
 * low-mids, so those two bands drive the orb and the ribbons respectively.
 *
 * `beatDetected` is a detected ONSET (adaptive spectral-flux threshold, 120 ms refractory), not a beat-grid beat, and
 * is used as one: it drives track flashes and particle bursts, never a tempo.
 *
 * Smoothing, phase accumulation, the flash rate limit and anything GPU-related belong to the stateful layer
 * (animator.ts). Every output is a finite number in 0..1. All constants are PROPOSED starting values, to be tuned by eye
 * and by ear.
 */

/** Scene-state levels (PROPOSED), the same meaning as the other scenes: build and active draw the camera in. */
export const SCENE_LEVEL: Readonly<Record<SceneState, number>> = Object.freeze({ rest: 0, build: 0.6, active: 1, settle: 0.35 });

/** Brightness of the plasma core in silence: dim but readable. */
export const REST_GLOW = 0.3;
/** Floor of the overall exposure, so the ribbons and tracks stay legible in silence. */
export const REST_EXPOSURE = 0.28;
/** Atmosphere (particles, haze) in silence. */
export const REST_ATMOSPHERE = 0.25;
/** Bead orbit speed in silence, as a fraction of the loud-passage speed. */
export const REST_BEAD_SPEED = 0.2;
/** Motion multiplier in silence. */
export const CALM_MOTION = 0.25;
/** Motion multiplier under prefers-reduced-motion (matches the other scenes). */
export const REDUCED_MOTION = 0.35;
/** Overall energy below this counts as silence. */
export const SILENCE_RMS = 0.04;
/** How much of each band's transient is added to the signal it drives. */
export const PUNCH_KICK = 0.9;
export const PUNCH_RISE = 0.4;
export const PUNCH_RIPPLE = 0.5;

export interface ResonatorParams {
  /** Orb scale pulse (bass). The scene scales the glass orb by 1 + k * swell. */
  swell: number;
  /** Plasma core intensity and warm-light strength (bass), with a dim floor in silence. */
  glow: number;
  /** Inner ribbon height (mid). */
  rise: number;
  /** Radial amplitude modulation of the ribbons (mid). */
  radial: number;
  /** Outer ripple amplitude (high), gated by motion. */
  ripple: number;
  /** Outer ripple frequency and travel speed (high), gated by motion. */
  rippleRate: number;
  /** Bead orbital speed and pulse speed (high), gated by motion. */
  beadSpeed: number;
  /** Overall exposure (loudness), with a floor of REST_EXPOSURE. */
  exposure: number;
  /** Atmospheric intensity: particle brightness and haze (loudness), with a floor. */
  atmosphere: number;
  /** In-scene bloom strength (loudness). Louder passages lower the bloom threshold, so more of the scene glows. */
  bloom: number;
  /** Sharp orb kick on a bass hit (`bassHit`). Zero in silence and under reduced motion. */
  kick: number;
  /** Gold-track flash on a detected onset, scaled by onset strength. Zero in silence and under reduced motion. */
  flash: number;
  /** Particle burst on a detected onset, scaled by onset strength. Zero in silence and under reduced motion. */
  burst: number;
  /** Scene level: rest 0, build 0.6, active 1, settle 0.35. */
  sceneLevel: number;
  /** Multiplier for every motion speed: CALM_MOTION in silence, REDUCED_MOTION if reduced. */
  motion: number;
  /** True when nothing is playing or the signal is near silent. */
  calm: boolean;
}

const unit = (x: number) => clamp01(x);

/** Map one audio frame to Resonator's visual parameters. `reduced` is the prefers-reduced-motion setting. */
export function toResonatorParams(f: AudioFeatureFrame, reduced: boolean): ResonatorParams {
  const playing = f.isPlaying === true;
  const bass = unit(f.bass);
  const mid = unit(f.mid);
  const high = unit(f.high);
  const rms = unit(f.rmsEnergy);
  const calm = !playing || rms < SILENCE_RMS;
  const motion = (calm ? CALM_MOTION : 1) * (reduced ? REDUCED_MOTION : 1);
  // Kicks, flashes and bursts are impulses, so they are removed in silence and under reduced motion.
  const impulses = !calm && !reduced;
  // Per-band transients (see audio/shaping.ts): the orb kicks on a bass hit, the inner ribbons lift on a mid hit, the outer ripple and beads spike on a high one.
  const pn = punchOf(f);
  const k = impulses ? 1 : 0;
  const onset = impulses && f.beatDetected === true ? unit(f.onsetStrength) : 0;
  const scene = (SCENE_STATES as readonly string[]).includes(f.currentSceneState) ? f.currentSceneState : "rest";
  return {
    swell: bass,
    glow: unit(REST_GLOW + (1 - REST_GLOW) * bass),
    rise: unit(mid + PUNCH_RISE * pn.mid * k),
    radial: unit(mid + PUNCH_RISE * 0.6 * pn.mid * k),
    ripple: unit((high + PUNCH_RIPPLE * pn.high * k) * motion),
    rippleRate: unit((high + PUNCH_RIPPLE * 0.6 * pn.high * k) * motion),
    beadSpeed: unit((REST_BEAD_SPEED + (1 - REST_BEAD_SPEED) * unit(high + 0.5 * pn.high * k)) * motion),
    exposure: unit(REST_EXPOSURE + (1 - REST_EXPOSURE) * rms),
    atmosphere: unit(REST_ATMOSPHERE + (1 - REST_ATMOSPHERE) * rms),
    bloom: rms,
    // A bass hit strikes the orb through the instant kick channel (bassHit, or the bass transient when bassHit is quiet); the level path stays fluid.
    kick: impulses ? unit(Math.max(f.bassHit, PUNCH_KICK * pn.bass)) : 0,
    flash: onset,
    burst: onset,
    sceneLevel: SCENE_LEVEL[scene as SceneState],
    motion,
    calm,
  };
}
