"use client";

import ConstellationCoreCanvas, { type CoreDebug } from "@/components/constellation-core/ConstellationCoreCanvas";
import SceneStage from "@/components/gl/SceneStage";
import type { AudioPipeline } from "@/lib/pipeline";
import { AudioPipelineProvider } from "@/lib/pipeline/react";

/**
 * The Constellation Core experience: one shared audio pipeline, the WebGL scene,, and the shared stage with its controls. The scene reads the pipeline's frames and nothing else.
 */
export default function ConstellationCore({ pipeline, debugRef }: { pipeline?: AudioPipeline; debugRef?: { current: CoreDebug | null } }) {
  return (
    <AudioPipelineProvider pipeline={pipeline}>
      <Shell debugRef={debugRef} />
    </AudioPipelineProvider>
  );
}

function Shell({ debugRef }: { debugRef?: { current: CoreDebug | null } }) {
  return (
    <SceneStage
      id="constellation-core"
      title="Constellation Core"
      tagline="A glowing core, orbiting moons and rings."
      about="Bass swells the core, mids speed the orbits, bass hits surge the beam, detected onsets light the rings in turn. Silence lets it settle. Drag to orbit."
      hint="Drag to orbit"
      background="#02040c"
    >
      <ConstellationCoreCanvas debugRef={debugRef} />
    </SceneStage>
  );
}
