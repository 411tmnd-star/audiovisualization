// How well does each scene's driving signal follow the sound? Measured on the scenes' own animators, not estimated.
// Run from web_kit/:  node --import ./tests/resolve-ts.mjs --experimental-transform-types scripts/response-audit.ts [out.json]
//
// Three measurements per driving signal (a signal is a smoothed value the scene reads each frame, paired with the contract band
// that drives it):
//   rise63 / rise90   seconds for the signal to reach 63% / 90% of its final value after a step of its band from 0 to 1 (60 fps)
//   lag               the delay (ms) at which the signal best matches its band on Detty's real analysis (cross-correlation, 0..400 ms)
//   range             the 5th to 95th percentile spread of the signal over 100 s of Detty (how much of 0..1 it uses)
//   dcorr             correlation of the signal's change with its band's change over 100 ms (do transients get through?)
// Mode: pass `raw` as the second argument to feed the scenes the contract's own frames; the default applies the response shaper
// exactly as the canvases do (src/components/gl/response.tsx).
// Detty ships no audio, so these are properties of the data a scene is given on a silent clock, not of what anyone hears.
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { createAccretionAnim, stepAccretionAnim } from "../src/lib/accretion/animator";
import { toAccretionParams } from "../src/lib/accretion/params";
import { createChromaAnim, stepChromaAnim } from "../src/lib/chroma/animator";
import { toChromaParams } from "../src/lib/chroma/params";
import { createCoreAnim, stepCoreAnim } from "../src/lib/constellation-core/animator";
import { toCoreParams } from "../src/lib/constellation-core/params";
import { ResponseShaper } from "../src/lib/audio/shaping";
import { makeFrame, type AudioFeatureFrame } from "../src/lib/pipeline/contract";
import { loadOfflineSource } from "../src/lib/pipeline";
import { createResonatorAnim, stepResonatorAnim } from "../src/lib/resonator/animator";
import { toResonatorParams } from "../src/lib/resonator/params";

