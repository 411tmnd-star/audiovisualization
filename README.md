# Audio Lab

[![CI](https://github.com/411tmnd-star/audio-lab/actions/workflows/ci.yml/badge.svg)](https://github.com/411tmnd-star/audio-lab/actions/workflows/ci.yml)

**Live demo: [audio-lab-git-main-411-004b.vercel.app](https://audio-lab-git-main-411-004b.vercel.app)** (pick a visual, then press Demo, choose a pre-analysed song, or use your microphone)

Audio Lab turns a song into a live, music-driven visual. A Python pipeline analyses the audio (tempo, beats, bars, spectral bands, onsets) and interprets it. A browser app then plays that analysis through six real-time visuals built with React, TypeScript and Three.js.

| Squall: a weather map | Accretion: a black hole |
|---|---|
| ![Squall](docs/media/squall.gif) | ![Accretion](docs/media/accretion.gif) |
| **Constellation Core: a planetary system** | |
| ![Constellation Core](docs/media/core.gif) | |

*Each clip is the built-in synthetic 120 BPM demo, recorded in headless Edge on integrated graphics.*

Resonator (a glass orb in fluid ribbons), Score (music written as it plays) and Chroma Field (a drifting volume of colour) complete the six. All of them read the same audio features, so any song drives any visual. Every visual except Squall is shown on one shared full-view stage with a source picker: a built-in demo, three pre-analysed songs, an uploaded file or the microphone.

## How it works

    audio file
       |
       v
    1. analyze          tempo, beats, bars, band energy, onsets        -> song_analysis.json
       |
    2. interpret        rule-based reading of the analysis             -> song_interpretation.json
       |
    3. visual mapping   audio features -> visual signals (3 profiles)
       |
    4. motion           scene states (rest, build, active, settle)     -> motion timeline
       |
    5. export           compact bundles for the browser                -> web_kit/public/motion/
       |
       v
    browser app         plays the timeline, or analyses live audio, and drives the visuals

Every stage writes a versioned JSON artifact validated against a schema in `schemas/`. The analysis stage is deterministic: the same audio and configuration give byte-identical arrays.

## Verification

- Python: 388 tests (pytest).
- Browser kit: 263 unit tests, a clean TypeScript check, and real-browser checks with a GPU: 70 for Constellation Core and 13 for the live-versus-offline pipeline.
- Both new visuals hold 60 fps on integrated graphics (median frame 16.7 ms).

Details, numbers and how unusual input is handled are in [docs/engineering](docs/engineering/README.md).

## Repository layout

| Path | Contents |
|---|---|
| `src/audiolab/` | Python package: analysis, interpretation, visual mapping, motion, CLI |
| `web_kit/` | Browser app and the six visuals ([design notes](web_kit/DESIGN.md)) |
| `designs/` | Per-visual notes and screenshots: `accretion/`, `chroma/`, `constellation-core/`, `resonator/`, `score/` |
| `samples/` | Real pipeline output for three songs (JSON and plots) |
| `configs/`, `schemas/` | Analysis, interpretation, motion and visual-profile configs; versioned JSON schemas |
| `tests/`, `scripts/` | Python tests; the export script and the upload-demo server |
| `docs/` | [Visualizer architecture](docs/architecture/visualizer-guide.md), [engineering notes](docs/engineering/README.md), [planning](docs/planning/) (upgrade spec and analysis), demo clips |

## Run it

Python 3.10 or later and Node 22.7 or later (developed on Node 24).

    python -m venv .venv
    .\.venv\Scripts\Activate.ps1          # Windows PowerShell
    python -m pip install -e ".[dev]"
    python -m pytest

Analyse a song and open the upload demo:

    audiolab --help
    python scripts/demo_server.py         # http://localhost:8765, see DEMO.md

Browser kit, from `web_kit/`:

    npm install
    npm test
    node preview/build.mjs                # bundle the previews
    node preview/serve.mjs 5353           # Squall at http://localhost:5353/squall
    node preview/serve-gl.mjs 5354        # /accretion, /core, /resonator, /score and /chroma on port 5354
    npm run build:site                    # the static demo site, written to web_kit/site/

## Notes

- Audio files are not included. Supply files you have permission to use; the visuals also run on a built-in synthetic demo and the microphone.
- [`docs/planning/upgrade-spec.md`](docs/planning/upgrade-spec.md) is the planning document for the next upgrade round.

## License

[MIT](LICENSE)
