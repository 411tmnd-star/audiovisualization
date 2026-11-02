"use client";

import { useEffect, useId, useRef, useState, type DragEvent, type ReactNode } from "react";

import { usePipelineSources } from "@/components/gl/usePipelineSources";
import { useAudioFrame, useAudioPipeline, usePipelineState, useSceneState } from "@/lib/pipeline/react";

/**
 * The shared stage every WebGL scene is shown in: a full-bleed canvas with glass overlays (title and band meters at the top left, a
 * controls panel at the top right, the transport along the bottom), the same layout Squall uses. It owns only presentation and the
 * keyboard, drop and fullscreen behaviour; the scene is its child and reads the pipeline's frames as before. Nothing here touches the
 * audio contract or the GL host.
 *
 * Keys: Space plays and pauses, the arrow keys seek five seconds, F toggles fullscreen. The overlays dim while music plays and the
 * pointer is idle, and return on any movement, touch, key or focus.
 */

export interface SceneStageProps {
  /** Used for element ids and the `data-stage` attribute. */
  id: string;
  title: string;
  /** One line, always visible. */
  tagline: string;
  /** The longer description, shown when the info button is pressed. */
  about: string;
  /** Short interaction hint, for example "Drag to orbit". */
  hint?: string;
  /** The scene's clear colour, so the stage edge is invisible. */
  background: string;
  /** Keep the bottom strip free of the canvas, for scenes whose composition reaches the bottom edge (Score). */
  reserveBottom?: boolean;
  /** Scene-specific controls, shown in the panel. */
  settings?: ReactNode;
  /** The scene's canvas. */
  children: ReactNode;
  className?: string;
}

const fmt = (t: number) => `${Math.floor(t / 60)}:${(t % 60).toFixed(1).padStart(4, "0")}`;
const glass = "bg-[#050912]/60 backdrop-blur-md ring-1 ring-white/10";
const label = "text-[10px] font-medium uppercase tracking-[0.16em] text-slate-400";
const focus = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300";
const IDLE_MS = 4000;

