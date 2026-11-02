import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { BandShaper, MAX_DT_S, PUNCH_DECAY_S, ResponseShaper, SPAN_MIN, punchOf } from "../src/lib/audio/shaping";
import { makeFrame, type AudioFeatureFrame } from "../src/lib/pipeline/contract";

const DT = 1 / 60;
const frame = (o: Partial<AudioFeatureFrame> = {}): AudioFeatureFrame =>
  makeFrame({ time: 0, progress: 0, isPlaying: true, bass: 0, mid: 0, high: 0, rmsEnergy: 0.5, onsetStrength: 0, beatDetected: false, currentSceneState: "active", bassHit: 0, ...o });
const pct = (a: number[], p: number) => [...a].sort((x, y) => x - y)[Math.min(a.length - 1, Math.floor(p * a.length))];

describe("auto-gain", () => {
  it("silence stays silent: no level and no punch, however long it lasts", () => {
    const b = new BandShaper();
    for (let i = 0; i < 60 * 30; i++) {
      assert.equal(b.step(0, DT, true), 0);
      assert.equal(b.punch, 0);
    }
  });

  it("a narrow band is expanded to use most of 0..1 (the Detty mid band spans about 0.19)", () => {
    const b = new BandShaper();
    const out: number[] = [];
    for (let i = 0; i < 60 * 30; i++) {
      const x = 0.05 + 0.19 * (0.5 + 0.5 * Math.sin(i * 0.05));
      const y = b.step(x, DT, true);
      if (i > 60 * 12) out.push(y);
    }
    const spread = pct(out, 0.95) - pct(out, 0.05);
    assert.ok(spread > 0.6, `shaped spread ${spread.toFixed(2)} from an input spread of about 0.18`);
    assert.ok(Math.min(...out) >= 0 && Math.max(...out) <= 1);
  });

  it("the gain is bounded: low-level noise is not blown up into motion", () => {
    const b = new BandShaper();
    let max = 0;
    for (let i = 0; i < 60 * 30; i++) max = Math.max(max, b.step(0.01 + 0.02 * Math.abs(Math.sin(i * 1.3)), DT, true));
    assert.ok(max < 0.2, `noise at 0.03 reached ${max.toFixed(3)}; the expansion is capped at 1/${SPAN_MIN}`);
  });

  it("a loud, wide band is left about as it was (it already uses the range)", () => {
    const b = new BandShaper();
    const diffs: number[] = [];
    for (let i = 0; i < 60 * 30; i++) {
      const x = 0.5 + 0.5 * Math.sin(i * 0.04);
      const y = b.step(x, DT, true);
      if (i > 60 * 12) diffs.push(Math.abs(y - x));
    }
    assert.ok(pct(diffs, 0.9) < 0.15, `90th percentile change ${pct(diffs, 0.9).toFixed(3)}`);
  });

  it("a constant signal is shown as it is (there is no range to stretch), however long it holds", () => {
    for (const x of [0.1, 0.3, 0.6, 0.95]) {
      const b = new BandShaper();
      let y = 0;
      for (let i = 0; i < 60 * 40; i++) y = b.step(x, DT, true);
      assert.ok(Math.abs(y - x) < 0.02, `constant ${x} is shown as ${y.toFixed(3)} after 40 s`);
    }
  });

  it("is bounded 0..1 for any input, including invalid numbers and huge steps", () => {
    const b = new BandShaper();
    for (const x of [NaN, Infinity, -Infinity, -3, 7, 0.5]) {
      for (const dt of [NaN, -1, 0, 1e-9, DT, 5, Infinity]) {
        const y = b.step(x, dt, true);
        assert.ok(Number.isFinite(y) && y >= 0 && y <= 1, `x ${x} dt ${dt} gave ${y}`);
        assert.ok(Number.isFinite(b.punch) && b.punch >= 0 && b.punch <= 1);
      }
    }
  });

  it("adaptation freezes while paused, so a pause does not widen the range", () => {
    const b = new BandShaper();
    for (let i = 0; i < 60 * 12; i++) b.step(0.3 + 0.2 * Math.sin(i * 0.05), DT, true);
    const c = b.ceil, f = b.floor;
    for (let i = 0; i < 60 * 20; i++) assert.equal(b.step(0, DT, false), 0);
    assert.equal(b.ceil, c);
    assert.equal(b.floor, f);
  });
});

