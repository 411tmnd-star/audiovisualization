"use client";

import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";

import { createAccretionAnim, stepAccretionAnim, type AccretionAnim } from "@/lib/accretion/animator";
import { toAccretionParams, type AccretionParams } from "@/lib/accretion/params";
import { AccretionScene, type AccretionView } from "@/lib/accretion/scene";
import { GlHost } from "@/lib/gl/host";
import type { GlStatus } from "@/lib/gl/state";
import { useResponse } from "@/components/gl/response";
import { useAudioFrame } from "@/lib/pipeline/react";

/** Frame-timing history kept for diagnostics: the last RING frame intervals and drawing times, in milliseconds. */
const RING = 1200;

export interface AccretionDebug {
  host: GlHost;
  scene: AccretionScene;
  anim: AccretionAnim;
  lastParams: AccretionParams | null;
  /** Interval between consecutive frame callbacks, ms (what the viewer sees). */
  intervals: Float64Array;
  /** Main-thread time to step, update and submit one frame, ms. */
  cpu: Float64Array;
  frames: number;
}

/**
 * The Accretion scene on the shared WebGL host. One frame clock: it draws inside the audio pipeline's frame callback
 * and has no loop of its own. Per frame: pure params, then the stateful animator, then uniforms, then one draw.
 */
export default function AccretionCanvas({ className = "", debugRef }: { className?: string; debugRef?: { current: AccretionDebug | null } }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const hostRef = useRef<GlHost | null>(null);
  const sceneRef = useRef<AccretionScene | null>(null);
  const [anim] = useState(createAccretionAnim);
  const view = useRef<AccretionView>({ azimuth: 0, elevation: 0 });
  const drag = useRef<{ x: number; y: number; az: number; el: number } | null>(null);
  const size = useRef({ w: 0, h: 0, pr: 0 });
  const [timing] = useState(() => ({ last: 0, intervals: new Float64Array(RING), cpu: new Float64Array(RING), frames: 0 }));
  const debug = useRef<AccretionDebug | null>(null);
  const [status, setStatus] = useState<GlStatus>("ready");

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const host = new GlHost({
      canvas,
      onStatus: (s) => {
        setStatus(s);
        // Release the scene's records of the old context while it is lost; the next draw re-uploads them.
        if (s === "lost") sceneRef.current?.releaseGpu();
      },
    });
    host.three?.setClearColor(0x020308, 1);
    const scene = new AccretionScene();
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
  }, [anim, debugRef, timing]);

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

    const reduced = host.reducedMotion;
    const g = shape(f, dt);
    const p = toAccretionParams(g, reduced);
    stepAccretionAnim(anim, p, dt, reduced);

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
    scene.update(anim, view.current);
    host.render(scene.scene, scene.camera);
    timing.cpu[timing.frames % RING] = performance.now() - t0;
    timing.frames++;
    const d = debug.current;
    if (d) {
      d.lastParams = p;
      d.frames = timing.frames;
    }
  });

  // Drag to orbit. The view offset is added to the slow automatic drift.
  const onPointerDown = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { x: e.clientX, y: e.clientY, az: view.current.azimuth, el: view.current.elevation };
  };
  const onPointerMove = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    const d = drag.current;
    if (!d) return;
    view.current.azimuth = d.az - (e.clientX - d.x) * 0.006;
    view.current.elevation = Math.min(0.9, Math.max(-0.15, d.el + (e.clientY - d.y) * 0.004));
  };
  const onPointerEnd = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    drag.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
  };

  return (
    // The canvas is out of the layout (absolute), so its size follows the container and never the other way.
    <div data-gl-status={status} className={className} style={{ position: "relative", width: "100%", height: "100%" }}>
      <canvas
        ref={canvasRef}
        role="img"
        aria-label="Accretion: a black hole and its disk, driven by the audio. Bass brightens the ring and swells the dark centre, mids turn and stir the disk, bass hits fire the jets and detected beats flare the disk. Drag to orbit."
        style={{ position: "absolute", inset: 0, touchAction: "none", cursor: "grab" }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerEnd}
        onPointerCancel={onPointerEnd}
      />
      {status === "lost" && (
        <p role="status" className="pointer-events-none absolute inset-x-0 bottom-0 p-4 text-center text-xs text-slate-400">
          The graphics context was lost. The scene resumes when the browser restores it.
        </p>
      )}
      {status === "unsupported" && (
        <p role="alert" className="relative p-6 text-sm text-slate-300">
          WebGL is not available in this browser, so Accretion cannot be drawn. The other Motion Lab visuals do not need it.
        </p>
      )}
    </div>
  );
}
