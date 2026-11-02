import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import Accretion from "@/components/accretion/Accretion";
import Chroma from "@/components/chroma/Chroma";
import ConstellationCore from "@/components/constellation-core/ConstellationCore";
import Resonator from "@/components/resonator/Resonator";
import Score from "@/components/score/Score";
import SpectrumMatrix from "@/components/spectrum-matrix/SpectrumMatrix";
import Terrain from "@/components/terrain/Terrain";

// Mounts one real scene component exactly as a Next page does: no props (so no supplied pipeline) and inside React.StrictMode, which
// in development tears each effect down and runs it again at once on the same DOM node. This is the mount condition the other
// harnesses never exercised. Query: ?scene=core|matrix|resonator|score|terrain|chroma|accretion
const scenes = { core: ConstellationCore, matrix: SpectrumMatrix, resonator: Resonator, score: Score, terrain: Terrain, chroma: Chroma, accretion: Accretion };
const name = (new URLSearchParams(location.search).get("scene") ?? "score") as keyof typeof scenes;
const Scene = scenes[name] ?? Score;

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <div className="mx-auto max-w-7xl px-4 py-4">
      <Scene />
    </div>
  </StrictMode>,
);
