import { punchOf } from "../audio/shaping";
import { clamp01, type AudioFeatureFrame } from "../pipeline/contract";

/**
 * Chroma Field: audio features in, field parameters out. Pure and stateless; the frame is never changed.
 *
 * Fields read, all verified in src/lib/pipeline/contract.ts: isPlaying, bass, mid, high, bassHit, rmsEnergy (the contract's
 * overall-loudness field; named `rmsEnergy`, not `rms`), beatDetected, onsetStrength. `time` is not read: Chroma has no history,
 * its motion runs on its own visual clock (animator.ts). Nothing else exists in the contract: no chroma, pitch, key, harmonic or
 * beat-grid data. Colour is assigned per register (frequency band), never per pitch class.
 */

export interface ChromaParams {
  bass: number;
  mid: number;
  high: number;
  /** Punch of a bass note, 0..1: drives the brief compression. */
  hit: number;
  /** Overall loudness, 0..1: exposure only. */
  rms: number;
  /** True on the single frame an onset fired (an onset, not a beat grid). */
  onset: boolean;
  onsetStrength: number;
  playing: boolean;
  /** Reduced motion: slower flow, a fixed camera, no shimmer and no shockwave. */
  reduced: boolean;
}

/** How much of each band's transient is added to the signal it drives (see audio/shaping.ts). Off under reduced motion. */
export const PUNCH_BASS = 0.3;
export const PUNCH_MID = 0.4;
export const PUNCH_HIGH = 0.5;

export function toChromaParams(f: AudioFeatureFrame, reduced: boolean): ChromaParams {
  const pn = punchOf(f);
  const k = reduced || f.isPlaying !== true ? 0 : 1;
  return {
    bass: clamp01(f.bass + PUNCH_BASS * pn.bass * k),
    mid: clamp01(f.mid + PUNCH_MID * pn.mid * k),
    high: clamp01(f.high + PUNCH_HIGH * pn.high * k),
    hit: clamp01(f.bassHit),
    rms: clamp01(f.rmsEnergy),
    onset: f.beatDetected === true,
    onsetStrength: clamp01(f.onsetStrength),
    playing: f.isPlaying === true,
    reduced,
  };
}
