// Acceptance checks for the shared scene stage (src/components/gl/SceneStage.tsx) and the GlHost StrictMode fix, on a GPU-enabled
// Chromium/Edge (preview/cdp-lib-gpu.mjs). From web_kit/:
//   node preview/build.mjs strict
//   node preview/serve-gl.mjs 5360         (or another port: STAGE_PORT=5361 node preview/stage-check.mjs)
//   node preview/stage-check.mjs [outDir]
// Every scene is mounted through preview/strict-entry.tsx: the real component, no props, inside React.StrictMode (the mount path a
// Next page takes in development, which tears each effect down and runs it again on the same canvas element).
// What it checks, per scene: the GL host comes up ready after the double mount; no console errors; the stage layout (a full-bleed
// canvas, the overlays inside the viewport, no horizontal scroll) at desktop and phone widths; the controls panel; Space plays and
// pauses; the source buttons keep their selectors; scene settings (where a scene has them) rebuild a ready scene.
// It does NOT judge how a scene looks or moves: screenshots are written for a person to look at. Exit 0 only if every check passed.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { launchGpu, sleep } from "./cdp-lib-gpu.mjs";

const OUT = process.argv[2] || "../scratch_shots/stage";
mkdirSync(OUT, { recursive: true });
const BASE = `http://localhost:${process.env.STAGE_PORT || 5360}`;
const SCENES = ["core", "resonator", "score", "chroma", "accretion"];
// Scenes that have panel settings, and the setting button that changes them.
const SETTINGS = { score: "overlay:off", resonator: "quality:lite", chroma: "quality:lite" };
const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  " + detail : ""}`);
};
let completed = false;
const b = await launchGpu({ port: Number(process.env.STAGE_CDP || 9611), width: 1280, height: 900 });

