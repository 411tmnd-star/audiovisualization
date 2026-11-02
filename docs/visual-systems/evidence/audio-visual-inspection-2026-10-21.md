# 411 AUDIOLAB: audio and visual capability inspection (2026-10-21)

Inspection only. Nothing in the repository was modified except this file. No software was installed or removed, no render or
artifact was regenerated, no browser check was run.

Evidence labels: **TESTED** (a test or check passed in this session), **MEASURED** (I computed it from a recorded artifact in this
session), **READ** (read in code, not exercised), **DOCUMENTED** (claimed by a repo document, not re-run), **NOT FOUND**.

## 0. Repository state

| Item | Value |
|---|---|
| Path | `C:\Users\USER\Desktop\Projects\audio_lab` |
| Branch / commit | `experiment/c4-terrain-memory` at `249a8b8` ("Add MIT license"), same commit as `main` |
| Working tree | Tracked files clean. Untracked: `designs/spectrum-matrix/evidence/`, `scripts/analyze_track.py`, `apply_fx.py`, `make_ab_clips.py`, `verify_fx.py`, `youtube_audio.py`, `web_kit/preview/c4/` |
| Python tests | `python -m pytest`: **388 passed** (85.7 s). TESTED. Matches the README. |
| Browser-kit tests | `npm test`: **263 passed, 0 failed**; `tsc --noEmit`: exit 0. TESTED. Matches the README. |
| Browser acceptance (`matrix-check.mjs`, 60 checks) | **Not re-run.** It launches Edge and writes into git-ignored `scratch_shots/`, overwriting existing captures. DOCUMENTED only. |
| Matrix sources vs the C4 baseline | `params.ts`, `animator.ts`, `scene.ts`, `shaders.ts` and Detty's four bundle files have SHA-256 hashes **identical** to those in the baseline report (`A-20261020T151308`). MEASURED. The baseline therefore still describes the current code. |
| Effects verification | `python scripts/verify_fx.py ...`: **56/56 checks passed**, re-run in this session. TESTED. It is a script, not a pytest test, and CI does not run it. |

CI (`.github/workflows/ci.yml`) runs the Python suite and the web unit tests, type check and site build. It does not run the browser checks,
the C4 harness, or any of the new `scripts/*.py`.

**Reconciliation of stale documents**
- `outputs/tooling_capability_report.md` (written earlier in this session) says UVR is not installed and SoX / Rubber Band are absent. That is no longer true:
  UVR 5.6.0 is at `C:\Users\USER\Tools\UVR`, SoX 14.4.2 is installed, and `rubberband.exe` is in `C:\Users\USER\Tools\bin`. It is git-ignored (`outputs/*`).
- `evidence/environment-inventory/*` (2026-10-20) predates those installs and the venv packages below. Treat it as historical.
- The venv now contains `pedalboard 0.9.26`, `pyrubberband 0.4.0`, `madmom 0.17.dev0`, `demucs 4.1.0`, `torch 2.14.1 (CPU)` and `mido`. **None of them is declared in
  `pyproject.toml`**, so a fresh checkout cannot run the new scripts. `pip check` reports no broken requirements.
- Mixxx 2.5.6 is installed but is not on PATH and has not been used. UVR has not been used. There is no NVIDIA GPU, so Demucs runs on CPU (about 2.5 minutes for 133 s of audio).

## A. Verified capability inventory

### A1. Musical analysis

