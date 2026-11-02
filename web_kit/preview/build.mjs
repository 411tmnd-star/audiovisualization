// Builds every preview bundle: node preview/build.mjs [app instrument squall accretion glhost core matrix resonator score terrain chroma strict]
import { build } from "esbuild";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const targets = { app: "entry.tsx", instrument: "instrument-entry.tsx", squall: "squall-entry.tsx", accretion: "accretion-entry.tsx", glhost: "glhost-entry.tsx", core: "core-entry.tsx", matrix: "matrix-entry.tsx", resonator: "resonator-entry.tsx", score: "score-entry.tsx", terrain: "terrain-entry.tsx", chroma: "chroma-entry.tsx", strict: "strict-entry.tsx" };
const css = { app: "input.css", instrument: "input.css", squall: "input.css", accretion: "input.css", glhost: "input.css", core: "input.css", matrix: "input.css", resonator: "input.css", score: "input.css", terrain: "input.css", chroma: "input.css", strict: "input.css" };
const want = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(targets);

for (const name of want) {
  if (!targets[name]) throw new Error("unknown target " + name);
  await build({
    entryPoints: [join(root, "preview", targets[name])],
    bundle: true,
    outfile: join(root, "preview", "dist", name + ".js"),
    jsx: "automatic",
    alias: { "@": join(root, "src") },
    define: { "process.env.NODE_ENV": '"development"' },
    logLevel: "warning",
  });
  execFileSync(process.execPath, [join(root, "node_modules", "tailwindcss", "lib", "cli.js"), "-c", join(root, "tailwind.config.cjs"), "-i", join(root, "preview", css[name]), "-o", join(root, "preview", "dist", name + ".css")], { stdio: "inherit" });
  console.log("built", name);
}
