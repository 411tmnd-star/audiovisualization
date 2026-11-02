// Builds the static demo site into web_kit/site/: node scripts/build-site.mjs
// A landing page plus one page per visual, the bundles, and the pre-analysed motion data (no audio files).
import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const repo = join(root, "..");
const out = join(root, "site");
const visuals = [
  { id: "squall", title: "Squall", tagline: "A weather map that listens: bass is pressure, highs are rain, hits are lightning.", shot: "designs/accretion/screenshots/04-squall-for-comparison.png" },
  { id: "accretion", title: "Accretion", tagline: "A black hole seen from the side. The disk turns with the music and bass hits fire the jets.", shot: "designs/accretion/screenshots/02-playing-jets.png" },
  { id: "core", title: "Constellation Core", tagline: "A glowing core with orbiting moons and rings. Bass swells it, mids speed the orbits, hits surge the beam.", shot: "designs/constellation-core/screenshots/02-playing.png" },
  { id: "resonator", title: "Resonator", tagline: "A glass orb and plasma heart inside concentric fluid ribbons. Bass pulses the core, highs ripple the outer rings, onsets flash the gold tracks.", shot: "designs/resonator/screenshots/02-playing.png" },
  { id: "score", title: "Score", tagline: "Music written as it plays: three lanes scroll right to left, bass in amber, mids in cyan, highs in violet, with detected onsets marked.", shot: "designs/score/screenshots/01-pattern.png" },
  { id: "chroma", title: "Chroma Field", tagline: "A volume of drifting colour and particles. Bass swells it, mids swirl it, highs shimmer and scatter colour, onsets burst through it.", shot: "designs/chroma/screenshots/chroma-07-detty-live.png" },
];

execFileSync(process.execPath, [join(root, "preview", "build.mjs"), ...visuals.map((v) => v.id)], { stdio: "inherit", cwd: root });

rmSync(out, { recursive: true, force: true });
mkdirSync(join(out, "img"), { recursive: true });

for (const v of visuals) {
  cpSync(join(root, "preview", "dist", `${v.id}.js`), join(out, `${v.id}.js`));
  cpSync(join(root, "preview", "dist", `${v.id}.css`), join(out, `${v.id}.css`));
  cpSync(join(repo, v.shot), join(out, "img", `${v.id}.png`));
  mkdirSync(join(out, v.id), { recursive: true });
  writeFileSync(join(out, v.id, "index.html"), `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="icon" href="data:,"><title>${v.title} | Audio Lab</title>
<link rel="stylesheet" href="/${v.id}.css"></head>
<body class="bg-[#02040c]"><div id="root"></div>
<a href="/" style="position:fixed;right:12px;top:10px;z-index:9;font:13px system-ui;color:#9fb4d6;text-decoration:none">&larr; All visuals</a>
<script src="/${v.id}.js"></script></body></html>
`);
}

// Pre-analysed songs: timelines and feature bundles only. Audio files are never published.
cpSync(join(root, "public", "motion"), join(out, "motion"), { recursive: true });
rmSync(join(out, "motion", "audio"), { recursive: true, force: true });
const manifestPath = join(out, "motion", "manifest.json");
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
for (const s of manifest.songs) s.audio = null;
writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

const cards = visuals.map((v) => `
  <a class="card" href="/${v.id}/"><img src="/img/${v.id}.png" alt="${v.title}" loading="lazy">
  <div class="body"><h2>${v.title}</h2><p>${v.tagline}</p></div></a>`).join("");
writeFileSync(join(out, "index.html"), `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="icon" href="data:,"><title>Audio Lab</title>
<meta name="description" content="Eight real-time, music-driven visuals built with React, TypeScript and Three.js, fed by a Python audio-analysis pipeline.">
<style>
:root{color-scheme:dark;--bg:#04060d;--panel:#0b1020;--line:#1a2340;--text:#e8eefc;--muted:#93a3c4;--accent:#6aa8ff}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:16px/1.55 system-ui,-apple-system,Segoe UI,Roboto,sans-serif}
main{max-width:1040px;margin:0 auto;padding:56px 16px 72px}
h1{font-size:clamp(2rem,5vw,3rem);margin:0 0 12px;letter-spacing:-.02em}
.lede{color:var(--muted);max-width:60ch;margin:0 0 36px}
.grid{display:grid;gap:20px;grid-template-columns:repeat(auto-fit,minmax(min(100%,440px),1fr))}
.card{display:block;background:var(--panel);border:1px solid var(--line);border-radius:14px;overflow:hidden;color:inherit;text-decoration:none;transition:border-color .15s,transform .15s}
.card:hover,.card:focus-visible{border-color:var(--accent);transform:translateY(-2px);outline:none}
.card img{display:block;width:100%;aspect-ratio:16/10;object-fit:cover;object-position:top;background:#000}
.body{padding:16px 18px 20px}h2{margin:0 0 6px;font-size:1.15rem}p{margin:0;color:var(--muted);font-size:.95rem}
.how{margin-top:40px;color:var(--muted);font-size:.95rem}.how a{color:var(--accent)}
@media (prefers-reduced-motion:reduce){.card{transition:none}.card:hover{transform:none}}
</style></head><body><main>
<h1>Audio Lab</h1>
<p class="lede">Eight real-time visuals that react to music. A Python pipeline analyses each song (tempo, beats, bands, onsets); a browser app plays the result through React, TypeScript and Three.js. Pick a visual, then choose Demo, a pre-analysed song, or your microphone.</p>
<div class="grid">${cards}
</div>
<p class="how">Pre-analysed songs play as a silent, synced visual: only the analysis data is hosted, never the audio. Source code, tests and engineering notes: <a href="https://github.com/411tmnd-star/audio-lab">github.com/411tmnd-star/audio-lab</a>.</p>
</main></body></html>
`);
const audio = readdirSync(out, { recursive: true }).filter((f) => /\.(mp3|wav|flac|m4a|aac|ogg|mpeg)$/i.test(String(f)));
if (audio.length) throw new Error("audio files must not be published: " + audio.join(", "));
console.log("site built:", out);
