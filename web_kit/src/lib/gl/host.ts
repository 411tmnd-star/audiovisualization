import * as THREE from "three";

import { describeGl, drawable, INITIAL_GL_STATE, MAX_PIXEL_RATIO, reduceGl, resolvePixelRatio, type GlEvent, type GlState, type GlStatus } from "./state";

/**
 * A WebGL renderer that a visualizer owns for its lifetime.
 *
 * It has no animation loop. The consumer calls `render` from the shared audio pipeline (useAudioFrame), so there
 * is one frame clock for the whole page. It creates and removes its own listeners, and `dispose` releases all of
 * them along with the GPU context. The canvas belongs to the consumer and is never removed here.
 */

/** Module-level counts, so a test can check that every host created was also disposed. */
export const hostStats = { created: 0, disposed: 0 };

/** Releases waiting one microtask, by canvas. See `releaseContext`. */
const pendingRelease = new WeakMap<object, { cancelled: boolean }>();

/**
 * Gives the browser its WebGL context back, one microtask after dispose. The canvas belongs to the consumer, and React StrictMode
 * (Next's development mode) tears an effect down and re-runs it at once on the same canvas element. A context lost on teardown stays
 * lost for that element, so the second mount would find no usable context. A host created on the same canvas before the microtask
 * runs cancels the release and reuses the live context. A real unmount releases it a microtask later, as before. It is a single
 * deferred call, not a timer or a loop.
 */
export function releaseContext(canvas: object, renderer: { forceContextLoss(): void }): void {
  const job = { cancelled: false };
  pendingRelease.set(canvas, job);
  queueMicrotask(() => {
    if (pendingRelease.get(canvas) === job) pendingRelease.delete(canvas);
    if (!job.cancelled) renderer.forceContextLoss();
  });
}

/** Cancels a release that is still waiting for this canvas. Returns whether there was one. */
export function cancelRelease(canvas: object): boolean {
  const job = pendingRelease.get(canvas);
  if (!job) return false;
  job.cancelled = true;
  pendingRelease.delete(canvas);
  return true;
}

export interface GlHostOptions {
  canvas: HTMLCanvasElement;
  /** Device-pixel-ratio cap. Defaults to MAX_PIXEL_RATIO. */
  maxPixelRatio?: number;
  /** Called only when the coarse status changes (ready, hidden, lost, and so on), never per frame. */
  onStatus?: (status: GlStatus) => void;
  /** Called after a lost context is restored. The consumer rebuilds its own GPU resources here. */
  onRestored?: () => void;
}

export class GlHost {
  private renderer: THREE.WebGLRenderer | null = null;
  private state: GlState = INITIAL_GL_STATE;
  private reduced = false;
  private frames = 0;
  private cssWidth = 0;
  private cssHeight = 0;
  private pixelRatio = 1;
  private dprSeen = 0;
  private readonly canvas: HTMLCanvasElement;
  private readonly opts: GlHostOptions;
  private resizeObserver: ResizeObserver | null = null;
  private motionQuery: MediaQueryList | null = null;

  private readonly onWindowResize = () => this.fit();
  private readonly onVisibility = () => this.dispatch({ type: "hidden", value: document.hidden });
  private readonly onMotionChange = (e: MediaQueryListEvent) => {
    this.reduced = e.matches;
  };
  private readonly onContextLost = (e: Event) => {
    // Preventing the default lets the browser restore the context later.
    e.preventDefault();
    this.dispatch({ type: "lost" });
  };
  private readonly onContextRestored = () => {
    this.dispatch({ type: "restored" });
    this.fit();
    this.opts.onRestored?.();
  };