type Band = "bass" | "mid" | "high";
interface Harness {
  scene: string;
  create: () => unknown;
  step: (a: unknown, f: AudioFeatureFrame, dt: number) => void;
  signals: { name: string; band: Band; get: (a: unknown) => number }[];
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const H = (scene: string, create: () => any, step: (a: any, f: AudioFeatureFrame, dt: number) => void, signals: { name: string; band: Band; get: (a: any) => number }[]): Harness => ({ scene, create, step, signals });

const RAW = process.argv[3] === "raw";
const shapers = new WeakMap<object, ResponseShaper>();
const shaped = (a: object, f: AudioFeatureFrame, dt: number): AudioFeatureFrame => {
  if (RAW) return f;
  let sh = shapers.get(a);
  if (!sh) shapers.set(a, (sh = new ResponseShaper()));
  return sh.shape(f, dt);
};

const HARNESS: Harness[] = [
  H("Constellation Core", createCoreAnim, (a, f, dt) => stepCoreAnim(a, toCoreParams(shaped(a, f, dt), false), dt, false), [
    { name: "swell", band: "bass", get: (a) => a.swell },
    { name: "orbitSpeed", band: "mid", get: (a) => a.orbitSpeed },
    { name: "shimmer", band: "high", get: (a) => a.shimmer },
  ]),
  H("Resonator", createResonatorAnim, (a, f, dt) => stepResonatorAnim(a, toResonatorParams(shaped(a, f, dt), false), dt, false), [
    { name: "swell", band: "bass", get: (a) => a.swell },
    { name: "rise", band: "mid", get: (a) => a.rise },
    { name: "ripple", band: "high", get: (a) => a.ripple },
  ]),
  H("Accretion", createAccretionAnim, (a, f, dt) => stepAccretionAnim(a, toAccretionParams(shaped(a, f, dt), false), dt, false), [
    { name: "horizon", band: "bass", get: (a) => a.horizon },
    { name: "diskSpeed", band: "mid", get: (a) => a.diskSpeed },
    { name: "detail", band: "high", get: (a) => a.detail },
  ]),
  H("Chroma Field", createChromaAnim, (a, f, dt) => stepChromaAnim(a, toChromaParams(shaped(a, f, dt), false), dt), [
    { name: "bass", band: "bass", get: (a) => a.bass },
    { name: "mid", band: "mid", get: (a) => a.mid },
    { name: "high", band: "high", get: (a) => a.high },
  ]),
];

const DT = 1 / 60;
const frame = (o: Partial<AudioFeatureFrame>): AudioFeatureFrame =>
  makeFrame({ time: 0, progress: 0, isPlaying: true, bass: 0, mid: 0, high: 0, rmsEnergy: 0.5, onsetStrength: 0, beatDetected: false, currentSceneState: "active", bassHit: 0, ...o });

function stepResponse(h: Harness, sig: Harness["signals"][number]) {
  const a = h.create();
  for (let i = 0; i < 120; i++) h.step(a, frame({ time: i * DT }), DT); // settle on silence
  const v0 = sig.get(a);
  const series: number[] = [];
  for (let i = 0; i < 240; i++) {
    h.step(a, frame({ time: 2 + i * DT, [sig.band]: 1 }), DT);
    series.push(sig.get(a));
  }
  const v1 = series[series.length - 1];
  const span = v1 - v0;
  if (!(Math.abs(span) > 1e-6)) return { rise63: NaN, rise90: NaN, span: 0 };
  const at = (frac: number) => {
    const i = series.findIndex((v) => (v - v0) / span >= frac);
    return i < 0 ? NaN : (i + 1) * DT;
  };
  return { rise63: at(0.63), rise90: at(0.9), span };
}

const PUBLIC = join(dirname(fileURLToPath(import.meta.url)), "..", "public");
function serveFromDisk() {
  const real = globalThis.fetch;
  globalThis.fetch = (async (url: string | URL | Request) => {
    try { return new Response(readFileSync(join(PUBLIC, String(url).replace(/^\//, ""))), { status: 200 }); }
    catch { return new Response("not found", { status: 404 }); }
  }) as typeof fetch;
  return () => { globalThis.fetch = real; };
}
const mean = (a: number[]) => a.reduce((s, v) => s + v, 0) / a.length;
const std = (a: number[]) => { const m = mean(a); return Math.sqrt(mean(a.map((v) => (v - m) ** 2))); };
const corr = (a: number[], b: number[]) => { const ma = mean(a), mb = mean(b), sa = std(a), sb = std(b); if (!(sa > 1e-9 && sb > 1e-9)) return 0; let s = 0; for (let i = 0; i < a.length; i++) s += (a[i] - ma) * (b[i] - mb); return s / (a.length * sa * sb); };
const pct = (a: number[], p: number) => [...a].sort((x, y) => x - y)[Math.min(a.length - 1, Math.floor(p * a.length))];

async function detty(): Promise<AudioFeatureFrame[]> {
  const restore = serveFromDisk();
  try {
    let ms = 0;
    const src = await loadOfflineSource({ manifestUrl: "/motion/manifest.json", songId: "detty", now: () => ms });
    await src.play();
    const out: AudioFeatureFrame[] = [];
    for (let i = 0; i < 100 * 60; i++) { out.push(src.sample(ms / 1000)); ms += 1000 / 60; }
    src.dispose();
    return out;
  } finally { restore(); }
}

const frames = await detty();
const report: Record<string, unknown>[] = [];
for (const h of HARNESS) {
  const a = h.create();
  const series = h.signals.map(() => [] as number[]);
  for (const f of frames) { h.step(a, f, DT); h.signals.forEach((s, i) => series[i].push(s.get(a))); }
  h.signals.forEach((s, i) => {
    const input = frames.map((f) => f[s.band]);
    const out = series[i];
    let bestLag = 0, best = -2;
    for (let lag = 0; lag <= 24; lag++) { // 0..400 ms
      const c = corr(input.slice(0, input.length - lag), out.slice(lag));
      if (c > best) { best = c; bestLag = lag; }
    }
    const k = 6; // 100 ms
    const dIn: number[] = [], dOut: number[] = [];
    for (let j = k; j < input.length; j++) { dIn.push(input[j] - input[j - k]); dOut.push(out[j] - out[j - k]); }
    const sr = stepResponse(h, s);
    report.push({
      scene: h.scene, signal: s.name, band: s.band,
      rise63_ms: Math.round(sr.rise63 * 1000), rise90_ms: Math.round(sr.rise90 * 1000),
      lag_ms: Math.round((bestLag * 1000) / 60), fit: +best.toFixed(3),
      range: +(pct(out, 0.95) - pct(out, 0.05)).toFixed(3), inputRange: +(pct(input, 0.95) - pct(input, 0.05)).toFixed(3),
      dcorr: +corr(dIn, dOut).toFixed(3),
    });
  });
}
console.log("scene".padEnd(20) + "signal".padEnd(12) + "band".padEnd(6) + "rise63".padStart(8) + "rise90".padStart(8) + "lag".padStart(7) + "fit".padStart(7) + "range".padStart(8) + "(input)".padStart(9) + "dcorr".padStart(8));
for (const r of report as Record<string, number | string>[]) {
  console.log(String(r.scene).padEnd(20) + String(r.signal).padEnd(12) + String(r.band).padEnd(6) + `${r.rise63_ms}ms`.padStart(8) + `${r.rise90_ms}ms`.padStart(8) + `${r.lag_ms}ms`.padStart(7) + String(r.fit).padStart(7) + String(r.range).padStart(8) + String(r.inputRange).padStart(9) + String(r.dcorr).padStart(8));
}
if (process.argv[2]) writeFileSync(process.argv[2], JSON.stringify(report, null, 2));