describe("punch (the per-band transient)", () => {
  const settle = (b: BandShaper, x: number, seconds: number) => { for (let i = 0; i < 60 * seconds; i++) b.step(x, DT, true); };

  it("a sudden rise registers in the frame it happens and then decays", () => {
    const b = new BandShaper();
    settle(b, 0.1, 3);
    b.step(0.8, DT, true);
    assert.ok(b.punch > 0.7, `punch ${b.punch.toFixed(2)} on the first frame of a rise from 0.1 to 0.8`);
    for (let i = 0; i < 30; i++) b.step(0.8, DT, true); // 0.5 s later, still loud and steady
    assert.ok(b.punch < 0.05, `punch ${b.punch.toFixed(3)} half a second into a steady level`);
  });

  it("a steady level, loud or quiet, carries no punch", () => {
    for (const x of [0.05, 0.4, 0.9]) {
      const b = new BandShaper();
      settle(b, x, 4);
      assert.ok(b.punch < 0.01, `steady ${x} punch ${b.punch}`);
    }
  });

  it("a fall carries no punch (only rises are transients)", () => {
    const b = new BandShaper();
    settle(b, 0.9, 3);
    let max = 0;
    for (let i = 0; i < 60; i++) { b.step(Math.max(0, 0.9 - i * 0.05), DT, true); max = Math.max(max, b.punch); }
    assert.ok(max < 0.05, `punch ${max}`);
  });

  it("repeated kicks each register, scaled against the band's own recent peaks", () => {
    const b = new BandShaper();
    let hits = 0;
    for (let k = 0; k < 8; k++) {
      let peak = 0;
      for (let i = 0; i < 30; i++) { b.step(i < 3 ? 0.2 + i * 0.25 : Math.max(0.1, 0.9 - (i - 3) * 0.06), DT, true); peak = Math.max(peak, b.punch); }
      if (peak > 0.6) hits++;
    }
    assert.ok(hits >= 7, `${hits} of 8 kicks registered`);
  });

  it("decays with the stated time constant", () => {
    const b = new BandShaper();
    settle(b, 0.1, 3);
    b.step(0.9, DT, true);
    const p0 = b.punch;
    for (let i = 0; i < 60 * PUNCH_DECAY_S * 2; i++) b.step(0.9, DT, true);
    assert.ok(b.punch < p0 * 0.25, `${p0.toFixed(2)} -> ${b.punch.toFixed(3)} after two time constants`);
  });
});

describe("the shaper on frames", () => {
  it("returns the same shaped object for the same input object, and does not advance", () => {
    const s = new ResponseShaper();
    const f = frame({ bass: 0.5 });
    const a = s.shape(f, DT);
    const ceil = s.bass.ceil;
    assert.equal(s.shape(f, DT), a);
    assert.equal(s.bass.ceil, ceil);
    assert.notEqual(s.shape(frame({ bass: 0.5 }), DT), a, "a new frame is a new object");
  });

  it("does not mutate the input frame and keeps every other field", () => {
    const s = new ResponseShaper();
    const f = frame({ bass: 0.3, mid: 0.2, high: 0.1, rmsEnergy: 0.6, onsetStrength: 0.7, beatDetected: true, bassHit: 0.4, time: 12.5, currentSceneState: "build" });
    const g = s.shape(f, DT);
    assert.equal(f.bass, 0.3);
    for (const k of ["time", "progress", "isPlaying", "rmsEnergy", "onsetStrength", "beatDetected", "currentSceneState", "bassHit"] as const) assert.equal(g[k], f[k], k);
    assert.ok(g.bass >= 0 && g.bass <= 1 && typeof g.punch.bass === "number");
  });

  it("is deterministic and resets to its start", () => {
    const run = (s: ResponseShaper) => { const o: number[] = []; for (let i = 0; i < 600; i++) { const g = s.shape(frame({ bass: 0.5 + 0.4 * Math.sin(i * 0.1), mid: 0.2 + 0.1 * Math.sin(i * 0.07) }), DT); o.push(g.bass, g.mid, g.punch.bass, g.punch.mid); } return o; };
    const a = run(new ResponseShaper());
    const s = new ResponseShaper();
    run(s);
    s.reset();
    assert.deepEqual(run(s), a);
  });

  it("passes a paused frame through unchanged and fades the punch out", () => {
    const s = new ResponseShaper();
    for (let i = 0; i < 120; i++) s.shape(frame({ bass: 0.1 }), DT);
    s.shape(frame({ bass: 0.9 }), DT);
    for (let i = 0; i < 60; i++) {
      const g = s.shape(frame({ isPlaying: false, bass: 0.2 }), DT);
      assert.equal(g.bass, 0.2);
    }
    assert.ok(s.bass.punch < 0.01);
  });

  it("punchOf reads zero from a frame that was not shaped", () => {
    assert.deepEqual({ ...punchOf(frame()) }, { bass: 0, mid: 0, high: 0 });
    assert.ok(MAX_DT_S > 0);
  });
});
