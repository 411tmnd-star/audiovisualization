// Records a short GIF of each visual playing the synthetic demo, from the built site (run build-site.mjs first):
//   node scripts/capture-media.mjs [outDir]      (needs Microsoft Edge and ffmpeg on PATH)
import { execFileSync } from "node:child_process";
import { createServer } from "node:http";
import { mkdirSync, readFileSync, rmSync, writeFileSync, existsSync, statSync } from "node:fs";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { launchGpu, sleep } from "../preview/cdp-lib-gpu.mjs";

const root = join(fileURLToPath(new URL("..", import.meta.url)));
const site = join(root, "site");
const outDir = process.argv[2] || join(root, "..", "docs", "media");
const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".png": "image/png", ".bin": "application/octet-stream" };
const server = createServer((req, res) => {
  let p = normalize(decodeURIComponent(new URL(req.url, "http://x").pathname));
  let f = join(site, p);
  if (existsSync(f) && statSync(f).isDirectory()) f = join(f, "index.html");
  if (!f.startsWith(site) || !existsSync(f)) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { "content-type": types[extname(f)] ?? "application/octet-stream" }); res.end(readFileSync(f));
}).listen(8091);

mkdirSync(outDir, { recursive: true });
const SECONDS = 6;
// Busy scenes (fine lines, particles) compress badly, so they get a smaller, lighter encode.
const encode = { core: [12, 720, 128], accretion: [12, 720, 128], squall: [8, 560, 48] };
const b = await launchGpu({ port: 9611, width: 1000, height: 700 });
await b.viewport(1000, 700, 1);
for (const id of ["core", "accretion", "squall"]) {
  await b.goto(`http://localhost:8091/${id}/`, "!!document.querySelector('canvas')");
  await sleep(800);
  await b.js(`(() => { const el = document.querySelector('[data-source=demo]') || [...document.querySelectorAll('button')].find((x) => x.textContent.trim() === 'Demo'); if (el) el.click(); return !!el; })()`);
  await sleep(2500);
  const tmp = join(outDir, `.frames-${id}`);
  rmSync(tmp, { recursive: true, force: true }); mkdirSync(tmp, { recursive: true });
  const frames = [];
  b.listeners.push((d) => {
    if (d.method !== "Page.screencastFrame") return;
    const n = frames.length; const file = join(tmp, `f${String(n).padStart(4, "0")}.jpg`);
    writeFileSync(file, Buffer.from(d.params.data, "base64"));
    frames.push({ file, t: d.params.metadata.timestamp });
    b.send("Page.screencastFrameAck", { sessionId: d.params.sessionId }).catch(() => {});
  });
  await b.send("Page.startScreencast", { format: "jpeg", quality: 80, maxWidth: 1000, maxHeight: 700, everyNthFrame: 1 });
  await sleep(SECONDS * 1000);
  await b.send("Page.stopScreencast");
  b.listeners.length = 0;
  const list = frames.map((f, i) => `file '${f.file.split("\\").join("/")}'\nduration ${Math.max(0.02, (frames[i + 1]?.t ?? f.t + 0.05) - f.t).toFixed(4)}`).join("\n");
  writeFileSync(join(tmp, "list.txt"), list + `\nfile '${frames.at(-1).file.split("\\").join("/")}'\n`);
  const gif = join(outDir, `${id}.gif`);
  execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", join(tmp, "list.txt"),
    "-vf", `fps=${encode[id][0]},scale=${encode[id][1]}:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=${encode[id][2]}[p];[b][p]paletteuse=dither=bayer:bayer_scale=5`, "-loop", "0", gif]);
  rmSync(tmp, { recursive: true, force: true });
  console.log(id, frames.length, "frames ->", gif, (statSync(gif).size / 1048576).toFixed(1) + " MB");
}
await b.close(); server.close();
