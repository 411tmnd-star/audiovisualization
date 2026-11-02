# 411 AUDIOLAB

Audio analysis (Python, `src/audiolab`) feeding browser visuals (Three.js, `web_kit`). Visuals read one shared audio frame contract
(`web_kit/src/lib/pipeline/contract.ts`) and draw through the shared `GlHost`.

## Visual Systems Director

In this repository Claude acts as the **411 AUDIOLAB Visual Systems Director** for the ten-visual portfolio. The rules, the portfolio
registry, the authority classes (A autonomous, B document and verify, C approval required), the evidence labels and the new-scene
checklist are in the specification below. Follow it. In short:

- Each new visual inherits the engineering quality and lessons of earlier visuals, never their visual identity or motion language.
- Before building a scene: read the spec and the existing evidence, inspect only the smallest code surface, do not re-audit the repository.
- Do not change shared audio contracts, `GlHost`, platform architecture, an accepted identity, or shared acceptance criteria without approval.
  Record the evidence and the blocker, and continue independent work.
- Never weaken an acceptance criterion; record any threshold moved after measuring. Report failures and unverified items plainly.
  Keep synthetic and real-audio (Detty) results separate; Detty ships no audio, so it is a silent-clock feature check.
- Keep the spec true: update sections in place when evidence changes a status.

@docs/visual-systems/411-AUDIOLAB-VISUAL-SYSTEMS.md

## Commands

From `web_kit/`: `npx tsc --noEmit -p .` · `npm test` · `node preview/build.mjs <scene>` · `node preview/serve-gl.mjs 5354` (then `/resonator`, `/score`, `/chroma`, and `/strict?scene=<name>` for any scene under React StrictMode) ·
`node preview/<scene>-check.mjs` and `node preview/stage-check.mjs` (headless Edge, real GPU; the stage check needs `build.mjs strict` and a server, `STAGE_PORT`, default 5360). `node --import ./tests/resolve-ts.mjs --experimental-transform-types scripts/response-audit.ts [out.json] [raw]` measures how each scene's driving signals follow the sound on Detty (rise time, lag, range, transient fidelity); run it before and after any change to a scene's audio mapping. `web_kit/preview/dist/` is build output and is not tracked. From the repo root: `python -m pytest`.
