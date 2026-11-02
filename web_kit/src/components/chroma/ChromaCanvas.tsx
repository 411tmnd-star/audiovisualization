"use client";

import { useEffect, useRef, useState } from "react";

import { createChromaAnim, resetChromaAnim, stepChromaAnim, type ChromaAnim } from "@/lib/chroma/animator";
import type { Quality } from "@/lib/chroma/field";
import { toChromaParams, type ChromaParams } from "@/lib/chroma/params";
import { ChromaScene } from "@/lib/chroma/scene";
import { GlHost } from "@/lib/gl/host";
import type { GlStatus } from "@/lib/gl/state";
import { useResponse } from "@/components/gl/response";
import { useAudioFrame, useAudioPipeline } from "@/lib/pipeline/react";

/** Frame-timing history kept for diagnostics: the last RING frame intervals and drawing times, in milliseconds. */
const RING = 1200;
/** The scene's background colour; matches the experience's container so the canvas edge is invisible. */
const CLEAR_COLOUR = 0x02030a;

export interface ChromaDebug {
  host: GlHost;
  scene: ChromaScene;
  anim: ChromaAnim;
  lastParams: ChromaParams | null;
  /** Interval between consecutive frame callbacks, ms (what the viewer sees). */
  intervals: Float64Array;
  /** Main-thread time to record, step, update and submit one frame, ms. */
  cpu: Float64Array;
  frames: number;
}

/**
 * The Chroma Field scene on the shared WebGL host. One frame clock: it draws inside the audio pipeline frame callback and has no
 * loop of its own. Per frame: the animator steps (envelopes, flow phase, onsets), uniforms are written, and one draw is submitted.
 * The camera follows a slow dolly path that is a pure function of the visual clock; there is no drag-to-orbit.
 */
export default function ChromaCanvas({ className = "", debugRef, quality = "full" }: { className?: string; debugRef?: { current: ChromaDebug | null }; quality?: Quality }) {
  const pipeline = useAudioPipeline();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const hostRef = useRef<GlHost | null>(null);
  const sceneRef = useRef<ChromaScene | null>(null);
  const [anim] = useState(createChromaAnim);
  const lastSource = useRef<unknown>(undefined);
  const size = useRef({ w: 0, h: 0, pr: 0 });
  const [timing] = useState(() => ({ last: 0, intervals: new Float64Array(RING), cpu: new Float64Array(RING), frames: 0 }));
  const debug = useRef<ChromaDebug | null>(null);
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
    const scene = new ChromaScene({ quality });
    hostRef.current = host;
    sceneRef.current = scene;
    size.current = { w: 0, h: 0, pr: 0 };
    timing.last = 0;
    setStatus(host.status);
    debug.current = { host, scene, anim, lastParams: null, intervals: timing.intervals, cpu: timing.cpu, frames: 0 };
    if (debugRef) debugRef.current = debug.current;
    return () => {
      hostRef.current = null;
      sceneRef.current = null;
      debug.current = null;
      if (debugRef) debugRef.current = null;
      scene.dispose();
      host.dispose();
    };
  }, [anim, debugRef, timing, quality]);

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
      if (lastSource.current !== undefined) resetChromaAnim(anim);
      lastSource.current = pipeline.source;
    }
    const g = shape(f, dt);
    const p = toChromaParams(g, host.reducedMotion);
    stepChromaAnim(anim, p, dt);

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
    scene.update(anim, p);
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
    <div data-gl-status={status} data-quality={quality} className={className} style={{ position: "relative", width: "100%", height: "100%" }}>
      <canvas
        ref={canvasRef}
        role="img"
        aria-label="Chroma Field: a volume of drifting colour and particles in a dark void. Bass swells and thickens the cloud in indigo and magenta, mids swirl teal filaments through it, highs add fine pink sparkle and colour dispersion, and each detected onset sends a dispersion burst through the volume."
        style={{ position: "absolute", inset: 0 }}
      />
      {status === "lost" && (
        <p role="status" className="pointer-events-none absolute inset-x-0 bottom-0 p-4 text-center text-xs text-slate-400">
          The graphics context was lost. The scene resumes when the browser restores it.
        </p>
      )}
      {status === "unsupported" && (
        <p role="alert" className="relative p-6 text-sm text-slate-300">
          WebGL is not available in this browser, so Chroma Field cannot be drawn. The other Motion Lab visuals do not need it.
        </p>
      )}
    </div>
  );
}
