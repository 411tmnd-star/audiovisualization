"use client";

import { useEffect, useRef, useState } from "react";

import { createScoreAnim, stepScoreAnim, type ScoreAnim } from "@/lib/score/animator";
import { ScoreHistory } from "@/lib/score/history";
import { toScoreParams, type ScoreParams } from "@/lib/score/params";
import { ScoreScene } from "@/lib/score/scene";
import { GlHost } from "@/lib/gl/host";
import type { GlStatus } from "@/lib/gl/state";
import { useResponse } from "@/components/gl/response";
import { useAudioFrame, useAudioPipeline } from "@/lib/pipeline/react";

/** Frame-timing history kept for diagnostics: the last RING frame intervals and drawing times, in milliseconds. */
const RING = 1200;
/** The scene's background colour; matches the experience's container so the canvas edge is invisible. */
const CLEAR_COLOUR = 0x03040a;

export interface ScoreDebug {
  host: GlHost;
  scene: ScoreScene;
  history: ScoreHistory;
  anim: ScoreAnim;
  lastParams: ScoreParams | null;
  /** Interval between consecutive frame callbacks, ms (what the viewer sees). */
  intervals: Float64Array;
  /** Main-thread time to record, step, update and submit one frame, ms. */
  cpu: Float64Array;
  frames: number;
}

/**
 * The Score scene on the shared WebGL host. One frame clock: it draws inside the audio pipeline's frame callback and has no
 * loop of its own. Per frame: the frame is offered to the history (which decides whether it is a new sample or an onset), the
 * displayed clock steps, uniforms are written, and one draw is submitted. The camera is fixed: Score has no drag-to-orbit,
 * because the right-to-left scroll is its only motion.
 */
export default function ScoreCanvas({ className = "", debugRef, decor = true }: { className?: string; debugRef?: { current: ScoreDebug | null }; decor?: boolean }) {
  const pipeline = useAudioPipeline();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const hostRef = useRef<GlHost | null>(null);
  const sceneRef = useRef<ScoreScene | null>(null);
  const [history] = useState(() => new ScoreHistory());
  const [anim] = useState(createScoreAnim);
  const lastSource = useRef<unknown>(undefined);
  const size = useRef({ w: 0, h: 0, pr: 0 });
  const [timing] = useState(() => ({ last: 0, intervals: new Float64Array(RING), cpu: new Float64Array(RING), frames: 0 }));
  const debug = useRef<ScoreDebug | null>(null);
  const [status, setStatus] = useState<GlStatus>("ready");

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const host = new GlHost({
      canvas,
      onStatus: (s) => {
        setStatus(s);
        // Release the scene's records of the old context while it is lost; the next update re-fills and re-uploads them.
        if (s === "lost") sceneRef.current?.releaseGpu();
      },
      // Three.js rebuilds its background state on a restore and forgets the clear colour (it reverts to black), so set it again.
      onRestored: () => hostRef.current?.three?.setClearColor(CLEAR_COLOUR, 1),
    });
    host.three?.setClearColor(CLEAR_COLOUR, 1);
    const scene = new ScoreScene({ decor });
    hostRef.current = host;
    sceneRef.current = scene;
    size.current = { w: 0, h: 0, pr: 0 };
    timing.last = 0;
    setStatus(host.status);
    debug.current = { host, scene, history, anim, lastParams: null, intervals: timing.intervals, cpu: timing.cpu, frames: 0 };
    if (debugRef) debugRef.current = debug.current;
    return () => {
      hostRef.current = null;
      sceneRef.current = null;
      debug.current = null;
      if (debugRef) debugRef.current = null;
      scene.dispose();
      host.dispose();
    };
  }, [anim, debugRef, history, timing, decor]);

  const shape = useResponse();
  useAudioFrame((f) => {
    const host = hostRef.current;
    const scene = sceneRef.current;
    const canvas = canvasRef.current;
    if (!host || !scene || !canvas) return;
    const t0 = performance.now();
    const dt = timing.last ? (t0 - timing.last) / 1000 : 1 / 60;
    if (timing.last) timing.intervals[timing.frames % RING] = t0 - timing.last;
    timing.last = t0;

    // A different source is a different timeline: forget the old record before the new source's first frame is offered.
    if (pipeline.source !== lastSource.current) {
      if (lastSource.current !== undefined) history.reset();
      lastSource.current = pipeline.source;
    }
    const g = shape(f, dt);
    const p = toScoreParams(g, host.reducedMotion);
    history.push(g);
    stepScoreAnim(anim, p, f.time, dt);

    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    const pr = host.pixelRatioInUse;
    const s = size.current;
    if (w !== s.w || h !== s.h || pr !== s.pr) {
      scene.setViewport(w, h, pr);
      s.w = w;
      s.h = h;
      s.pr = pr;
    }
    scene.update(history, anim, p);
    host.render(scene.scene, scene.camera);
    timing.cpu[timing.frames % RING] = performance.now() - t0;
    timing.frames++;
    const d = debug.current;
    if (d) {
      d.lastParams = p;
      d.frames = timing.frames;
    }
  });

  return (
    // The canvas is out of the layout (absolute), so its size follows the container and never the other way.
    <div data-gl-status={status} className={className} style={{ position: "relative", width: "100%", height: "100%" }}>
      <canvas
        ref={canvasRef}
        role="img"
        aria-label="Score: a precision temporal instrument. Three horizontal lanes record the music as it plays and scroll from right to left: bass in amber as a weighted envelope, mids in cyan as a smooth trace, highs in violet as a fine trace. Detected onsets are marked as thin vertical rules that travel with the history. A time grid marks each second."
        style={{ position: "absolute", inset: 0 }}
      />
      {status === "lost" && (
        <p role="status" className="pointer-events-none absolute inset-x-0 bottom-0 p-4 text-center text-xs text-slate-400">
          The graphics context was lost. The scene resumes when the browser restores it.
        </p>
      )}
      {status === "unsupported" && (
        <p role="alert" className="relative p-6 text-sm text-slate-300">
          WebGL is not available in this browser, so Score cannot be drawn. The other Motion Lab visuals do not need it.
        </p>
      )}
    </div>
  );
}
