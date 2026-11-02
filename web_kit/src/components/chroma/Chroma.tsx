"use client";

import { useState } from "react";

import ChromaCanvas, { type ChromaDebug } from "@/components/chroma/ChromaCanvas";
import SceneStage, { StageSeg } from "@/components/gl/SceneStage";
import type { Quality } from "@/lib/chroma/field";
import type { AudioPipeline } from "@/lib/pipeline";
import { AudioPipelineProvider } from "@/lib/pipeline/react";

/**
 * The Chroma Field experience: one shared audio pipeline, the WebGL scene,, and the shared stage with its controls. The scene reads the pipeline's frames and nothing else.
 */
export default function Chroma({ pipeline, debugRef, quality }: { pipeline?: AudioPipeline; debugRef?: { current: ChromaDebug | null }; quality?: Quality }) {
  return (
    <AudioPipelineProvider pipeline={pipeline}>
      <Shell debugRef={debugRef} quality={quality} />
    </AudioPipelineProvider>
  );
}

function Shell({ debugRef, quality }: { debugRef?: { current: ChromaDebug | null }; quality?: Quality }) {
  const [level, setLevel] = useState<Quality>(quality ?? "full");
  return (
    <SceneStage
      id="chroma"
      title="Chroma Field"
      tagline="Music as a drifting volume of colour."
      about="Music as a drifting volume of colour. Bass swells the cloud in indigo and magenta, mids swirl teal filaments through it, highs add pink sparkle, and each detected onset (not a beat grid) sends a dispersion burst through the field."
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
      <ChromaCanvas debugRef={debugRef} quality={level} />
    </SceneStage>
  );
}
