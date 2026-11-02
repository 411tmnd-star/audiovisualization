import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

// Structural checks on the shared scene stage. They read source text (no DOM in the unit tests); the behaviour is covered in a real
// browser by preview/stage-check.mjs.
const SRC = join(dirname(fileURLToPath(import.meta.url)), "..", "src", "components");
const read = (f: string) => readFileSync(join(SRC, f), "utf8");
const SCENES: [string, string][] = [
  ["constellation-core/ConstellationCore.tsx", "constellation-core"],
  ["resonator/Resonator.tsx", "resonator"],
  ["score/Score.tsx", "score"],
  ["chroma/Chroma.tsx", "chroma"],
  ["accretion/Accretion.tsx", "accretion"],
];

describe("every WebGL scene is shown on the shared stage", () => {
  for (const [file, id] of SCENES) {
    it(`${id} uses SceneStage and not its own shell or the old boxed controls`, () => {
      const s = read(file);
      assert.ok(s.includes("<SceneStage"), "renders SceneStage");
      assert.ok(s.includes(`id="${id}"`), "has its id");
      assert.equal(s.includes("pipeline/Controls"), false, "no old SourcePicker/Transport block");
      assert.equal(s.includes("min-h-[85vh]"), false, "no boxed card layout");
    });
  }

  it("scenes whose composition reaches the bottom edge keep the transport strip free of the canvas", () => {
    assert.ok(read("score/Score.tsx").includes("reserveBottom"));
    for (const f of ["constellation-core/ConstellationCore.tsx", "resonator/Resonator.tsx", "chroma/Chroma.tsx", "accretion/Accretion.tsx"]) assert.equal(read(f).includes("reserveBottom"), false, f);
  });

  it("scene settings that rebuild the scene are in the panel for Score, Resonator and Chroma", () => {
    assert.ok(read("score/Score.tsx").includes('name="Overlay"'));
    assert.ok(read("resonator/Resonator.tsx").includes('name="Quality"'));
    assert.ok(read("chroma/Chroma.tsx").includes('name="Quality"'));
  });
});

describe("the stage keeps the hooks the checks and the pipeline rely on", () => {
  const stage = read("gl/SceneStage.tsx");
  it("exposes the selectors the browser checks use", () => {
    for (const a of ["data-play", "data-source=", "data-clock", "data-transport", "data-controls-toggle", "data-rail", "data-empty", "data-stage="]) assert.ok(stage.includes(a), a);
  });
  it("binds Space, the arrow keys, F and Escape, and a drop target", () => {
    for (const k of ['" "', "ArrowLeft", "ArrowRight", '"f"', "Escape", "onDrop"]) assert.ok(stage.includes(k), k);
  });
  it("puts the canvas first in the document order inside the stage (checks read the first canvas)", () => {
    assert.ok(stage.indexOf("{children}") < stage.indexOf("data-transport"));
  });
  it("does not draw or schedule frames itself", () => {
    for (const f of ["requestAnimationFrame(", "setInterval("]) assert.equal(stage.includes(f), false, f);
  });
  it("releases its listeners and timers", () => {
    assert.ok(stage.includes('removeEventListener("keydown"'));
    assert.ok(stage.includes('removeEventListener("fullscreenchange"'));
    assert.ok(stage.includes("clearTimeout(timer)"));
  });
});
