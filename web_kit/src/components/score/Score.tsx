"use client";

import { useState } from "react";

import ScoreCanvas, { type ScoreDebug } from "@/components/score/ScoreCanvas";
import SceneStage, { StageSeg } from "@/components/gl/SceneStage";
import type { AudioPipeline } from "@/lib/pipeline";
import { AudioPipelineProvider } from "@/lib/pipeline/react";

/**
 * The Score experience: one shared audio pipeline, the WebGL scene,, and the shared stage with its controls. The scene reads the pipeline's frames and nothing else.
 */
export default function Score({ pipeline, debugRef, decor }: { pipeline?: AudioPipeline; debugRef?: { current: ScoreDebug | null }; decor?: boolean }) {
  return (
    <AudioPipelineProvider pipeline={pipeline}>
      <Shell debugRef={debugRef} decor={decor} />
    </AudioPipelineProvider>
  );
}

function Shell({ debugRef, decor }: { debugRef?: { current: ScoreDebug | null }; decor?: boolean }) {
  const [showDecor, setShowDecor] = useState(decor ?? true);
  return (
    <SceneStage
      id="score"
      title="Score"
      tagline="Music written as it plays, right to left."
      about="The music written as it plays, right to left: bass in amber, mids in cyan, highs in violet. Thin rules mark detected onsets (not a beat grid). Gridlines are one second apart."
      background="#03040a"
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
      <ScoreCanvas debugRef={debugRef} decor={showDecor} />
    </SceneStage>
  );
}
