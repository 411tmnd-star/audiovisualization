"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { detectCapabilities, type Capabilities } from "@/components/squall/useSquallSources";
import type { ManifestSong } from "@/lib/motion/types";
import { createLiveFileSource, createMicSource, createSyntheticSource, fetchManifest, loadOfflineSource, pipelineSongs } from "@/lib/pipeline";
import type { FeatureSource } from "@/lib/pipeline";
import { useAudioPipeline } from "@/lib/pipeline/react";

const MANIFEST_URL = "/motion/manifest.json";
const DEMO_BPM = 120;

/**
 * Builds sources with the pipeline's own factories and hands them to the one shared AudioPipeline. Used by the scene stage.
 * It owns the object URL of a chosen file and releases it when the source changes or the component unmounts. (Squall has its own
 * hook because it also decodes a forecast; scenes that only draw frames do not pay for that.)
 */
export function usePipelineSources() {
  const pipeline = useAudioPipeline();
  const [songs, setSongs] = useState<ManifestSong[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [caps, setCaps] = useState<Capabilities>({ webAudio: true, microphone: true, fullscreen: false });
  const revoke = useRef<(() => void) | null>(null);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    setCaps(detectCapabilities());
    const ac = new AbortController();
    fetchManifest(MANIFEST_URL, ac.signal)
      .then((m) => setSongs(pipelineSongs(m)))
      .catch(() => setSongs([])); // no pre-computed tracks: the other sources still work
    return () => {
      alive.current = false;
      ac.abort();
      revoke.current?.();
      revoke.current = null;
    };
  }, []);

  const adopt = useCallback(
    (source: FeatureSource, release: (() => void) | null, autoplay: boolean) => {
      const previous = revoke.current;
      pipeline.setSource(source);
      previous?.();
      revoke.current = release;
      setProblem(null);
      if (autoplay) void pipeline.play();
    },
    [pipeline],
  );

  const demo = useCallback(() => adopt(createSyntheticSource(() => performance.now(), DEMO_BPM), null, true), [adopt]);
  const mic = useCallback(() => adopt(createMicSource(), null, true), [adopt]);

  const song = useCallback(
    async (s: ManifestSong) => {
      setBusy(s.id);
      setProblem(null);
      try {
        adopt(await loadOfflineSource({ manifestUrl: MANIFEST_URL, songId: s.id }), null, true);
      } catch (e) {
        setProblem(e instanceof Error ? e.message : "Could not load this track.");
      } finally {
        if (alive.current) setBusy(null);
      }
    },
    [adopt],
  );

  /** Returns false (and sets a message) when the file is not audio. */
  const file = useCallback(
    (f: File): boolean => {
      if (f.type && !f.type.startsWith("audio/")) {
        setProblem(`"${f.name}" is not an audio file.`);
        return false;
      }
      const { source, revoke: release } = createLiveFileSource(f);
      adopt(source, release, false);
      return true;
    },
    [adopt],
  );

  return { songs, busy, problem, caps, demo, song, mic, file };
}
