import { punchOf } from "../audio/shaping";
import { SCENE_STATES, clamp01, type AudioFeatureFrame, type SceneState } from "../pipeline/contract";

/**
 * Accretion v0: audio features in, visual parameters out. Pure and stateless: the same frame always gives the
 * same parameters, and the frame is never changed.
 *
 * Everything here is an instantaneous reading. Temporal smoothing, phase accumulation, the flare rate limit
 * and anything GPU-related belong to a later stateful layer, not to this function.
 *
 * Every output is a finite number in 0..1. A renderer maps 0..1 onto its own units (scale, speed, colour).
 *
 * The constants are PROPOSED starting values, chosen to give a clear response and a dim resting state. None of
 * them has been checked for perceptual quality; that needs a visual review with real audio.
 */

/** Scene-state levels (PROPOSED). Build heats the disk and draws the camera in; settle relaxes it. */
export const SCENE_LEVEL: Readonly<Record<SceneState, number>> = Object.freeze({
  rest: 0,
  build: 0.6,
  active: 1,
  settle: 0.35,
});

/** The brightness of the central body in silence: dim but not blank (PROPOSED). */
export const REST_GLOW = 0.08;
/** The disk's spin in silence, as a fraction of its loud-passage speed (PROPOSED). */
export const REST_SPIN = 0.15;
/** Motion multiplier in silence (PROPOSED). The scope requires at most 0.3. */
export const CALM_MOTION = 0.25;
/** Motion multiplier under prefers-reduced-motion. Matches Squall's REDUCED_SCALE (0.35). */
export const REDUCED_MOTION = 0.35;
/**
 * Overall energy below this counts as silence. Same value as Squall's SILENCE_RMS, held as a local constant
 * so the Accretion layer does not depend on Squall's module.
 */
export const SILENCE_RMS = 0.04;
/** How much of each band's transient is added to the signal it drives. */
export const PUNCH_HORIZON = 0.3;
export const PUNCH_TURB = 0.45;
export const PUNCH_DETAIL = 0.5;

export interface AccretionParams {
  /** Central-body swell (bass). The renderer scales the body by 1 + k * horizon. */
  horizon: number;
  /** Rim glow of the central body (bass), with a dim floor in silence. */
  rimGlow: number;
  /** Disk rotation speed (mids), gated by motion. */
  diskSpeed: number;
  /** Disk turbulence amplitude (mids), gated by motion. */
  diskTurbulence: number;
  /** Position along the disk colour ramp (mids). Not motion-gated: colour still responds when motion is reduced. */
  diskColour: number;
  /** Fine grain and stellar sparkle (highs), gated by motion. */
  detail: number;
  /** Overall exposure (loudness). */
  exposure: number;
  /** Jet ignition on a bass hit. Zero in silence and under reduced motion. */
  jet: number;
  /** Flare on a detected beat or onset, using onset strength. Zero in silence and under reduced motion. */
  flare: number;
  /** Scene level: rest 0, build 0.6, active 1, settle 0.35. */
  sceneLevel: number;
  /** Multiplier the renderer applies to every motion speed: CALM_MOTION in silence, REDUCED_MOTION if reduced. */
  motion: number;
  /** True when nothing is playing or the signal is near silent. */
  calm: boolean;
}

const unit = (x: number) => clamp01(x);

/**
 * Map one audio frame to Accretion's visual parameters. `reduced` is the prefers-reduced-motion setting.
 * Pure: no state, no clock, no DOM.
 */
export function toAccretionParams(f: AudioFeatureFrame, reduced: boolean): AccretionParams {
  const playing = f.isPlaying === true;
  const bass = unit(f.bass);
  const mid = unit(f.mid);
  const high = unit(f.high);
  const rms = unit(f.rmsEnergy);
  const calm = !playing || rms < SILENCE_RMS;

  // Motion gating: silence and reduced motion both damp movement. Colour and glow are not gated.
  const motion = (calm ? CALM_MOTION : 1) * (reduced ? REDUCED_MOTION : 1);

  // Jets and flares are pulses, so they are removed in silence and under reduced motion.
  const pulses = !calm && !reduced;
  // Per-band transients (see audio/shaping.ts): the ring flares on a kick, the disk surges on a mid hit, its fine detail flickers on a high one.
  const pn = punchOf(f);
  const k = pulses ? 1 : 0;

  const scene = (SCENE_STATES as readonly string[]).includes(f.currentSceneState) ? f.currentSceneState : "rest";

  return {
    horizon: unit(bass + PUNCH_HORIZON * pn.bass * k),
    rimGlow: unit(REST_GLOW + (1 - REST_GLOW) * unit(bass + 0.4 * pn.bass * k)),
    diskSpeed: unit((REST_SPIN + (1 - REST_SPIN) * unit(mid + 0.3 * pn.mid * k)) * motion),
    diskTurbulence: unit((mid + PUNCH_TURB * pn.mid * k) * motion),
    diskColour: mid,
    detail: unit((high + PUNCH_DETAIL * pn.high * k) * motion),
    exposure: rms,
    jet: pulses ? unit(f.bassHit) : 0,
    flare: pulses && f.beatDetected === true ? unit(f.onsetStrength) : 0,
    sceneLevel: SCENE_LEVEL[scene as SceneState],
    motion,
    calm,
  };
}