  constructor(opts: GlHostOptions) {
    this.opts = opts;
    this.canvas = opts.canvas;
    // The canvas takes its CSS size from its container. Three.js sets the canvas's width and height attributes,
    // and without this a canvas's layout size follows those attributes, which causes a resize feedback loop.
    this.canvas.style.width = "100%";
    this.canvas.style.height = "100%";
    this.motionQuery = typeof window.matchMedia === "function" ? window.matchMedia("(prefers-reduced-motion: reduce)") : null;
    this.reduced = this.motionQuery?.matches ?? false;

    // A host that was just disposed on this canvas (StrictMode's second mount) has not given its context up yet: keep it.
    cancelRelease(this.canvas);
    try {
      this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: false, alpha: false, powerPreference: "high-performance" });
    } catch {
      this.renderer = null;
      this.state = reduceGl(this.state, { type: "unsupported" });
      this.opts.onStatus?.(describeGl(this.state));
      return;
    }
    hostStats.created++;

    this.canvas.addEventListener("webglcontextlost", this.onContextLost);
    this.canvas.addEventListener("webglcontextrestored", this.onContextRestored);
    document.addEventListener("visibilitychange", this.onVisibility);
    window.addEventListener("resize", this.onWindowResize);
    this.motionQuery?.addEventListener("change", this.onMotionChange);
    this.resizeObserver = typeof ResizeObserver === "function" ? new ResizeObserver(() => this.fit()) : null;
    this.resizeObserver?.observe(this.canvas);
    // A host created in a background tab must start hidden, not assume it is visible.
    if (document.hidden) this.dispatch({ type: "hidden", value: true });
    this.fit();
  }

  /** The coarse status. Changes are reported through `onStatus`. */
  get status(): GlStatus {
    return describeGl(this.state);
  }

  /** The current prefers-reduced-motion setting. The host adds no motion of its own; consumers read this. */
  get reducedMotion(): boolean {
    return this.reduced;
  }

  /** Frames drawn since creation. */
  get frameCount(): number {
    return this.frames;
  }

  /** The renderer, for consumers and diagnostics. Null when unsupported or after dispose. */
  get three(): THREE.WebGLRenderer | null {
    return this.renderer;
  }

  get pixelRatioInUse(): number {
    return this.pixelRatio;
  }

  /** Marks the host inactive (another visualizer is shown) or active again. Inactive hosts do not draw. */
  setActive(active: boolean): void {
    this.dispatch({ type: "active", value: active });
  }

  /**
   * Draws one frame. Returns false, drawing nothing, when the host is not drawable. The consumer calls this from
   * its frame callback; the host never schedules a frame itself.
   */
  render(scene: THREE.Scene, camera: THREE.Camera): boolean {
    if (!this.renderer || !drawable(this.state)) return false;
    // A change of device-pixel ratio alone (for example, moving the window to another monitor) fires no resize event,
    // so the ratio is checked here. This is one property read per frame.
    if ((window.devicePixelRatio || 1) !== this.dprSeen) this.fit();
    this.renderer.render(scene, camera);
    this.frames++;
    return true;
  }

  /** Releases every listener, the renderer's GPU resources and the context. Safe to call more than once. */
  dispose(): void {
    if (this.state.disposed) return;
    this.dispatch({ type: "disposed" });
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    this.canvas.removeEventListener("webglcontextlost", this.onContextLost);
    this.canvas.removeEventListener("webglcontextrestored", this.onContextRestored);
    document.removeEventListener("visibilitychange", this.onVisibility);
    window.removeEventListener("resize", this.onWindowResize);
    this.motionQuery?.removeEventListener("change", this.onMotionChange);
    this.motionQuery = null;
    if (this.renderer) {
      this.renderer.dispose();
      releaseContext(this.canvas, this.renderer);
      this.renderer = null;
      hostStats.disposed++;
    }
  }

  private dispatch(e: GlEvent): void {
    const before = describeGl(this.state);
    this.state = reduceGl(this.state, e);
    const after = describeGl(this.state);
    if (after !== before) this.opts.onStatus?.(after);
  }

  /** Matches the renderer's size and ratio to the canvas's CSS size. Skips the work when nothing changed. */
  private fit(): void {
    if (!this.renderer || this.state.disposed) return;
    const rect = this.canvas.getBoundingClientRect();
    if (rect.width < 1 || rect.height < 1) return;
    this.dprSeen = window.devicePixelRatio || 1;
    const ratio = resolvePixelRatio(this.dprSeen, this.opts.maxPixelRatio ?? MAX_PIXEL_RATIO);
    if (rect.width === this.cssWidth && rect.height === this.cssHeight && ratio === this.pixelRatio) return;
    this.cssWidth = rect.width;
    this.cssHeight = rect.height;
    this.pixelRatio = ratio;
    this.renderer.setPixelRatio(ratio);
    // false: keep the canvas's CSS size under the consumer's control.
    this.renderer.setSize(rect.width, rect.height, false);
  }
}