export default function SceneStage({ id, title, tagline, about, hint, background, reserveBottom, settings, children, className = "" }: SceneStageProps) {
  const pipeline = useAudioPipeline();
  const state = usePipelineState();
  const scene = useSceneState();
  const src = usePipelineSources();
  const sectionRef = useRef<HTMLElement>(null);
  const titleId = useId();
  const [railOpen, setRailOpen] = useState(false);
  const [aboutOpen, setAboutOpen] = useState(false);
  const [dropping, setDropping] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [idle, setIdle] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const hasSource = state.source !== null;
  // A source that failed to start can still report "playing"; do not show it as playing.
  const playing = state.isPlaying && !state.error;
  const problem = src.problem ?? state.error;

  useEffect(() => {
    const onChange = () => setFullscreen(document.fullscreenElement === sectionRef.current);
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  const toggleFullscreen = () => {
    const el = sectionRef.current;
    if (!el) return;
    if (document.fullscreenElement) void document.exitFullscreen();
    else void el.requestFullscreen().catch(() => setNote("Fullscreen was blocked by the browser."));
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (t && t !== document.body && !sectionRef.current?.contains(t)) return;
      const tag = t?.tagName;
      const typing = tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
      if (e.key === " " && !typing && tag !== "BUTTON") {
        e.preventDefault();
        void pipeline.toggle();
      } else if ((e.key === "ArrowLeft" || e.key === "ArrowRight") && !typing && pipeline.source?.canSeek) {
        e.preventDefault();
        pipeline.seek(Math.max(0, pipeline.frame.time + (e.key === "ArrowRight" ? 5 : -5)));
      } else if ((e.key === "f" || e.key === "F") && !typing && document.fullscreenEnabled) {
        toggleFullscreen();
      } else if (e.key === "Escape") {
        setRailOpen(false);
        setAboutOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pipeline]);

  // Dim the overlays after a quiet spell while music plays; any activity brings them back.
  useEffect(() => {
    if (!playing || railOpen || aboutOpen) {
      setIdle(false);
      return;
    }
    let timer = window.setTimeout(() => setIdle(true), IDLE_MS);
    const wake = () => {
      setIdle(false);
      window.clearTimeout(timer);
      timer = window.setTimeout(() => setIdle(true), IDLE_MS);
    };
    const events = ["pointermove", "pointerdown", "keydown", "touchstart", "focusin"] as const;
    for (const ev of events) window.addEventListener(ev, wake, { passive: true });
    return () => {
      window.clearTimeout(timer);
      for (const ev of events) window.removeEventListener(ev, wake);
    };
  }, [playing, railOpen, aboutOpen]);

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDropping(false);
    const f = e.dataTransfer.files?.[0];
    if (f) src.file(f);
  };

  const fade = `transition-opacity duration-500 motion-reduce:transition-none hover:opacity-100 focus-within:opacity-100 ${idle ? "opacity-30" : ""}`;

  return (
    <section
      ref={sectionRef}
      aria-labelledby={titleId}
      data-stage={id}
      data-scene={scene}
      data-dropping={dropping || undefined}
      onDragOver={(e) => {
        if (Array.from(e.dataTransfer.types).includes("Files")) {
          e.preventDefault();
          setDropping(true);
        }
      }}
      onDragLeave={(e) => {
        if (e.currentTarget === e.target) setDropping(false);
      }}
      onDrop={onDrop}
      style={{ backgroundColor: background }}
      className={`relative isolate h-[calc(100svh-2rem)] min-h-[32rem] overflow-hidden text-slate-100 ${fullscreen ? "!h-screen" : "rounded-2xl ring-1 ring-white/10"} ${className}`}
    >
      <div className={`absolute inset-x-0 top-0 ${reserveBottom ? "bottom-[5.25rem] sm:bottom-[5.5rem]" : "bottom-0"}`} data-stage-canvas>
        {children}
      </div>

      {/* ---- title, band meters, top left ---- */}
      <div className={`pointer-events-none absolute left-3 top-3 flex max-w-[calc(100%-9.5rem)] flex-col gap-2 sm:left-5 sm:top-5 sm:max-w-sm ${railOpen ? "max-sm:invisible" : ""} ${fade}`}>
        <div className={`pointer-events-auto rounded-xl px-4 py-3 ${glass}`}>
          <div className="flex items-start justify-between gap-3">
            <h2 id={titleId} className="text-sm font-semibold uppercase tracking-[0.3em] text-slate-100">
              {title}
            </h2>
            <button
              type="button"
              aria-expanded={aboutOpen}
              aria-controls={`${titleId}-about`}
              aria-label={aboutOpen ? "Hide description" : "About this visual"}
              onClick={() => setAboutOpen((o) => !o)}
              className={`-mr-1 -mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full text-xs text-slate-300 ring-1 ring-white/20 hover:bg-white/10 ${focus}`}
            >
              {aboutOpen ? "×" : "i"}
            </button>
          </div>
          <p className="mt-1 text-xs text-slate-300">{tagline}</p>
          {aboutOpen && (
            <p id={`${titleId}-about`} className="mt-2 border-t border-white/10 pt-2 text-xs leading-relaxed text-slate-300/90" data-about>
              {about}
            </p>
          )}
          <BandMeters />
          <StatusLine hasSource={hasSource} hint={hint} />
        </div>
      </div>

      {/* ---- controls panel, top right ---- */}
      <div className={`pointer-events-none absolute right-3 top-3 flex max-h-[calc(100%-7.5rem)] flex-col items-end gap-2 sm:right-5 sm:top-5 ${railOpen ? "" : fade}`}>
        <button
          type="button"
          aria-expanded={railOpen}
          aria-controls={`${titleId}-rail`}
          data-controls-toggle
          onClick={() => setRailOpen((o) => !o)}
          className={`pointer-events-auto shrink-0 rounded-full px-4 py-2 text-xs font-medium uppercase tracking-[0.14em] text-slate-200 hover:bg-white/10 ${glass} ${focus}`}
        >
          Controls
        </button>
        {railOpen && (
          <div id={`${titleId}-rail`} className={`pointer-events-auto min-h-0 w-64 space-y-4 overflow-y-auto rounded-xl p-4 ${glass}`} data-rail>
            <div>
              <span className={label}>Source</span>
              <div className="mt-1.5">
                <SourceButtons src={src} compact />
              </div>
            </div>
            {settings}
            <SyncNudge />
            <p className="border-t border-white/10 pt-3 text-[11px] leading-relaxed text-slate-500">
              <kbd className="text-slate-400">Space</kbd> play or pause · <kbd className="text-slate-400">←</kbd> <kbd className="text-slate-400">→</kbd> seek 5 s · <kbd className="text-slate-400">F</kbd> full screen · drop a file to load it
            </p>
          </div>
        )}
      </div>

      {/* ---- empty state ---- */}
      {!hasSource && (
        <div className="pointer-events-none absolute inset-0 grid place-items-center px-4 pb-24">
          <div className={`pointer-events-auto w-full max-w-md rounded-2xl p-6 text-center ${glass}`} data-empty>
            <p className="text-lg font-light tracking-wide">{title}</p>
            <p className="mt-1 text-sm text-slate-400">{tagline}</p>
            <SourceButtons src={src} />
            <p className="mt-3 text-[11px] text-slate-500">Or drop an audio file anywhere on the stage.</p>
          </div>
        </div>
      )}
      {hasSource && !playing && !problem && (
        <p className="pointer-events-none absolute inset-x-0 top-[44%] text-center text-xs uppercase tracking-[0.2em] text-slate-300/80" data-ready>
          Press play, or Space
        </p>
      )}

      {(problem || note) && (
        <div className="pointer-events-none absolute inset-x-0 bottom-[6.5rem] flex justify-center px-4">
          <p role="alert" className="pointer-events-auto flex items-center gap-3 rounded-lg bg-rose-950/80 px-4 py-2 text-sm text-rose-100 ring-1 ring-rose-300/30" data-problem>
            {problem ?? note}
            {!problem && (
              <button type="button" onClick={() => setNote(null)} className={`rounded px-1 text-rose-200 underline ${focus}`}>
                Dismiss
              </button>
            )}
          </p>
        </div>
      )}

      {dropping && (
        <div className="pointer-events-none absolute inset-0 grid place-items-center bg-cyan-300/10 text-sm uppercase tracking-[0.2em] ring-2 ring-inset ring-cyan-300/70">
          Drop to load this track
        </div>
      )}

      {/* ---- transport, bottom ---- */}
      <div className={`absolute inset-x-3 bottom-3 rounded-xl p-3 sm:inset-x-5 sm:bottom-5 ${glass} ${fade}`} data-transport>
        <div className="flex items-center gap-2 sm:gap-3">
          <button
            type="button"
            data-play
            disabled={!hasSource}
            aria-label={playing ? "Pause" : "Play"}
            aria-pressed={playing}
            onClick={() => void pipeline.toggle()}
            className={`grid h-10 w-10 shrink-0 place-items-center rounded-full bg-white text-slate-900 transition hover:scale-105 disabled:opacity-40 motion-reduce:transition-none motion-reduce:hover:scale-100 ${focus}`}
          >
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="currentColor" aria-hidden>
              {playing ? (
                <>
                  <rect x="6" y="5" width="4" height="14" rx="1" />
                  <rect x="14" y="5" width="4" height="14" rx="1" />
                </>
              ) : (
                <path d="M8 5.5v13a1 1 0 0 0 1.5.86l10-6.5a1 1 0 0 0 0-1.72l-10-6.5A1 1 0 0 0 8 5.5Z" />
              )}
            </svg>
          </button>
          <Timeline duration={state.duration} canSeek={!!state.source?.canSeek} />
          <p className="hidden max-w-[14rem] shrink-0 truncate text-right text-xs text-slate-300 md:block" data-source-label title={state.source?.label}>
            {state.source ? (
              <>
                {state.source.label}
                <span className="text-slate-500"> · {state.source.kind === "offline" ? "pre-computed" : state.source.kind === "synthetic" ? "demo signal" : state.source.id === "mic" ? "live mic" : "live file"}</span>
              </>
            ) : (
              <span className="text-slate-500">No source</span>
            )}
          </p>
          {src.caps.fullscreen && (
            <button
              type="button"
              aria-label={fullscreen ? "Exit full screen" : "Full screen"}
              data-fullscreen
              onClick={toggleFullscreen}
              className={`shrink-0 whitespace-nowrap rounded-full px-2 py-1.5 text-xs text-slate-300 hover:bg-white/10 sm:px-3 ${focus}`}
            >
              {fullscreen ? "Exit full screen" : "Full screen"}
            </button>
          )}
        </div>
      </div>
    </section>
  );
}

// ---- small pieces ----------------------------------------------------------------------------------

/** Clock and scrubber. Frame values go to refs; React state is not touched per frame. */
function Timeline({ duration, canSeek }: { duration: number | null; canSeek: boolean }) {
  const pipeline = useAudioPipeline();
  const clockRef = useRef<HTMLSpanElement>(null);
  const scrubRef = useRef<HTMLInputElement>(null);
  const scrubbing = useRef(false);
  useAudioFrame((f) => {
    if (clockRef.current) clockRef.current.textContent = fmt(f.time);
    if (!scrubbing.current && scrubRef.current) scrubRef.current.value = String(f.time);
  }, []);
  const end = () => (scrubbing.current = false);
  return (
    <>
      <span className="w-[5.5rem] shrink-0 text-xs tabular-nums text-slate-300">
        <span ref={clockRef} data-clock>
          0:00.0
        </span>
        <span className="text-slate-500"> / {duration ? fmt(duration) : "--:--"}</span>
      </span>
      <input
        ref={scrubRef}
        type="range"
        aria-label="Timeline position"
        min={0}
        max={duration ?? 0}
        step={0.01}
        defaultValue={0}
        disabled={!canSeek}
        onPointerDown={() => (scrubbing.current = true)}
        onPointerUp={end}
        onPointerCancel={end}
        onBlur={end}
        onChange={(e) => pipeline.seek(Number(e.target.value))}
        className="h-1.5 min-w-0 flex-1 cursor-pointer accent-white disabled:cursor-not-allowed disabled:opacity-40"
      />
    </>
  );
}

const BANDS = [
  ["bass", "from-amber-400 to-amber-200"],
  ["mid", "from-cyan-400 to-cyan-200"],
  ["high", "from-violet-400 to-violet-200"],
] as const;

/** Three live level bars. They show the contract's band values, a legend for how loud each band is, not a scene feature. */
function BandMeters() {
  const refs = useRef<Record<string, HTMLDivElement | null>>({});
  useAudioFrame((f) => {
    for (const [b] of BANDS) {
      const el = refs.current[b];
      if (el) el.style.transform = `scaleX(${f[b].toFixed(3)})`;
    }
  }, []);
  return (
    <div className="mt-3 grid grid-cols-3 gap-3" aria-hidden data-meters>
      {BANDS.map(([b, grad]) => (
        <div key={b}>
          <div className={`mb-1 ${label}`}>{b}</div>
          <div className="h-1 overflow-hidden rounded-full bg-white/10">
            <div
              ref={(el) => {
                refs.current[b] = el;
              }}
              className={`h-full origin-left rounded-full bg-gradient-to-r ${grad} will-change-transform`}
              style={{ transform: "scaleX(0)" }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

type Chip = "none" | "paused" | "silent" | "quiet" | "playing";
const CHIP: Record<Chip, string> = {
  none: "Waiting for a source",
  paused: "Paused",
  silent: "Silent: resting",
  quiet: "Quiet: low energy",
  playing: "Playing",
};

/** The one live-region line. React state changes only when the wording does, not per frame. */
function StatusLine({ hasSource, hint }: { hasSource: boolean; hint?: string }) {
  const state = usePipelineState();
  const [chip, setChip] = useState<Chip>("none");
  useAudioFrame(
    (f) => {
      const next: Chip = !hasSource ? "none" : !f.isPlaying ? "paused" : f.rmsEnergy < 0.04 ? "silent" : f.rmsEnergy < 0.3 ? "quiet" : "playing";
      setChip((c) => (c === next ? c : next));
    },
    [hasSource],
  );
  return (
    <p role="status" aria-live="polite" className="mt-3 border-t border-white/10 pt-2 text-[11px] text-slate-400" data-chip={chip}>
      {CHIP[chip]}
      {hasSource && <span data-scene-label> · scene: {state.scene}</span>}
      {hint && <span className="text-slate-500"> · {hint}</span>}
    </p>
  );
}

function SyncNudge() {
  const pipeline = useAudioPipeline();
  const state = usePipelineState();
  const [nudge, setNudge] = useState(0);
  return (
    <div>
      <div className="flex items-center justify-between">
        <label htmlFor="stage-nudge" className={label}>
          Sync nudge
        </label>
        <span className="text-xs tabular-nums text-slate-300">
          {nudge > 0 ? "+" : ""}
          {nudge} ms
        </span>
      </div>
      <input
        id="stage-nudge"
        type="range"
        min={-200}
        max={200}
        step={10}
        value={nudge}
        onChange={(e) => {
          setNudge(Number(e.target.value));
          pipeline.setSyncNudge(Number(e.target.value));
        }}
        className="mt-1 w-full accent-cyan-300"
      />
      <p className="mt-1 text-[11px] text-slate-500">Device latency {state.latencyMs} ms, compensated automatically.</p>
    </div>
  );
}

/** A labelled segmented choice, for scene settings. */
export function StageSeg<T extends string>({ name, value, options, onChange, hint }: { name: string; value: T; options: [T, string][]; onChange: (v: T) => void; hint?: ReactNode }) {
  return (
    <div role="group" aria-label={name}>
      <span className={label}>{name}</span>
      <div className="mt-1 flex rounded-lg bg-white/5 p-0.5">
        {options.map(([v, text]) => (
          <button
            key={v}
            type="button"
            data-setting={`${name.toLowerCase()}:${v}`}
            aria-pressed={value === v}
            onClick={() => onChange(v)}
            className={`flex-1 rounded-md px-2 py-1 text-xs text-slate-300 transition hover:bg-white/10 aria-pressed:bg-white aria-pressed:text-slate-900 aria-pressed:hover:bg-white motion-reduce:transition-none ${focus}`}
          >
            {text}
          </button>
        ))}
      </div>
      {hint && <p className="mt-1 text-[11px] text-slate-500">{hint}</p>}
    </div>
  );
}

function SourceButtons({ src, compact = false }: { src: ReturnType<typeof usePipelineSources>; compact?: boolean }) {
  const state = usePipelineState();
  const active = state.source?.id ?? null;
  const { caps } = src;
  const btn = `rounded-full px-4 py-2 text-sm transition disabled:cursor-not-allowed disabled:opacity-40 motion-reduce:transition-none ${compact ? "!px-3 !py-1.5 !text-xs" : ""} ${focus}`;
  const tone = (isOn: boolean) => (isOn ? "bg-white text-slate-900" : "bg-white/10 hover:bg-white/15");
  return (
    <div className={`flex flex-wrap items-center gap-2 ${compact ? "" : "mt-5 justify-center"}`} role="group" aria-label="Audio source">
      <button type="button" data-source="demo" aria-pressed={active === "demo"} onClick={src.demo} className={`${btn} ${tone(active === "demo")}`}>
        Demo
      </button>
      {src.songs.map((s) => (
        <button key={s.id} type="button" data-source={`song:${s.id}`} aria-pressed={active === `offline:${s.id}`} disabled={src.busy !== null} onClick={() => void src.song(s)} className={`${btn} ${tone(active === `offline:${s.id}`)}`} title="Pre-computed track">
          {src.busy === s.id ? "Loading…" : s.title.split(" - ")[0]}
        </button>
      ))}
      <button type="button" data-source="mic" aria-pressed={active === "mic"} disabled={!caps.webAudio || !caps.microphone} onClick={src.mic} className={`${btn} ${tone(active === "mic")}`}>
        Microphone
      </button>
      <label className={`${btn} cursor-pointer bg-white/10 hover:bg-white/15 focus-within:ring-2 focus-within:ring-cyan-300 ${caps.webAudio ? "" : "pointer-events-none !text-slate-500"}`}>
        Load a track
        <input type="file" accept="audio/*" className="sr-only" disabled={!caps.webAudio} data-file-input onChange={(e) => e.target.files?.[0] && src.file(e.target.files[0])} />
      </label>
      {!caps.webAudio && (
        <p className="w-full text-xs text-amber-200/90" role="note" data-unsupported>
          This browser has no Web Audio, so it cannot analyse a file or the microphone. The demo and the pre-computed tracks still work.
        </p>
      )}
      {caps.webAudio && !caps.microphone && (
        <p className="w-full text-xs text-amber-200/90" role="note" data-unsupported>
          The microphone is not available here (it needs a secure page and a supported browser).
        </p>
      )}
    </div>
  );
}
