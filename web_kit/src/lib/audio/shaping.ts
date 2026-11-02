import { clamp01, type AudioFeatureFrame } from "../pipeline/contract";

/**
 * Response shaping: what a scene needs between the audio contract and its visuals so that it moves with the sound.
 *
 * The contract gives three smoothed band levels in 0..1. Two properties of real music make them weak drivers on their own:
 *   1. A band occupies a narrow slice of its range. On the project's Detty analysis the mid band spans about 0.19 of 0..1, so a
 *      visual mapped linearly from it barely moves. Fix: AUTO-GAIN. Each band tracks its recent floor and ceiling and is expanded to
 *      use the full range (the "AGC" used by visualizers that stay lively on quiet and loud songs).
 *   2. A level cannot say "something just hit". Only bass (`bassHit`) and one global onset flag carry a transient. Fix: PUNCH, a
 *      per-band transient: the positive rate of change of the band, normalised against that band's own recent peaks, rising at once
 *      and decaying in about 120 ms. Percussive visuals read punch; sustained visuals read the level.
 *
 * Silence is preserved: the floor never goes below 0, the expansion is bounded (SPAN_MIN), and a band that is not playing is passed
 * through. The shaper is scene-agnostic and has no say in what a scene does with the numbers. It changes no contract field in
 * place: it returns a new frame with the same shape plus `punch`. Pure state machine: no DOM, no clock; the caller supplies dt.
 */

export interface Punch {
  readonly bass: number;
  readonly mid: number;
  readonly high: number;
}
export interface ShapedFrame extends AudioFeatureFrame {
  readonly punch: Punch;
}
const NO_PUNCH: Punch = Object.freeze({ bass: 0, mid: 0, high: 0 });

/** The punch of a frame, or zeros for a frame that was not shaped (so params can read it unconditionally). */
export const punchOf = (f: AudioFeatureFrame): Punch => (f as Partial<ShapedFrame>).punch ?? NO_PUNCH;

/** The narrowest range (in contract units) a band is expanded from. Bounds the gain at 1 / SPAN_MIN. */
export const SPAN_MIN = 0.22;
/** The observed range (ceiling minus floor) at which the expansion is fully applied; below it, it is scaled down in proportion. */
export const CONFIDENCE_RANGE = 0.11;
/** How much of the expansion is applied (1 = fully normalised, 0 = the contract's own level). */
export const STRENGTH = 0.85;
/** Ceiling follower: rises with this time constant, falls slowly (seconds). */
export const CEIL_ATTACK_S = 0.15;
export const CEIL_RELEASE_S = 7;
/** Floor follower: falls at once, rises slowly. */
export const FLOOR_FALL_S = 0.15;
export const FLOOR_RISE_S = 14;
/** The transient detector's own smoothing of the band before differentiating (seconds). */
export const RISE_SMOOTH_S = 0.012;
/** The rate-of-rise peak follower: rises fast, forgets slowly. Floor keeps noise from reading as hits (units per second). */
export const PEAK_ATTACK_S = 0.05;
export const PEAK_RELEASE_S = 5;
export const PEAK_MIN = 0.9;
/** Punch decays with this time constant (seconds). A hit appears in the same frame its rise is seen. */
export const PUNCH_DECAY_S = 0.12;
/** The range followers adapt faster for the first WARMUP_S seconds of playing, so a song is expanded from its first bars. */
export const WARMUP_S = 8;
/** The longest step the shaper accepts; a longer gap (tab in background) is treated as one step of this length. */
export const MAX_DT_S = 0.1;

const rate = (dt: number, tau: number) => 1 - Math.exp(-dt / tau);
const finite = (x: number) => (Number.isFinite(x) ? x : 0);

/** One band's range tracker and transient detector. */
export class BandShaper {
  floor = 0;
  ceil = 0.5;
  private smooth = 0;
  private prevSmooth = 0;
  private peak = PEAK_MIN;
  punch = 0;
  private primed = false;
  private age = 0;

  reset(): void {
    this.floor = 0;
    this.ceil = 0.5;
    this.smooth = 0;
    this.prevSmooth = 0;
    this.peak = PEAK_MIN;
    this.punch = 0;
    this.primed = false;
    this.age = 0;
  }

