import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

import { MAX_PIXEL_RATIO, MIN_PIXEL_RATIO, INITIAL_GL_STATE, describeGl, drawSize, drawable, reduceGl, resolvePixelRatio, type GlEvent, type GlState } from "../src/lib/gl/state";

import { cancelRelease, releaseContext } from "../src/lib/gl/host";

const SRC = join(dirname(fileURLToPath(import.meta.url)), "..", "src", "lib", "gl");
const read = (f: string) => readFileSync(join(SRC, f), "utf8");

const run = (events: GlEvent[], from: GlState = INITIAL_GL_STATE) => events.reduce(reduceGl, from);

describe("GL host lifecycle state", () => {
  it("starts drawable and 'ready'", () => {
    assert.equal(drawable(INITIAL_GL_STATE), true);
    assert.equal(describeGl(INITIAL_GL_STATE), "ready");
  });

  it("each event blocks drawing and is named", () => {
    assert.equal(describeGl(run([{ type: "hidden", value: true }])), "hidden");
    assert.equal(describeGl(run([{ type: "active", value: false }])), "inactive");
    assert.equal(describeGl(run([{ type: "lost" }])), "lost");
    assert.equal(describeGl(run([{ type: "unsupported" }])), "unsupported");
    assert.equal(describeGl(run([{ type: "disposed" }])), "disposed");
    for (const e of [{ type: "hidden", value: true }, { type: "active", value: false }, { type: "lost" }, { type: "unsupported" }, { type: "disposed" }] as GlEvent[]) {
      assert.equal(drawable(run([e])), false, `${e.type} must block drawing`);
    }
  });

  it("a restore brings a lost context back to 'ready'", () => {
    const s = run([{ type: "lost" }, { type: "restored" }]);
    assert.equal(describeGl(s), "ready");
    assert.equal(drawable(s), true);
  });

  it("a restore does not revive an unsupported renderer", () => {
    const s = run([{ type: "unsupported" }, { type: "restored" }]);
    assert.equal(describeGl(s), "unsupported");
    assert.equal(drawable(s), false);
  });

  it("hidden and inactive are independent: both must clear before drawing resumes", () => {
    const both = run([{ type: "hidden", value: true }, { type: "active", value: false }]);
    assert.equal(drawable(both), false);
    assert.equal(drawable(run([{ type: "hidden", value: true }, { type: "active", value: false }, { type: "hidden", value: false }])), false);
    assert.equal(drawable(run([{ type: "hidden", value: true }, { type: "active", value: false }, { type: "hidden", value: false }, { type: "active", value: true }])), true);
  });

  it("disposal is final: nothing revives a disposed host", () => {
    const d = run([{ type: "disposed" }]);
    for (const e of [{ type: "restored" }, { type: "active", value: true }, { type: "hidden", value: false }, { type: "lost" }] as GlEvent[]) {
      const after = reduceGl(d, e);
      assert.equal(describeGl(after), "disposed");
      assert.equal(drawable(after), false);
    }
  });

  it("the name priority is disposed > unsupported > lost > hidden > inactive", () => {
    assert.equal(describeGl(run([{ type: "lost" }, { type: "hidden", value: true }, { type: "active", value: false }, { type: "unsupported" }])), "unsupported");
    assert.equal(describeGl(run([{ type: "lost" }, { type: "hidden", value: true }])), "lost");
    assert.equal(describeGl(run([{ type: "hidden", value: true }, { type: "active", value: false }])), "hidden");
  });

  it("a repeated event returns the same object (no spurious change)", () => {
    const h = run([{ type: "hidden", value: true }]);
    assert.equal(reduceGl(h, { type: "hidden", value: true }), h);
    assert.equal(reduceGl(INITIAL_GL_STATE, { type: "restored" }), INITIAL_GL_STATE);
    assert.equal(reduceGl(INITIAL_GL_STATE, { type: "active", value: true }), INITIAL_GL_STATE);
  });

  it("states are frozen, so no caller can change one in place", () => {
    assert.ok(Object.isFrozen(run([{ type: "lost" }])));
    assert.ok(Object.isFrozen(INITIAL_GL_STATE));
  });
});

describe("pixel-ratio policy", () => {
  it("uses the device ratio when it is within the limits", () => {
    assert.equal(resolvePixelRatio(1), 1);
    assert.equal(resolvePixelRatio(1.25), 1.25);
  });

  it("caps high ratios at the cap (1.5 by default)", () => {
    assert.equal(MAX_PIXEL_RATIO, 1.5);
    assert.equal(resolvePixelRatio(2), 1.5);
    assert.equal(resolvePixelRatio(3), 1.5);
    assert.equal(resolvePixelRatio(2, 1), 1);
  });

  it("the boundaries are exact: the cap and the floor are returned unchanged", () => {
    assert.equal(resolvePixelRatio(MAX_PIXEL_RATIO), MAX_PIXEL_RATIO);
    assert.equal(resolvePixelRatio(MIN_PIXEL_RATIO), MIN_PIXEL_RATIO);
  });

  it("raises very low ratios to the floor", () => {
    assert.equal(resolvePixelRatio(0.1), MIN_PIXEL_RATIO);
    assert.equal(resolvePixelRatio(0.49), MIN_PIXEL_RATIO);
  });

  it("invalid ratios fall back to 1, never to NaN or Infinity", () => {
    for (const bad of [0, -1, NaN, Infinity, -Infinity]) {
      assert.equal(resolvePixelRatio(bad), 1, `input ${bad}`);
    }
  });
});

