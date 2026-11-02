import { follow } from "../audio/features";
import { BURST_LIFE_S, BURST_SLOTS, burstOrigin } from "./field";
import type { ChromaParams } from "./params";

/**
 * The stateful layer between the frame and the scene. Chroma has no history; everything it needs to remember lives here:
 *  - `clock`, the visual clock: advances by dt only while playing (so pausing freezes the field exactly) and drives the camera;
 *  - `flow` and `heading`, the accumulated flow phase: the mid band sets its speed and its drift direction turns with it;
 *  - `huePhase` (slow colour drift, quickened by loudness) and `shimmer` (phase of the fine twinkle, quickened by the high band);
 *  - smoothed band envelopes (bass, mid, high), the bass-hit envelope and the exposure;
 *  - a bounded ring of recent onsets: the clock time, a deterministic origin and the strength of each, for the shockwave.
 * Onsets are edge-detected here (false to true records one; a held flag records none, so a frame delivered twice cannot double an
 * onset); nothing is recorded while not playing. Envelopes keep easing while paused (the field calms); the clock, flow, hue,
 * shimmer and bursts hold still.
 *
 * `stepChromaAnim` updates one preallocated object in place: a frame allocates nothing. Deterministic: no wall clock, no DOM, no GPU.
 */

export const MAX_DT_S = 0.05;
/** Speed of the flow phase per second: a resting drift plus the part the mid band adds. */
export const FLOW_BASE = 0.07;
export const FLOW_MID = 0.65;
export const HUE_RATE = 0.004;
export const SHIMMER_RATE = 6;
/** Reduced motion scales the flow and removes the rest of the fast motion. */
export const REDUCED_FLOW = 0.25;

export interface ChromaAnim {
  clock: number;
  flow: [number, number, number];
  heading: number;
  huePhase: number;
  shimmer: number;
  bass: number;
  mid: number;
  high: number;
  hit: number;
  /** Exposure, 0.55..1, from loudness. */
  exposure: number;
  /** Onset ring: clock time at the onset (-1e9 when empty), strength, origin xyz. */
  burstT: Float64Array;
  burstS: Float32Array;
  burstO: Float32Array;
  /** Bursts held (at most BURST_SLOTS), and the next slot to write. */
  bursts: number;
  burstHead: number;
  /** Onsets recorded since the last reset. */
  onsets: number;
  beatWas: boolean;
  /** Diagnostics. */
  stats: { steps: number; resets: number };
}

export function createChromaAnim(): ChromaAnim {
  return {
    clock: 0, flow: [0, 0, 0], heading: 0, huePhase: 0, shimmer: 0, bass: 0, mid: 0, high: 0, hit: 0, exposure: 0.55,
    burstT: new Float64Array(BURST_SLOTS).fill(-1e9), burstS: new Float32Array(BURST_SLOTS), burstO: new Float32Array(BURST_SLOTS * 3),
    bursts: 0, burstHead: 0, onsets: 0, beatWas: false, stats: { steps: 0, resets: 0 },
  };
}

/** A new source is a different timeline: forget the onsets and envelopes. The visual clock keeps running so the camera does not jump. */
export function resetChromaAnim(a: ChromaAnim): void {
  a.burstT.fill(-1e9);
  a.burstS.fill(0);
  a.bursts = 0;
  a.burstHead = 0;
  a.onsets = 0;
  a.beatWas = false;
  a.bass = a.mid = a.high = a.hit = 0;
  a.exposure = 0.55;
  a.stats.resets++;
}

const finite = (x: number) => (Number.isFinite(x) ? x : 0);
const org: [number, number, number] = [0, 0, 0];

/** Advance by `dtS` seconds towards the parameters. Returns the same object. Non-positive or invalid steps advance nothing. */
export function stepChromaAnim(a: ChromaAnim, p: ChromaParams, dtS: number): ChromaAnim {
  const dt = Number.isFinite(dtS) && dtS > 0 ? Math.min(dtS, MAX_DT_S) : 0;
  a.stats.steps++;

  // Onsets: rising edge on every frame, only while playing.
  const rising = p.onset && !a.beatWas;
  a.beatWas = p.onset;
  if (rising && p.playing) {
    burstOrigin(a.onsets, org);
    const k = a.burstHead;
    a.burstT[k] = a.clock;
    a.burstS[k] = p.onsetStrength;
    a.burstO[k * 3] = org[0]; a.burstO[k * 3 + 1] = org[1]; a.burstO[k * 3 + 2] = org[2];
    a.burstHead = (k + 1) % BURST_SLOTS;
    if (a.bursts < BURST_SLOTS) a.bursts++;
    a.onsets++;
  }

  if (dt > 0) {
    // Envelopes: fast attack, slower release; the high band is the quickest.
    a.bass = finite(follow(a.bass, p.bass, dt, 0.03, 0.25));
    a.mid = finite(follow(a.mid, p.mid, dt, 0.05, 0.25));
    a.high = finite(follow(a.high, p.high, dt, 0.02, 0.15));
    a.hit = finite(follow(a.hit, p.hit, dt, 0.02, 0.2));
    a.exposure = finite(follow(a.exposure, 0.55 + 0.45 * p.rms, dt, 0.15, 0.7));

    if (p.playing) {
      const k = p.reduced ? REDUCED_FLOW : 1;
      const speed = (FLOW_BASE + FLOW_MID * a.mid) * k;
      a.heading += dt * (0.12 + 0.5 * a.mid) * k;
      // The flow phase advances along a heading that turns with the mid band: drift direction is not a straight line.
      a.flow[0] += Math.cos(a.heading) * speed * dt;
      a.flow[1] += (0.4 + 0.3 * Math.sin(a.heading * 0.7)) * speed * dt;
      a.flow[2] += Math.sin(a.heading) * speed * dt;
      a.huePhase += dt * (HUE_RATE + 0.01 * a.exposure) * k;
      a.shimmer += dt * SHIMMER_RATE * (0.3 + a.high);
      a.clock += dt;
    }
  }
  return a;
}

/** Age of burst slot `k` on the visual clock, or -1 if the slot is empty or expired. */
export function burstAge(a: ChromaAnim, k: number): number {
  const age = a.clock - a.burstT[k];
  return a.burstT[k] > -1e8 && age >= 0 && age <= BURST_LIFE_S ? age : -1;
}