  /** Advance by dt seconds with the band's contract level x; returns the shaped level. `punch` holds the transient. */
  step(x: number, dt: number, playing: boolean): number {
    x = clamp01(finite(x));
    dt = Math.min(MAX_DT_S, Math.max(0, finite(dt)));
    if (!playing || dt === 0) {
      // Adaptation is frozen while nothing plays (a pause must not widen the range); the transient fades out.
      this.punch *= Math.exp(-dt / PUNCH_DECAY_S);
      return x;
    }
    if (!this.primed) {
      // Start with no assumed range: until the band has varied, it is shown as it is.
      this.smooth = this.prevSmooth = x;
      this.ceil = x;
      this.floor = x;
      this.primed = true;
    }
    // Range: the ceiling follows peaks up quickly and down slowly, the floor follows troughs down quickly and up slowly.
    this.age += dt;
    const slow = 0.2 + 0.8 * Math.min(1, this.age / WARMUP_S);
    this.ceil += (x - this.ceil) * rate(dt, x > this.ceil ? CEIL_ATTACK_S : CEIL_RELEASE_S * slow);
    this.floor += (x - this.floor) * rate(dt, x < this.floor ? FLOOR_FALL_S : FLOOR_RISE_S * slow);
    if (this.floor > this.ceil) this.floor = this.ceil;
    const lo = Math.max(0, Math.min(this.floor, this.ceil - SPAN_MIN));
    const span = Math.max(this.ceil - lo, SPAN_MIN);
    const norm = clamp01((x - lo) / span);
    // The expansion is scaled by how much the band has actually varied: a constant signal has no range to stretch and is shown as it is,
    // and low-level noise (a tiny observed range) is barely amplified.
    const confidence = clamp01((this.ceil - this.floor) / CONFIDENCE_RANGE);
    const level = x + (norm - x) * STRENGTH * confidence;

    // Transient: the positive rate of change of a lightly smoothed band, against this band's own recent peak rate.
    this.prevSmooth = this.smooth;
    this.smooth += (x - this.smooth) * rate(dt, RISE_SMOOTH_S);
    const rise = Math.max(0, (this.smooth - this.prevSmooth) / dt);
    this.peak += (rise - this.peak) * rate(dt, rise > this.peak ? PEAK_ATTACK_S : PEAK_RELEASE_S);
    if (this.peak < PEAK_MIN) this.peak = PEAK_MIN;
    const hit = clamp01((rise / this.peak - 0.25) / 0.55);
    this.punch = Math.max(this.punch * Math.exp(-dt / PUNCH_DECAY_S), hit);
    return level;
  }
}

/** The three bands together. One per scene instance. */
export class ResponseShaper {
  readonly bass = new BandShaper();
  readonly mid = new BandShaper();
  readonly high = new BandShaper();
  private lastIn: AudioFeatureFrame | null = null;
  private lastOut: ShapedFrame | null = null;

  reset(): void {
    this.bass.reset();
    this.mid.reset();
    this.high.reset();
    this.lastIn = null;
    this.lastOut = null;
  }

  /**
   * Shapes one frame. The same input object returns the same output object without advancing (the pipeline re-delivers a frame
   * while idle, and consumers such as Score key on object identity). A new frame always yields a new object.
   */
  shape(f: AudioFeatureFrame, dt: number): ShapedFrame {
    if (f === this.lastIn && this.lastOut) return this.lastOut;
    const playing = f.isPlaying === true;
    const bass = this.bass.step(f.bass, dt, playing);
    const mid = this.mid.step(f.mid, dt, playing);
    const high = this.high.step(f.high, dt, playing);
    const out: ShapedFrame = {
      time: f.time,
      progress: f.progress,
      isPlaying: f.isPlaying,
      bass,
      mid,
      high,
      rmsEnergy: f.rmsEnergy,
      onsetStrength: f.onsetStrength,
      beatDetected: f.beatDetected,
      currentSceneState: f.currentSceneState,
      bassHit: f.bassHit,
      punch: { bass: this.bass.punch, mid: this.mid.punch, high: this.high.punch },
    };
    this.lastIn = f;
    this.lastOut = out;
    return out;
  }
}