| Capability | Status | Source | Output / timing convention | Evidence | Limitations |
|---|---|---|---|---|---|
| Tempo and beat grid | Implemented and tested | `src/audiolab/beats.py` (librosa `beat_track`) | `song_analysis.json` beat events (`time_s`, `beat_in_bar`, `bar_index`, `is_downbeat`, `onset_strength`, `novelty`); `analysis.npz` `beat_times`. Seconds from audio start. | 388 pytest; determinism documented in `docs/engineering`. Detty: 112.35 BPM, 207 beats, beat-interval std 17.5 ms, 2 irregular gaps. | `confidence` is null by design. **No human-annotated ground truth exists** (spec §7 is PROPOSED). Detty's `tempo_scores` rate `half` (0.484) above `detected` (0.421), so a half-tempo error is not excluded. |
| Bars and downbeats | Implemented, but a setting, not a detection | `src/audiolab/bars.py`, `configs/songs.yaml` | `bars.json`; `is_downbeat` in beat events. | Detty `downbeat_hint` scores [1.24, 0.98, 1.02, 0.76] mildly favour offset 0. | Meter and offset are `user_setting`. Only Detty and `track_a` have stored settings; both are offset 0 by default, not checked by ear. |
| Downbeat detection (madmom RNN + DBN) | Implemented but incompletely verified | `scripts/analyze_track.py` (untracked) | `outputs/analysis/*.analysis.json`, schema `audio_lab.track_analysis.v1` (not the repo's schema). | JONZIN: 107.14 BPM, 60 bars, 4/4, bar length 2.21 to 2.23 s (steady). | No ground truth. A second, parallel analysis vocabulary that is not connected to `song_analysis.v1`. Run on one song only. |
| Onsets and strength | Implemented and tested | `events.py` (Python); `lib/pipeline/computer.ts` + `lib/audio/features.ts` (web) | Python: `onset` events (490 on Detty). Web: `onsetStrength`, `beatDetected` (adaptive threshold, 120 ms refractory). | pytest; 263 web tests. | Web `beatDetected` is an onset flag, not a beat. |
| Band / spectral features | Implemented and tested | `features.py`, `webfeatures.py` | Python curves (rms, centroid, flatness, band_bass/mid/high_db, mel). Web bundle: 6 channels at 43.07 Hz (hop 1024 at 44.1 kHz) emulating browser AnalyserNodes. | Live vs offline correlation 0.81 to 0.98 (DOCUMENTED, one song). | Three bands, not a spectrum. |
| Energy changes, transitions (interpretation) | Implemented and tested | `interpretation/rules.py` | `song_interpretation.json`. Labels: `energy_drop`, `energy_build`, `bass_entry`, `rhythmic_density_change`, `transition_candidate`, `high_energy_passage`, `sparse_passage`. Each carries evidence and criteria. | Detty: `transition_candidate` at 52.66 s (loudness, bass, novelty changed), `energy_drop` at 53.22 s (6.67 dB). | `confidence` null. "Placed on the nearest beat". **There is no "breakdown" or "drop" label**: these are operational definitions of measured changes. |
| Section segmentation | Implemented but incompletely verified | `scripts/analyze_track.py` (agglomerative on chroma + MFCC, energy thirds) | `sections[]` with `energy` low/mid/high. | JONZIN: 5 sections, two of 1.1 and 1.7 s. | `apply_fx.py` calls the first low-energy section a **"break"** and the next a **"drop"**. That is an inference from one energy dip, not a detection. |
| Scene states and motion actions | Implemented and tested | `motion/engine.py`, `state.py`; exported by `scripts/export_web.py` | `*.timeline.json` (states rest/build/active/settle; actions with `source`, `start`, `peak`, `lookahead`) and `*.curves.bin` (11 curves at 30 Hz). | Validator refuses stale timelines; web `lib.test.ts`. | Authored for the Motion Lab's four tracks (camera, main element, background, particles). |
| Key estimate | Implemented but incompletely verified | `scripts/analyze_track.py` | F# major (2B), confidence 0.48 | None against ground truth. | Low confidence; not used downstream. |
| Kick vs snare classification | **Not found** | n/a | Only `bassHit` (60 to 150 Hz punch band, 150 ms decay). | n/a | No snare or hat event channel anywhere. |

### A2. Audio processing

| Capability | Status | Source | Evidence | Limitations |
|---|---|---|---|---|
| Stem separation | Demonstrated, not integrated | Demucs CLI `htdemucs`; no repo module | `outputs/stems/htdemucs/<JONZIN>/` bass, drums, other, vocals, 44.1 kHz stereo | One song. Stem sum differs from the original by -20.1 dB relative to the original's level (40 to 100 s). |
| Stem reconstruction | Implemented and tested | `scripts/apply_fx.py` | 56/56 `verify_fx`: output = other stems + processed stem (max diff 6e-05, i.e. 16-bit rounding) | Uses the separated mix, not the original. |
| Filter sweep (log-cutoff, optional resonant ladder) | Implemented and tested | `apply_fx.py` `render`, `cutoff_at`, `Fx` | Synthetic noise: onset 4.0 s vs 4.0 s scheduled; closed at 7.7 s vs 8.0 s; holds; opens at drop. Real stems: 4 to 8 kHz energy is gone by 24.3 s (break 25.56 s). | Timing tolerances are loose (0.3 to 0.5 s). |
| Reverb throw with controlled decay | Implemented and tested | `apply_fx.py` | Silent before drop (max 0.0); starts at the drop (26.660 s); ends exactly at scheduled tail end (31.10 s, 33.32 s exaggerated). | Reverb adds high-frequency energy the isolated stem lacked (ratio 5 to 300 after the drop). |
| Configurable parameters | Implemented | `--sweep-bars --tail-bars --closed-hz --resonance --wet --room --damping --tag --stems --target` | Exaggerated render uses them. | No config file; CLI only. |
| Effect scheduling against musical events | Implemented, **single recipe** | `apply_fx.schedule()` snaps to madmom beats | Sweep 21.11 s, break 25.56 s, drop 26.66 s. | Schedule is **printed, not saved**. No event artifact exists. |
| Effect-window bypass | Implemented and tested (latest correction) | `apply_fx.render`: weight 0 outside `[sweep start, drop + tail]` | Synthetic: bit-identical outside (max diff 0). Real files: <= 6e-05 outside. | **Older renders do not have it** (below). |
| Crossfades | Implemented | 30 ms dry/filtered crossfade at both ends | Read, covered indirectly. | Not separately tested for clicks. |
| Delay, stutter, retrigger | **Not found** as audio effects | n/a | `web_kit/src/lib/audio/delay.ts` is a latency-compensation `DelayLine` for visuals, not an effect. | |
| Gain management / limiting | Implemented, imperfect | Pedalboard `Limiter(-1 dB)` | 333 to 396 samples at full scale in each written 16-bit render. | The source MP3 peaks at 1.13. The limiter is not a hard ceiling. |
| Output validation | Implemented (script only) | `verify_fx.py` | 56/56 | Not in CI, not a pytest test. |

**Old vs corrected renders** (MEASURED). `outputs/fx/*.drums.fx.wav`, `*.vocals.fx.wav` and `*.fx.wav` (hashes unchanged) were rendered before the bypass
correction, so a 20 kHz low-pass ran over the whole file and the reverb rescaled the dry path everywhere. Against the corrected `*.v2.wav`, outside the
effect window the difference is peak 0.058 / rms 0.0015 (drums) and peak 0.093 / rms 0.0037 (vocals). The A/B clips `outputs/ab/drums_20-32.wav` and
`vocals_20-32.wav` were cut from the **old** renders; the exaggerated clips use the corrected code.

## A3. Visual system (Spectrum Matrix)

| Aspect | Finding | Evidence |
|---|---|---|
| Entry point | `SpectrumMatrixCanvas.tsx`: one `useAudioFrame` callback per pipeline frame: `toMatrixParams` -> `stepMatrixAnim` -> `scene.update` -> `host.render`. No loop of its own. | READ |
| Layers | Pure params (`params.ts`), stateful animator (`animator.ts`, deterministic, allocation-free), scene (`scene.ts`), shaders. Frame timing: the animator clamps `dt` to 0.05 s; rows are injected from an accumulated clock, not from frames. | READ; the 3 Matrix test files (about 41 test cases by line count) are part of the 263 that pass |
| Geometry and motion | 72 x 56 height grid scrolling toward the camera at up to 14 rows/s; wireframe + dark surface + horizon haze; camera drift is a slow sinusoid plus drag. | READ |
| Mappings | `bass`, `mid`, `high` -> three lobes (left, centre, right); `rmsEnergy` -> exposure; `bass` -> haze glow; `mid` -> colour; `bassHit` -> **ridge impulse** (decay 0.3 s, retriggered); `currentSceneState` -> camera distance only (1.2 units); silence/reduced-motion gating. | READ (`params.ts`) |
| **Fields the Matrix does not read** | `onsetStrength`, `beatDetected`, `time`, `progress`. `grep` finds none of them in `params.ts`. | MEASURED |
| Terrain memory | Each injected row bakes in the current envelopes and ridge, then scrolls toward the camera, so past hits persist for about 4 s. | READ |
| Event responsiveness | The Matrix responds to **continuous features plus one kick-onset impulse** and a coarse section state. It receives no beat grid, bar, downbeat or transition event. | READ |
| Offline beats reach the scene? | `OfflineSource.beats` (the librosa grid) and `.motion` (timeline + curves) are public properties of the source, but the pipeline emits only `AudioFeatureFrame`, which carries neither. The Matrix never touches them. | READ |
| Preview routes | `/matrix` on `node preview/serve-gl.mjs 5354` (needs `node preview/build.mjs matrix glhost`). The source picker offers the synthetic demo, the three manifest songs (Detty, Track A, Track B), file upload and mic. Detty and Track A ship `audio: null` (silent clock). Track B points to `/motion/audio/track-b.mp3`, which does not exist on disk (only `jeriq-airplane-mode.mp3` does). | READ + `ls` |
| Deterministic capture | `web_kit/preview/c4/` (untracked): fake clock, fixed 1/60 s step, Detty "balanced" profile. 3 runs: **all captures pixel-identical, feature series identical**. Metrics (focal contrast, horizon band, luminance percentiles) are PROVISIONAL, with no thresholds set. | Baseline report; sources unchanged (hashes) |
| Performance | Intel UHD, 1280x720, DPR 1, Detty: frame interval median 16.7 ms (p99 17.0), main thread median 0.4 ms, synchronous GPU 3.3 to 4.2 ms, 0% over 33 ms. | Baseline report (measured 2026-10-20) |

C4 note: only variant **A** (the unmodified scene) exists. The harness comment says variants are "added in this file, never in the production scene without
review", and mentions "Tier C events"; **no document in the repo defines Tier C or C4's later variants**, so I did not assume what they are.

## B. Current architecture map

```
 original audio ──► audiolab analyze ──► song_analysis.json + analysis.npz        [librosa beats, bars = user setting]
 (wav / mp3)             │                       │
                         │                       ├──► audiolab interpret ──► song_interpretation.json   [measured changes, conf null]
                         │                       └──► audiolab motion ─────► motion_timeline.<profile>.json/.npz
                         │                                                          │
                         └──► webfeatures (6-channel readings @43 Hz) ─┐            │
                                                                       ▼            ▼
                                     scripts/export_web.py ──► features.json/.bin + <profile>.timeline.json + .curves.bin
                                                                       │            (beats list, states, actions, 11 curves)
 ═══════════════════════════ browser ══════════════════════════════════════════════════════════════
                         loadOfflineSource ─► OfflineSource ──sample()──► AudioFeatureFrame ──► params ─► animator ─► scene
                              │  .beats  ─┐                       (bass mid high rms onset beat           (Matrix)
                              │  .motion ─┴─ public, NOT in frame  bassHit sceneState)  ◄── the only interface
                              └─ FeatureComputer (shared with live audio)

 ── separate, not connected to the above ─────────────────────────────────────────────────────────
 audio (JONZIN) ─► scripts/analyze_track.py (madmom beats/downbeats, librosa key, sections) ─► *.analysis.json (own schema)
                ─► Demucs ─► stems ─► scripts/apply_fx.py (sweep + reverb) ─► outputs/fx/*.wav ─► make_ab_clips ─► outputs/ab/
                                       schedule printed only                ─► verify_fx (56 checks)
```

| Link | State |
|---|---|
| Analysis -> interpretation -> motion -> export -> OfflineSource -> frame -> Matrix | **Existing, tested** |
| OfflineSource beat grid / motion actions / curves -> Matrix | **Missing**: data reaches the source object, not the scene |
| Effects scripts <-> repo analysis (`song_analysis.v1`) | **Missing**: effects use a different analyser, schema and event vocabulary |
| Effects schedule -> any artifact | **Missing**: printed only |
| Effects events -> visual | **Missing** |
| Original/stem audio -> browser | **Unverified**: Detty/Track A have no shipped audio; JONZIN is not in the web manifest |

## C. Audio-visual integration: answers and candidate classification

**Direct answers (evidence-backed)**

1. *Exact beats of the offline song?* The grid is in `features.json` (`beats`, 207 for Detty) and on `OfflineSource.beats`, but not in the frame. The Matrix sees
   only `beatDetected`, an onset flag. MEASURED on Detty's first 64 s (117 grid beats, 142 flags): 72% of grid beats have a flag within 60 ms and 59% of flags sit within 60 ms of a grid beat.
2. *Bar start or downbeat?* Not in the web bundle. `bars.json` has them, but from a manual offset.
3. *Kick vs snare?* No. `bassHit` only. MEASURED: its 92 peaks above 0.5 sit a median of 152 ms from the nearest grid beat; only 16% within 60 ms. A uniform spread would give about 134 ms. So the kick channel and the grid are **not** the same signal (the syncopation, a grid error or a half-tempo error could each explain it; I cannot tell which without listening).
4. *Same transition events as the audio effects?* No. Effects use `analyze_track.py` sections and print the times; the browser uses interpretation / motion events. No shared artifact.
5. *Shared timing without shared implementation?* Yes in principle: everything is in seconds from audio start. Different resolutions: readings 43.07 Hz (trailing window), motion curves 30 Hz, effects sample-accurate. `OfflineSource` has `latencyMs = 0` and `setSyncNudge`.
6. *Available but unconsumed by the Matrix:* the beat grid; 11 motion curves; the motion actions (`beat_accent`, `strong_beat_shake`, `transition_out/push/burst/particles/in`); interpretation events; `beatDetected` / `onsetStrength`.
   MEASURED on Detty: the `main_element.accent` curve has 190 peaks, 99% within 40 ms of a grid beat (a grid-locked pulse, anticipatory by 30 ms); `transition_*` actions are scheduled around 52.66 s with up to 1.0 s of lookahead.
7. *Needs new analysis or a new interface:* downbeat validation; a snare/hat channel (drum stem, band-split); a saved effects-event artifact; a way to give events to the scene.
8. *Testable on recorded data?* Yes: the C4 harness already drives the real scene from a recorded bundle with a fake clock, pixel-reproducibly.

**Candidate behaviours**

| Candidate | Class | Why |
|---|---|---|
| Filter sweep with gradual visual-intensity reduction | **C** | The visual half is mechanically easy (exposure, glow, high-lobe are animator inputs), but the sweep schedule is not an artifact, and its source (`analyze_track` sections) differs from the repo's events. |
| "Detected breakdown" changes terrain movement | **D** for "breakdown" / **B** for the measured events | No breakdown label exists. `energy_drop` / `transition_candidate` are measured and available; `motion` (scroll rate) is an animator input. |
| Beat triggers a controlled visual impulse | **B** | The grid-locked `main_element.accent` curve exists and reaches the source. The ridge impulse already exists in the animator. |
| Downbeat triggers a stronger impulse | **C** (borderline **D**) | Downbeats come from a manual setting; madmom downbeats exist for JONZIN only, unvalidated. |
| Reverb tail with a fading visual trail | **C** | The effect tail is not exported, and terrain memory already persists impulses. Weak musical case until the sweep case works. |
| Drum-specific event stronger than general energy | **C** | Kick-like `bassHit` exists; snare and hat do not. Stems would be needed. |
| Whole audio-visual transition from a sequence of events | **D** | Needs an event contract that does not exist yet. |

## D. Ranked next steps

Scoring is 1 to 5 (5 is best; for complexity, risk and verification difficulty, 5 means least).

| Criterion | **1. Beat-grid event channel into the Matrix (isolated variant B)** | 2. Transition-cue visual sweep | 3. Persist effect events as a shared timeline |
|---|---|---|---|
| Novelty vs existing | 3 | 5 | 3 |
| Visible/audible impact | 3 | 4 | 1 now |
| Musical justification | 4 (grid has diagnostics; half-tempo caveat) | 3 (one event, measured only) | 5 |
| Reuse | 5 | 4 | 5 |
| Complexity | 4 | 3 | 4 |
| Verification ease | 5 (about 117 to 207 events) | 3 (n = 1) | 5 |
| Performance | 5 | 5 | 5 |
| Architecture risk | 4 | 4 | 5 |
| Value of evidence | 4 | 4 | 3 (enabling) |

### Primary: variant B, a beat-grid event channel (`main_element.accent`) driving the Matrix ridge, built in the C4 harness only

1. **Builds on:** the C4 deterministic harness; `OfflineSource.motion.curves` (`main_element.accent`, already computed and exported); the animator's existing ridge impulse.
2. **New behaviour:** the Matrix responds to a **musical event** (a grid-locked beat pulse anticipating by 30 ms) instead of only a kick-onset impulse. This directly tests "events vs continuous features".
3. **Why over the alternatives:** it needs no new analysis, no new dependency and no schema change; it has the largest sample of events; and it resolves the open question from this inspection (kick vs grid disagree) before anything beat- or drum-specific is built on top. Alternative 2 rests on a single measured event, and alternative 3 changes nothing visible.
4. **Files and interfaces:** `web_kit/preview/c4/ab-entry.tsx` (add a variant "B": sample the accent curve at the playhead time and set `p.ridge` before calling the unchanged `stepMatrixAnim`); a capture script alongside `capture-a.mjs`. Reads `OfflineSource.motion` and `.beats`.
5. **Unchanged:** `params.ts`, `animator.ts`, `scene.ts`, `shaders.ts`, the `AudioFeatureFrame` contract, schemas, the Python pipeline, all audio scripts and renders, dependencies.
6. **Verification:** same Detty "balanced" bundle, fake clock, fixed step, canonical and diagnostic timestamps as variant A. Measure (a) ridge-peak times vs grid beats (A vs B); (b) pixel-identical across 3 runs; (c) per-timestamp A vs B metrics; (d) frame cost; (e) production file hashes still equal the baseline's; (f) silence: B is pixel-identical to A when the accent curve is zero.
7. **Decision rules (proposed, to be fixed before measuring B):**
   - *Continue* if B's ridge peaks fall within 2 steps (about 33 ms) of a grid beat for at least 95% of beats, 3 runs are identical, main-thread cost rises by no more than 0.2 ms with the frame interval unchanged, and, when played against the Detty audio on the user's machine, the pulses look on the beat.
   - *Revise* if the alignment holds but the pulses look off the music: that means the grid is the problem (half-tempo or offset), not the channel. Move to improving the beat pipeline.
   - *Abandon* if the grid-locked pulses clearly disagree with the audible kicks across the song, or if B costs measurable frame time.

### Alternatives
- **2. Transition-cue visual sweep:** consume the existing `transition_out/in` actions at 52.66 s on Detty so the terrain dims and smooths into the transition, then restores. Higher novelty and the closest visual analogue of the filter sweep, but a single event, and it would first need the Detty window (about 48 to 58 s) characterised, because `energy_drop` is a measured dip and not a confirmed break and return.
- **3. Persist the effect schedule:** make `apply_fx.py` write its sweep / break / drop / tail times as a small JSON event timeline, and reconcile its section heuristic with the repo's interpretation events. Nothing audible or visible changes, but it is the prerequisite for ever driving audio and visuals from one event source. Suggested order: 1, then 3, then 2.

## E. Minimal implementation plan (primary, after approval)

1. **Step 0 (read-only):** characterise Detty's grid against its audio on the user's machine: confirm tempo is not half or double, and listen for offset. Record the outcome before building B.
2. **Variant B** in `ab-entry.tsx`: sample the accent curve by linear interpolation at the source time (30 Hz curve; time in seconds from audio start); set `p.ridge = clamp01(accent)` after `toMatrixParams`; leave everything else as in A.
3. **Capture:** 3 runs at the baseline's canonical times (0, 10, 20, 30, 40 s) and diagnostic times (51 to 54 s windows), plus a 10 s series of ridge values per step.
4. **Compare:** A vs B ridge-peak-to-grid distances; per-timestamp metrics (focal contrast, litFraction, horizon band); frame timing; hashes of production files.
5. **Report** in this evidence folder, with the decision rules above applied to the numbers.

Acceptance: the "Continue" conditions above, plus no change to any tracked file.

## F. Evidence and limitations

**Commands run (read-only unless stated):** `git branch / log / status`; directory listings; `Read` of the files named above; `python -m pytest -p no:cacheprovider -q -x` (388 passed); `npm test` (263 passed) and `npx tsc --noEmit -p .` (exit 0) from `web_kit/`; `python scripts/verify_fx.py ...` (56/56; writes nothing); SHA-256 comparisons of Matrix sources and the Detty bundle with the baseline report; Python snippets reading `samples/detty/*`, `web_kit/public/motion/*`, and the C4 `feature-series.csv` / `beats.json`; `pip list` / `pip check`; `Get-Command` for external tools.

**Artifacts inspected:** `samples/detty/song_analysis.json`, `song_interpretation.json`; `outputs/Detty.../bars.json`; `web_kit/public/motion/{detty,track-a,track-b}/*`; `scratch_shots/c4-terrain-memory/baseline-A/A-20261020T151308/*`; `designs/spectrum-matrix/evidence/environment-inventory/*`; `outputs/fx`, `outputs/ab`, `outputs/stems`, `outputs/analysis`.

**Failures and caveats**
- My first full pytest run printed nothing because of how its output was piped. It passed when re-run with output redirected to a file; I treat the 388-passed result as valid.
- The browser acceptance checks, the C4 capture and the matrix-check were **not re-run**: they overwrite git-ignored captures and need a GPU Edge session. The unchanged hashes support the baseline, but 60/60 is DOCUMENTED, not TESTED, today.
- All beat and kick alignment numbers are from **one song** (Detty, first 64 s, 60 Hz sampling) with no ground-truth annotation. They show the signals differ; they do not show which one is right.
- Detty's audio is not shipped, so audible sync in the browser cannot be shown from the repo alone.
- Nothing here has been listened to or viewed live by me; the effect results are measurements.
- JONZIN is third-party audio. The repo anonymised its other third-party demo songs (commit `fca44c0`), so it should not be added to `web_kit/public/` without a rights decision.
- Not looked at: Squall, Accretion and Constellation Core internals beyond their use of `beatDetected`; Mixxx and UVR workflows; the Next.js routes.

**Waiting for approval before any implementation.**
