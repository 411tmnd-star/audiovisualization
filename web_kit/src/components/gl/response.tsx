"use client";

import { createContext, useCallback, useContext, useRef } from "react";

import { ResponseShaper, type ShapedFrame } from "@/lib/audio/shaping";
import type { AudioFeatureFrame } from "@/lib/pipeline/contract";
import { useAudioPipeline } from "@/lib/pipeline/react";

/**
 * Whether scenes use the shaped response (auto-gain and punch) or the contract's own levels. The stage owns the setting and shows
 * it in its panel; a scene that is shown without a stage gets the shaped response.
 */
export const ResponseContext = createContext<{ tuned: boolean }>({ tuned: true });

const ZERO = Object.freeze({ bass: 0, mid: 0, high: 0 });

/**
 * Returns `shape(frame, dt)` for one scene instance. The shaper resets when the pipeline's source changes (a new song has a new
 * range). With the response set to raw, the frame passes through unchanged and carries no punch.
 */
export function useResponse(): (f: AudioFeatureFrame, dt: number) => ShapedFrame {
  const { tuned } = useContext(ResponseContext);
  const pipeline = useAudioPipeline();
  const tunedRef = useRef(tuned);
  tunedRef.current = tuned;
  const shaper = useRef<ResponseShaper | null>(null);
  const source = useRef<unknown>(undefined);
  const rawIn = useRef<AudioFeatureFrame | null>(null);
  const rawOut = useRef<ShapedFrame | null>(null);
  return useCallback(
    (f, dt) => {
      if (!tunedRef.current) {
        // Passed through, with no punch. The same input object gives the same output object (consumers key on identity).
        if (f !== rawIn.current || !rawOut.current) {
          rawIn.current = f;
          rawOut.current = { ...f, punch: ZERO };
        }
        return rawOut.current;
      }
      shaper.current ??= new ResponseShaper();
      if (pipeline.source !== source.current) {
        if (source.current !== undefined) shaper.current.reset();
        source.current = pipeline.source;
      }
      return shaper.current.shape(f, dt);
    },
    [pipeline],
  );
}
