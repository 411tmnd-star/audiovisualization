"use client";

import AccretionCanvas, { type AccretionDebug } from "@/components/accretion/AccretionCanvas";
import SceneStage from "@/components/gl/SceneStage";
import type { AudioPipeline } from "@/lib/pipeline";
import { AudioPipelineProvider } from "@/lib/pipeline/react";

/**
 * The Accretion experience: one shared audio pipeline, the WebGL scene, and the same source and transport controls
 * the Constellation instrument uses. The scene reads the pipeline's frames and nothing else.
 */
export default function Accretion({ pipeline, debugRef }: { pipeline?: AudioPipeline; debugRef?: { current: AccretionDebug | null } }) {
  return (
    <AudioPipelineProvider pipeline={pipeline}>
      <Shell debugRef={debugRef} />
    </AudioPipelineProvider>
  );
}

function Shell({ debugRef }: { debugRef?: { current: AccretionDebug | null } }) {
  return (
    <SceneStage
      id="accretion"
      title="Accretion"
      tagline="A black hole seen from the side; the disk turns with the music."
      about="Bass brightens the ring around the dark centre, mids turn the disk, bass hits fire the jets. Silence lets it settle. Drag to orbit."
      hint="Drag to orbit"
      background="#020308"
    >
      <AccretionCanvas debugRef={debugRef} />
    </SceneStage>
  );
}
