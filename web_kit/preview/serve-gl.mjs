// Serves the WebGL harnesses (empty host and Accretion). Separate from serve.mjs so that the shared server stays unchanged.
// Usage (from web_kit/): node preview/serve-gl.mjs 5354
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
const root = new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".bin": "application/octet-stream" };
const port = Number(process.argv[2] || 5354);
const map = {
  "/glhost": "preview/glhost.html",
  "/glhost.js": "preview/dist/glhost.js",
  "/accretion": "preview/accretion.html",
  "/accretion.js": "preview/dist/accretion.js",
  "/accretion.css": "preview/dist/accretion.css",
  "/core": "preview/core.html",
  "/core.js": "preview/dist/core.js",
  "/core.css": "preview/dist/core.css",
  "/matrix": "preview/matrix.html",
  "/matrix.js": "preview/dist/matrix.js",
  "/matrix.css": "preview/dist/matrix.css",
  "/resonator": "preview/resonator.html",
  "/resonator.js": "preview/dist/resonator.js",
  "/resonator.css": "preview/dist/resonator.css",
  "/score": "preview/score.html",
  "/score.js": "preview/dist/score.js",
  "/score.css": "preview/dist/score.css",
  "/terrain": "preview/terrain.html",
  "/terrain.js": "preview/dist/terrain.js",
  "/terrain.css": "preview/dist/terrain.css",
  "/chroma": "preview/chroma.html",
  "/chroma.js": "preview/dist/chroma.js",
  "/chroma.css": "preview/dist/chroma.css",
  "/strict": "preview/strict.html",
  "/strict.js": "preview/dist/strict.js",
  "/strict.css": "preview/dist/strict.css",
};
createServer(async (req, res) => {
  const p = decodeURIComponent(new URL(req.url, "http://x").pathname);
  // Pre-computed songs for the shared SourcePicker are served read-only from public/motion.
  const file = map[p] ? join(root, map[p]) : p.startsWith("/motion/") ? join(root, "public", normalize(p)) : join(root, normalize(p));
  if (!map[p] && !p.startsWith("/preview/dist/") && !p.startsWith("/motion/")) { res.writeHead(404); res.end("not found"); return; }
  try { const body = await readFile(file); res.writeHead(200, { "content-type": types[extname(file)] ?? "application/octet-stream", "cache-control": "no-store" }); res.end(body); }
  catch { res.writeHead(404); res.end("not found: " + p); }
}).listen(port, () => console.log("WebGL harnesses on http://localhost:" + port + "/glhost and /accretion"));