describe("backing-store size", () => {
  it("floors the scaled CSS size, as Three.js does", () => {
    assert.deepEqual(drawSize(868.9, 608.2, 1), { width: 868, height: 608 });
    assert.deepEqual(drawSize(900, 640, 1.5), { width: 1350, height: 960 });
    assert.deepEqual(drawSize(901, 641, 1.5), { width: 1351, height: 961 });
  });

  it("never returns less than one pixel", () => {
    assert.deepEqual(drawSize(0, 0, 1), { width: 1, height: 1 });
    assert.deepEqual(drawSize(0.4, 0.4, 0.5), { width: 1, height: 1 });
  });
});

describe("ownership: the host has no loop of its own and releases what it adds", () => {
  const host = read("host.ts");
  const state = read("state.ts");

  it("neither file schedules frames or timers (the pipeline owns the frame clock)", () => {
    for (const forbidden of ["requestAnimationFrame(", "setAnimationLoop(", "setInterval(", "setTimeout(", "new AudioContext", "createAnalyser("]) {
      assert.equal(host.includes(forbidden), false, `host.ts must not contain ${forbidden}`);
      assert.equal(state.includes(forbidden), false, `state.ts must not contain ${forbidden}`);
    }
  });

  it("every listener the host adds is removed in dispose()", () => {
    const pairs = [...host.matchAll(/addEventListener\(\s*"([^"]+)"/g)].map((m) => m[1]);
    assert.ok(pairs.length >= 5, `expected at least 5 listeners, found ${pairs.length}`);
    for (const type of pairs) {
      const removed = new RegExp(`removeEventListener\\(\\s*"${type}"`).test(host);
      assert.ok(removed, `listener "${type}" is added but never removed`);
    }
  });

  it("dispose disconnects the resize observer and releases the renderer and its context", () => {
    const dispose = host.slice(host.indexOf("dispose(): void"));
    assert.ok(dispose.includes("resizeObserver?.disconnect()"));
    assert.ok(dispose.includes("this.renderer.dispose()"));
    // The context is released through releaseContext (deferred one microtask so a StrictMode remount can keep it); the helper itself
    // is what calls forceContextLoss. Changed from asserting the literal call in dispose(); the behaviour is tested below.
    assert.ok(dispose.includes("releaseContext(this.canvas, this.renderer)"));
    assert.ok(host.includes("renderer.forceContextLoss()"));
    assert.ok(dispose.includes('this.dispatch({ type: "disposed" })'));
  });

  it("the host never removes the consumer's canvas", () => {
    assert.equal(/removeChild|\.remove\(\)|replaceWith/.test(host), false);
  });
});

describe("context release is deferred so a same-canvas remount (React StrictMode) keeps its context", () => {
  const fake = () => {
    const r = { lost: 0, forceContextLoss() { this.lost++; } };
    return r;
  };
  const tick = () => new Promise<void>((res) => queueMicrotask(res));

  it("a real unmount still releases the context, one microtask later", async () => {
    const canvas = {};
    const r = fake();
    releaseContext(canvas, r);
    assert.equal(r.lost, 0, "not synchronous");
    await tick();
    assert.equal(r.lost, 1);
  });

  it("a host created on the same canvas before the microtask cancels the release", async () => {
    const canvas = {};
    const r = fake();
    releaseContext(canvas, r);
    assert.equal(cancelRelease(canvas), true);
    await tick();
    await tick();
    assert.equal(r.lost, 0);
    assert.equal(cancelRelease(canvas), false, "nothing left to cancel");
  });

  it("cancelling one canvas does not keep another's context alive", async () => {
    const a = {};
    const b = {};
    const ra = fake();
    const rb = fake();
    releaseContext(a, ra);
    releaseContext(b, rb);
    cancelRelease(a);
    await tick();
    assert.equal(ra.lost, 0);
    assert.equal(rb.lost, 1);
  });

  it("a release after a cancelled one is not swallowed", async () => {
    const canvas = {};
    const first = fake();
    const second = fake();
    releaseContext(canvas, first);
    cancelRelease(canvas);
    releaseContext(canvas, second);
    await tick();
    assert.equal(first.lost, 0);
    assert.equal(second.lost, 1);
  });
});
