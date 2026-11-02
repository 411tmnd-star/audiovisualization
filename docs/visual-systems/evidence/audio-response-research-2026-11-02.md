# Making the visuals respond to sound: research, measurement and design (2026-11-02)

Owner request: after removing Spectrum Matrix and Terrain, push the remaining visuals "to max" and make them "visually able to respond to sound better", with research and a considered design for each. This note is the evidence behind spec section 14. Labels follow spec section 3.

## 1. What the research says (external, read 2026-11-02)

| Finding | Source | What it means here |
|---|---|---|
| Envelope followers use a **fast attack and a slow release**; the ear is very sensitive to the initial rise of a sound (the transient). | kferg.dev, "Audio Reactive Programming: Envelope Followers"; musegen.ai visualiser deep dive | A visual that eases in slowly feels late; the decay is where smoothness belongs, not the rise. |
| People detect a sound **leading** its picture at about 65 to 111 ms, and a window of no detected asynchrony runs from about **75 ms of audio lead to 188 ms of audio lag** (a hammer striking a peg). For music (guitar, piano) the just-noticeable difference is about **100 to 130 ms**. | PMC4451240 (perceived synchrony for realistic audiovisual events); Vatakis and Spence 2006 (speech and music, temporal order judgement) | A visual that **trails** the sound is judged out of sync sooner (about 75 ms) than one that leads it (up to about 190 ms). Lag is the failure to avoid; a small lead is forgiving. This also says that anticipation (see 5) is perceptually safe and lag is not. |
| Visualizers that stay lively on quiet and loud songs **normalise each band against its recent peak** (automatic gain control) and use **spectral flux** for onsets. | dedo1911/music-visualizer (AGC over 128 bands against the recent peak, spectral-flux onset detection) | The contract's levels are absolute (dB mapped linearly), so a song's own range is not used. |

**Unverified or out of reach:** the perceptual numbers come from lab studies with realistic events, not from this application; the project's own sync nudge and device-latency compensation (`pipeline.setSyncNudge`) are the practical control. Nothing here was run with a person listening (Detty ships no audio).

## 2. What the code did (Observed, measured on the scenes' own animators)

`web_kit/scripts/response-audit.ts` drives each scene's real animator with (a) a 0-to-1 step in one band and (b) 100 s of Detty's real analysis at 60 fps, and measures rise time, lag, range used and transient fidelity. Baseline, 2026-11-02, before any change (`evidence/response-audit-before-2026-11-02.json`):

- **Rise to 90% of a step: 167 to 283 ms** in every scene. A 70 to 80 ms scene-level attack was stacked on the contract's own 10 to 30 ms attack.
- **Lag behind the sound on real music: 50 to 100 ms.**
- **Range used.** On Detty the mid band spans only about 0.19 of 0 to 1 (p5 to p95: 0.49 to 0.68), and the high band 0.38. A mid-driven signal therefore moved about **0.11** (orbit speed, ribbon rise): almost nothing. A 400 to 450 ms release made this worse by smoothing away fast changes.
- **Transient fidelity** (correlation of the signal's 100 ms change with its band's change): **0.53 to 0.57**.
- **Mapping gains were timid.** The Constellation Core core swelled 4% with bass; Accretion's body 4%; Resonator's orb 7% plus 5% on a kick.
- The only transient channels in the contract are `bassHit` (bass only) and one global onset flag. Mid and high had none, so snares, vocals and hats could not strike anything.

## 3. The design (Proposed, then measured)

Three scene-independent changes and one scene-specific one. No change to the audio contract, `GlHost` or any scene's identity.

