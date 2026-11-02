"use client";

import { useState } from "react";

import ResonatorCanvas, { type ResonatorDebug } from "@/components/resonator/ResonatorCanvas";
import SceneStage, { StageSeg } from "@/components/gl/SceneStage";
import type { AudioPipeline } from "@/lib/pipeline";
import { AudioPipelineProvider } from "@/lib/pipeline/react";
import type { ResonatorQuality } from "@/lib/resonator/scene";

/**
 * The Resonator experience: one shared audio pipeline, the WebGL scene, and the same source and transport controls the
 * other visuals use. The scene reads the pipeline's frames and nothing else.
 */
export default function Resonator({ pipeline, debugRef, quality }: { pipeline?: AudioPipeline; debugRef?: { current: ResonatorDebug | null }; quality?: ResonatorQuality }) {
  return (
    <AudioPipelineProvider pipeline={pipeline}>
      <Shell debugRef={debugRef} quality={quality} />
    </AudioPipelineProvider>
  );
}

function Shell({ debugRef, quality }: { debugRef?: { current: ResonatorDebug | null }; quality?: ResonatorQuality }) {
  const [level, setLevel] = useState<ResonatorQuality>(quality ?? "full");
  return (
    <SceneStage
      id="resonator"
      title="Resonator"
      tagline="A glass orb and plasma heart inside concentric fluid ribbons."
      about="Bass pulses the glass orb and its plasma heart, mids lift the inner ribbons, highs ripple the outer ones and speed the beads. Detected onsets flash the gold tracks and burst the particles. Drag to orbit."
      hint="Drag to orbit"
      background="#02030a"
      settings={
        <StageSeg
          name="Quality"
          value={level}
          options={[["full", "Full"], ["lite", "Lite"]]}
          onChange={setLevel}
          hint="Lite draws fewer particles for slower graphics. Changing it restarts the scene."
        />
      }
    >
      <ResonatorCanvas debugRef={debugRef} quality={level} />
    </SceneStage>
  );
}