try {
  for (const scene of SCENES) {
    console.log(`\n== ${scene} ==`);
    await b.viewport(1280, 900, 1);
    b.events.length = 0;
    await b.goto(`${BASE}/strict?scene=${scene}`, "!!document.querySelector('[data-gl-status]')");
    await sleep(800);
    const status = await b.js("document.querySelector('[data-gl-status]').dataset.glStatus");
    check(`${scene}: GL host is ready after the StrictMode double mount`, status === "ready", `status ${status}`);
    check(`${scene}: no console errors or exceptions on mount`, b.events.filter((e) => e.kind !== "warning").length === 0, JSON.stringify(b.events.slice(0, 2)));

    // The empty state offers sources; the demo starts it.
    const hasEmpty = await b.js("!!document.querySelector('[data-empty] [data-source=demo]')");
    check(`${scene}: empty state offers the demo source`, hasEmpty);
    await b.js("document.querySelector('[data-empty] [data-source=demo]').click()");
    await sleep(1500);
    const playing = await b.js("document.querySelector('[data-play]').getAttribute('aria-pressed')");
    const clock = await b.js("document.querySelector('[data-clock]').textContent");
    check(`${scene}: Demo plays and the clock advances`, playing === "true" && clock !== "0:00.0", `play ${playing}, clock ${clock}`);
    check(`${scene}: empty state is gone once a source is chosen`, (await b.js("!document.querySelector('[data-empty]')")) === true);

    // Layout at desktop width.
    const lay = await b.js(`(() => {
      const s = document.querySelector('[data-stage]'), c = document.querySelector('canvas'), t = document.querySelector('[data-transport]');
      const sr = s.getBoundingClientRect(), cr = c.getBoundingClientRect(), tr = t.getBoundingClientRect();
      return { sw: sr.width, sh: sr.height, cw: cr.width, ch: cr.height, tBottom: tr.bottom, tTop: tr.top, vh: innerHeight, sx: document.scrollingElement.scrollWidth, vw: innerWidth };
    })()`);
    check(`${scene}: canvas spans the stage width and most of its height`, Math.abs(lay.cw - lay.sw) < 2 && lay.ch >= lay.sh - 100, JSON.stringify(lay));
    check(`${scene}: stage is at least 512 px tall`, lay.sh >= 512, `${lay.sh}`);
    check(`${scene}: transport is inside the viewport; no horizontal scroll`, lay.tBottom <= lay.vh && lay.sx <= lay.vw, `bottom ${lay.tBottom}/${lay.vh}, scrollWidth ${lay.sx}/${lay.vw}`);
    await b.shot(join(OUT, `${scene}-desktop.png`));

    // Space pauses and plays again.
    const key = async (k, code, vk) => {
      await b.send("Input.dispatchKeyEvent", { type: "keyDown", key: k, code, windowsVirtualKeyCode: vk, text: k });
      await b.send("Input.dispatchKeyEvent", { type: "keyUp", key: k, code, windowsVirtualKeyCode: vk });
    };
    await key(" ", "Space", 32);
    await sleep(500);
    const paused = await b.js("document.querySelector('[data-play]').getAttribute('aria-pressed')");
    await key(" ", "Space", 32);
    await sleep(500);
    const again = await b.js("document.querySelector('[data-play]').getAttribute('aria-pressed')");
    check(`${scene}: Space pauses, then plays`, paused === "false" && again === "true", `after first ${paused}, after second ${again}`);

    // Controls panel.
    await b.js("document.querySelector('[data-controls-toggle]').click()");
    await sleep(300);
    const rail = await b.js(`(() => {
      const r = document.querySelector('[data-rail]'); if (!r) return null; const q = r.getBoundingClientRect();
      return { l: q.left, r: q.right, t: q.top, b: q.bottom, vw: innerWidth, vh: innerHeight, sources: [...r.querySelectorAll('[data-source]')].map((x) => x.dataset.source), nudge: !!r.querySelector('#stage-nudge'), settings: [...r.querySelectorAll('[data-setting]')].map((x) => x.dataset.setting) };
    })()`);
    check(`${scene}: controls panel opens inside the viewport`, !!rail && rail.l >= 0 && rail.r <= rail.vw && rail.t >= 0 && rail.b <= rail.vh, JSON.stringify(rail));
    check(`${scene}: panel lists the sources, the sync nudge`, !!rail && rail.sources.includes("demo") && rail.sources.includes("mic") && rail.nudge, rail ? rail.sources.join(",") : "no rail");
    await b.shot(join(OUT, `${scene}-panel.png`));

    // Scene settings rebuild the scene, which must come back ready (a rebuild is a second host on the same canvas element).
    if (SETTINGS[scene]) {
      check(`${scene}: panel carries the scene setting ${SETTINGS[scene]}`, rail.settings.includes(SETTINGS[scene]), rail.settings.join(","));
      await b.js(`document.querySelector('[data-setting="${SETTINGS[scene]}"]').click()`);
      await sleep(900);
      const st = await b.js("document.querySelector('[data-gl-status]').dataset.glStatus");
      const on = await b.js(`document.querySelector('[data-setting="${SETTINGS[scene]}"]').getAttribute('aria-pressed')`);
      check(`${scene}: after changing the setting the scene is ready again`, st === "ready" && on === "true", `status ${st}, pressed ${on}`);
    } else {
      check(`${scene}: panel has no scene settings (none defined)`, rail.settings.length === 0, rail.settings.join(","));
    }
    await b.js("document.querySelector('[data-controls-toggle]').click()");

    // Phone width.
    await b.viewport(390, 800, 2);
    await sleep(700);
    const ph = await b.js(`(() => {
      const t = document.querySelector('[data-transport]').getBoundingClientRect(), s = document.querySelector('[data-stage]').getBoundingClientRect();
      return { tl: t.left, tr: t.right, tb: t.bottom, sx: document.scrollingElement.scrollWidth, vw: innerWidth, vh: innerHeight, sw: s.width, status: document.querySelector('[data-gl-status]').dataset.glStatus };
    })()`);
    check(`${scene}: phone width has no horizontal scroll and the transport fits`, ph.sx <= ph.vw && ph.tl >= 0 && ph.tr <= ph.vw && ph.tb <= ph.vh, JSON.stringify(ph));
    check(`${scene}: scene stays ready after the resize`, ph.status === "ready");
    await b.shot(join(OUT, `${scene}-phone.png`));
    await b.js("document.querySelector('[data-controls-toggle]').click()");
    await sleep(300);
    const prail = await b.js("(() => { const q = document.querySelector('[data-rail]').getBoundingClientRect(); return { l: q.left, r: q.right, b: q.bottom, vw: innerWidth, vh: innerHeight }; })()");
    check(`${scene}: phone panel fits inside the viewport`, prail.l >= 0 && prail.r <= prail.vw && prail.b <= prail.vh, JSON.stringify(prail));
    await b.shot(join(OUT, `${scene}-phone-panel.png`));
  }
  completed = true;
} catch (e) {
  console.log("CRASHED:", e && e.stack ? e.stack : e);
} finally {
  await b.close();
}
const passed = results.filter((r) => r.ok).length;
writeFileSync(join(OUT, "stage-check-report.json"), JSON.stringify({ completed, passed, total: results.length, results }, null, 2));
console.log(`\n${passed}/${results.length} checks passed${completed ? "" : " (INCOMPLETE: crashed)"}. Report: ${join(OUT, "stage-check-report.json")}`);
process.exit(completed && passed === results.length ? 0 : 1);
