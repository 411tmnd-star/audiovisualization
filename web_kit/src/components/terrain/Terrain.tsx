"use client";

import { useState } from "react";

import TerrainCanvas, { type TerrainDebug } from "@/components/terrain/TerrainCanvas";
import SceneStage, { StageSeg } from "@/components/gl/SceneStage";
import type { AudioPipeline } from "@/lib/pipeline";
import { AudioPipelineProvider } from "@/lib/pipeline/react";

/**
 * The Terrain with Memory experience: one shared audio pipeline, the WebGL scene,, and the shared stage with its controls. The scene reads the pipeline's frames and nothing else.
 */
export default function Terrain({ pipeline, debugRef, decor }: { pipeline?: AudioPipeline; debugRef?: { current: TerrainDebug | null }; decor?: boolean }) {
  return (
    <AudioPipelineProvider pipeline={pipeline}>
      <Shell debugRef={debugRef} decor={decor} />
    </AudioPipelineProvider>
  );
}

function Shell({ debugRef, decor }: { debugRef?: { current: TerrainDebug | null }; decor?: boolean }) {
  const [showDecor, setShowDecor] = useState(decor ?? true);
  return (
    <SceneStage
      id="terrain"
      title="Terrain with Memory"
      tagline="The music becomes land, and the land keeps what was played."
      about="The music becomes land. Bass raises broad amber ridges, mids roll cyan valleys, highs add fine violet crests. New relief appears at the near edge and recedes, so the landscape keeps what was played. A ripple marks each detected onset (not a beat grid)."
      background="#04060b"
      reserveBottom
      settings={
        <StageSeg
          name="Overlay"
          value={showDecor ? "on" : "off"}
          options={[["on", "On"], ["off", "Off"]]}
          onChange={(v) => setShowDecor(v === "on")}
          hint="Grid, plates and accents. Off shows the signal alone. Changing it restarts the scene."
        />
      }
    >
      <TerrainCanvas debugRef={debugRef} decor={showDecor} />
    </SceneStage>
  );
}