1. **Response shaper** (`src/lib/audio/shaping.ts`, new, pure state machine). Per band: **auto-gain** (a floor and a ceiling tracked from the recent signal, the band expanded to use the range; the floor never goes below 0 and the expansion is capped at 1/0.22 about 4.5x, so silence stays silent and noise is not amplified; adaptation freezes while paused; a faster warm-up for the first 8 s of a song) and **punch** (a per-band transient: the positive rate of rise of the lightly smoothed band, normalised against the band's own recent peak rate, instant attack, 120 ms decay). It returns a new frame with the same fields plus `punch`; the same input object returns the same output object (Score keys on identity).
2. **Faster envelopes in the scenes**: attack 70 to 80 ms to 30 ms; release 400 to 450 ms to 220 to 250 ms (Chroma 0.4 to 0.25 and so on). The decay keeps the smoothness; the rise gets out of the way. **Resonator is the exception: attack 60 ms.** Its own pre-registered criteria (no one-frame jump of the orb over 0.25; orb swell restrained to 1.03 to 1.12) encode its fluid identity, and a first version with a 30 ms attack broke them (a one-frame step of 0.43). Those criteria were kept, not moved. A kick reaches the orb through its existing instant `kick` channel, which the bass transient now also strikes, so the strike is sharp while the level path stays fluid.
3. **A Response toggle** (Tuned / Raw) in the stage's Controls panel, so the owner can compare directly and so the old behaviour stays reachable.
4. **Per-scene use of punch and larger visible gains** (below). Each scene reads punch in its own way; the shaper does not decide what a scene does.

### Per scene: what the sound should do, and why

| Scene | Identity (kept) | Bass | Mid | High | Why this split |
|---|---|---|---|---|---|
| Constellation Core | A network: a core, rings, orbs, a beam | Mass: core swell 4% to 14%, the camera breathes 3% with it, plus a kick snap | Motion: the orbit phase accumulates faster on a mid hit, so a surge persists as momentum and bends the orbit instead of jumping it | Surface: orb size and star twinkle flicker on a high hit | Each band gets a different kind of motion (size, angular speed, sparkle), so they stay separable on screen. Hierarchy (core, rings, beam third) unchanged |
| Resonator | Radial energy about a body | Centre: orb swell 7% to 10% (still restrained), kick 5% to 10% and struck by every bass transient, halo and light follow | Inner ribbons lift and ripple on a mid hit | Outer ripple, beads and twinkle spike on a high hit | Frequency maps to radius already (bass at the heart, highs outside); punch gives each ring its own strike |
| Accretion | A black hole seen side-on | Ring heat and disk brightness (disk 0.6/0.4 to 0.4/0.6 mix), kick flare | Disk spin and turbulence surge | Fine disk detail and star twinkle flicker | The body keeps its size; the light carries the music, as the identity says |
| Chroma Field | A drifting medium of colour | Expansion with a kick | Turbulence spikes with a mid hit | Sparkle and dispersion burst on a high hit | Colour per register is unchanged; the medium reacts at the speed of the hits |
| Score | A faithful temporal record | Lane depth uses the song's range | The mid trace uses its range (it spanned 0.19) | The high trace uses its range (nearly flat on Detty before) | An instrument auto-ranges like an oscilloscope. No punch: onset markers already mark hits. Raw mode keeps the unscaled record |
| Squall | The reference stage | not changed this pass | | | It has its own simulation, forecast and tuning; changing its input scale is a separate decision |

## 4. Results (measured; one machine, software WebGL in a Linux container)

**Signal level** (`response-audit.ts`, Detty real analysis, same method before and after; `evidence/response-audit-after-2026-11-02.json`):

| | Before | After |
|---|---|---|
| Rise to 90% of a step | 167 to 283 ms | 83 ms (Chroma mid 117 ms, Chroma high 50 ms); **Resonator orb 150 ms**, held fluid on purpose (see 3), its ribbons and beads 83 ms |
| Lag on real music | 50 to 100 ms | 17 ms (Resonator orb 50 ms) |
| Bass signal range (input 0.70) | 0.52 | 0.69 to 0.74 |
| Mid signal range (input 0.19) | 0.11 | 0.31 to 0.35 |
| High signal range (input 0.38) | 0.33 | 0.70 to 0.79 |
| Transient fidelity | 0.53 to 0.57 | 0.65 to 0.88 (Resonator's gentler orb is the low end) |

**Picture level** (real renderer, headless Chromium with software WebGL; Detty features on a silent clock, 48 screenshots of the canvas centre per scene on the final build against the build as it stood before this work; the runs are not time-aligned, so this compares how deeply the picture modulates, not frame by frame):

| Scene | Brightness swing (CoV) | p5 to p95 spread | Frame-to-frame change |
|---|---|---|---|
| Constellation Core | 1.8x | 1.9x | 1.8x |
| Resonator | 1.6x | 1.9x | 1.2x |
| Accretion | 1.55x | 1.6x | 1.4x |
| Chroma Field | 1.2x | 1.5x | 1.4x |
| Score | 1.0x | 1.06x | 1.2x |

Score's lane amplitude (the thing it changes) is not a brightness measure; its before/after is the signal-level table and the paired frames (the mid trace now swings with the phrasing, the high lane shows the hats it used to flatten). An earlier measurement of Raw against Tuned on the same build gave smaller ratios (Core 1.4x, Resonator 1.15x, Accretion 1.1x): that is the share due to the shaper alone; the rest is the faster envelopes and the larger gains.

## 5. What was not done, and why (Proposed, for the owner)

- **Lookahead for offline songs (Class C: contract).** Pre-analysed songs know the future; a visual could begin a hit 50 to 100 ms before the sound, which the research says is perceptually forgiving, and impacts would land on the beat. The contract carries no future frames. The sync nudge is the existing, owner-controlled version of this.
- **Richer bands (Class C: contract).** Three bands and one onset flag are the ceiling for what scenes can read. Sub-bass, low-mid and presence bands, a spectral centroid and continuous flux would each give a scene a new axis. The Python analysis already has more than the contract carries.
- **Squall** was left alone (above). **Photosensitivity:** the existing 3-per-second flash limits are unchanged, but faster attacks and larger gains raise how sharp a hit looks; nobody has reviewed the scenes for photosensitive risk with the new response. **Audible check:** none (Detty has no audio); whether the response "feels in time" is the owner's to judge on a real track.
