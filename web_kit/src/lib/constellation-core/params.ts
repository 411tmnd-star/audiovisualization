import { punchOf } from "../audio/shaping";
import { SCENE_STATES, clamp01, type AudioFeatureFrame, type SceneState } from "../pipeline/contract";

/**
 * Constellation Core: audio features in, visual parameters out. Pure and stateless: the same frame always gives the
 * same parameters, and the frame is never changed. Uses only fields of the existing AudioFeatureFrame.
 *
 * Temporal smoothing, phase accumulation, the pulse rate limit and anything GPU-related belong to the stateful layer
 * (animator.ts), not here. Every output is a finite number in 0..1.
 *
 * Shape and constants are copied from Accretion's params (kept separate on purpose, so neither scene depends on the
 * other). All constants are PROPOSED starting values; none has been checked with real music.
 */

/** Scene-state levels (PROPOSED). Build and active draw the camera in; settle relaxes it. */
export const SCENE_LEVEL: Readonly<Record<SceneState, number>> = Object.freeze({ rest: 0, build: 0.6, active: 1, settle: 0.35 });

/** Brightness of the core and halo in silence: dim but readable (raised from 0.08 in the polish pass). */
export const REST_GLOW = 0.25;
/** Floor of the overall exposure, so the rings, orbs and halo stay legible in silence without losing the moody rest look. */
export const REST_EXPOSURE = 0.2;
/** Orbit speed in silence, as a fraction of the loud-passage speed. */
export const REST_SPIN = 0.15;
/** Motion multiplier in silence. */
export const CALM_MOTION = 0.25;
/** Motion multiplier under prefers-reduced-motion (matches Squall and Accretion). */
export const REDUCED_MOTION = 0.35;
/** Overall energy below this counts as silence. */
export const SILENCE_RMS = 0.04;
/** How much of each band's transient is added to the signal it drives. */
export const PUNCH_SWELL = 0.3;
export const PUNCH_ORBIT = 0.35;
export const PUNCH_SHIMMER = 0.5;

export interface CoreParams {
  /** Core swell (bass). The renderer scales the core by 1 + k * swell. */
  swell: number;
  /** Glow of the core rim and halo (bass), with a dim floor in silence. */
  glow: number;
  /** Orbit speed (mids), gated by motion. */
  orbitSpeed: number;
  /** Position along the blue-to-violet palette (mids). Not motion-gated. */
  colour: number;
  /** Orb shimmer and star twinkle (highs), gated by motion. */
  shimmer: number;
  /** Overall exposure (loudness), with a floor of REST_EXPOSURE. */
  exposure: number;
  /** Beam surge on a bass hit. Zero in silence and under reduced motion. */
  beam: number;
  /** Ring pulse on a detected onset, scaled by onset strength. Zero in silence and under reduced motion. */
  pulse: number;
  /** Scene level: rest 0, build 0.6, active 1, settle 0.35. */
  sceneLevel: number;
  /** Multiplier for every motion speed: CALM_MOTION in silence, REDUCED_MOTION if reduced. */
  motion: number;
  /** True when nothing is playing or the signal is near silent. */
  calm: boolean;
}

const unit = (x: number) => clamp01(x);

/** Map one audio frame to Constellation Core's visual parameters. `reduced` is the prefers-reduced-motion setting. */
export function toCoreParams(f: AudioFeatureFrame, reduced: boolean): CoreParams {
  const playing = f.isPlaying === true;
  const bass = unit(f.bass);
  const mid = unit(f.mid);
  const high = unit(f.high);
  const rms = unit(f.rmsEnergy);
  const calm = !playing || rms < SILENCE_RMS;
  const motion = (calm ? CALM_MOTION : 1) * (reduced ? REDUCED_MOTION : 1);
  // Beam surges and ring pulses are pulses, so they are removed in silence and under reduced motion.
  const pulses = !calm && !reduced;
  // Per-band transients (see audio/shaping.ts): the core snaps on a kick, the orbits surge on a mid hit, the shimmer flickers on a high one.
  const pn = punchOf(f);
  const k = pulses ? 1 : 0;
  const scene = (SCENE_STATES as readonly string[]).includes(f.currentSceneState) ? f.currentSceneState : "rest";
  return {
    swell: unit(bass + PUNCH_SWELL * pn.bass * k),
    glow: unit(REST_GLOW + (1 - REST_GLOW) * bass),
    orbitSpeed: unit((REST_SPIN + (1 - REST_SPIN) * unit(mid + PUNCH_ORBIT * pn.mid * k)) * motion),
    colour: mid,
    shimmer: unit((high + PUNCH_SHIMMER * pn.high * k) * motion),
    exposure: unit(REST_EXPOSURE + (1 - REST_EXPOSURE) * rms),
    beam: pulses ? unit(f.bassHit) : 0,
    pulse: pulses && f.beatDetected === true ? unit(f.onsetStrength) : 0,
    sceneLevel: SCENE_LEVEL[scene as SceneState],
    motion,
    calm,
  };
}
