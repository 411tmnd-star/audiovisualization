"use client";

import SpectrumMatrixCanvas, { type MatrixDebug } from "@/components/spectrum-matrix/SpectrumMatrixCanvas";
import SceneStage from "@/components/gl/SceneStage";
import type { AudioPipeline } from "@/lib/pipeline";
import { AudioPipelineProvider } from "@/lib/pipeline/react";

/**
 * The Spectrum Matrix experience: one shared audio pipeline, the WebGL scene,, and the shared stage with its controls. The scene reads the pipeline's frames and nothing else.
 */
export default function SpectrumMatrix({ pipeline, debugRef }: { pipeline?: AudioPipeline; debugRef?: { current: MatrixDebug | null } }) {
  return (
    <AudioPipelineProvider pipeline={pipeline}>
      <Shell debugRef={debugRef} />
    </AudioPipelineProvider>
  );
}

function Shell({ debugRef }: { debugRef?: { current: MatrixDebug | null } }) {
  return (
    <SceneStage
      id="spectrum-matrix"
      title="Spectrum Matrix"
      tagline="A terrain of three bands: bass left, mids centre, highs right."
      about="A terrain shaped by bass (left), mids (centre) and highs (right): three bands, not a full spectrum. Bass hits raise a ridge. Silence lets it settle. Drag to orbit."
      hint="Drag to orbit"
      background="#02030a"
    >
      <SpectrumMatrixCanvas debugRef={debugRef} />
    </SceneStage>
  );
}
