"use client";

import { useEffect, useState } from "react";
import { getLiveVideo } from "@/tracking/frameSync";
import { useTryOnStore } from "@/store/tryOnStore";
import { useUiStore } from "@/store/uiStore";
import { devSnapshot, type DevSnapshot } from "@/lib/devMetrics";

type VideoFrameMeta = { presentedFrames: number };
type VideoWithFrameCallback = HTMLVideoElement & {
  requestVideoFrameCallback: (cb: (now: number, meta: VideoFrameMeta) => void) => number;
  cancelVideoFrameCallback: (handle: number) => void;
};

/**
 * Camera frames actually presented per second (rVFC presentedFrames, so a
 * busy main thread that skips callbacks still counts every frame), and the
 * rate the camera was asked for.
 */
function useCameraFps(): { fps: number | null; target: number | null } {
  const [state, setState] = useState<{ fps: number | null; target: number | null }>({
    fps: null,
    target: null,
  });

  useEffect(() => {
    let handle: number | null = null;
    let video: VideoWithFrameCallback | null = null;
    let windowStart = 0;
    let startFrames = -1;
    let cancelled = false;

    const onFrame = (now: number, meta: VideoFrameMeta) => {
      if (cancelled || !video) return;
      if (startFrames < 0) {
        startFrames = meta.presentedFrames;
        windowStart = now;
      } else if (now - windowStart >= 1000) {
        const fps = ((meta.presentedFrames - startFrames) * 1000) / (now - windowStart);
        const stream = video.srcObject;
        const rate =
          stream instanceof MediaStream ? stream.getVideoTracks()[0]?.getSettings().frameRate : undefined;
        setState({ fps, target: rate ? Math.round(rate) : null });
        startFrames = meta.presentedFrames;
        windowStart = now;
      }
      handle = video.requestVideoFrameCallback(onFrame);
    };

    // The <video> registers itself once the camera is up; wait for it.
    const attach = setInterval(() => {
      const v = getLiveVideo() as VideoWithFrameCallback | null;
      if (v === video) return;
      if (video && handle != null) video.cancelVideoFrameCallback(handle);
      video = v;
      handle = null;
      startFrames = -1;
      if (video && typeof video.requestVideoFrameCallback === "function") {
        handle = video.requestVideoFrameCallback(onFrame);
      } else {
        setState({ fps: null, target: null });
      }
    }, 500);

    return () => {
      cancelled = true;
      clearInterval(attach);
      if (video && handle != null) video.cancelVideoFrameCallback(handle);
    };
  }, []);

  return state;
}

/** Dev builds only: camera and tracker fps under the wordmark, top-left of the mirror. */
export function DevFpsReadout() {
  if (process.env.NODE_ENV !== "development") return null;
  return <Readout />;
}

/** Main-thread long tasks (> 50 ms blocks) per second, and the longest. */
function useLongTasks(): { msPerSec: number; longest: number } | null {
  const [state, setState] = useState<{ msPerSec: number; longest: number } | null>(null);
  useEffect(() => {
    if (typeof PerformanceObserver === "undefined") return;
    let sum = 0;
    let longest = 0;
    let start = performance.now();
    let obs: PerformanceObserver | null = null;
    try {
      obs = new PerformanceObserver((list) => {
        for (const e of list.getEntries()) {
          sum += e.duration;
          longest = Math.max(longest, e.duration);
        }
      });
      obs.observe({ type: "longtask", buffered: false });
    } catch {
      return;
    }
    const id = setInterval(() => {
      const now = performance.now();
      setState({ msPerSec: (sum * 1000) / (now - start), longest });
      sum = 0;
      longest = 0;
      start = now;
    }, 1000);
    return () => {
      clearInterval(id);
      obs?.disconnect();
    };
  }, []);
  return state;
}

/** devMetrics snapshot once a second. */
function useDevSnapshot(): DevSnapshot | null {
  const [snap, setSnap] = useState<DevSnapshot | null>(null);
  useEffect(() => {
    devSnapshot(); // start a clean window
    const id = setInterval(() => setSnap(devSnapshot()), 1000);
    return () => clearInterval(id);
  }, []);
  return snap;
}

type Tone = "good" | "bad" | "info";
type Row = { label: string; value: string; tone: Tone; hint?: string } | { section: string };

const TONE_CLASS: Record<Tone, string> = {
  good: "text-emerald-400",
  bad: "text-red-400",
  info: "text-white/85",
};

/** Higher is better: good at or above `min`. */
const atLeast = (v: number | undefined, min: number): Tone => (v == null ? "info" : v >= min ? "good" : "bad");
/** Lower is better: good at or below `max`. */
const atMost = (v: number | undefined, max: number): Tone => (v == null ? "info" : v <= max ? "good" : "bad");

const fmtMs = (v: number | undefined) => (v == null ? "—" : `${v.toFixed(1)} ms`);
const fmtFps = (v: number | undefined, of?: number | null) =>
  v == null ? "—" : `${v.toFixed(0)}${of ? `/${of}` : ""} fps`;

/** One camera frame at 30 fps. Thresholds below are in camera frames. */
const FRAME_MS = 1000 / 30;

function Readout() {
  const camera = useCameraFps();
  const trackingStatus = useTryOnStore((s) => s.trackingStatus);
  const trackerFps = useTryOnStore((s) => s.fps);
  const stats = useUiStore((s) => s.trackerStats);
  const locked = useUiStore((s) => s.syncDisplay);
  const paced = useUiStore((s) => s.paceRenderToCamera);
  const snap = useDevSnapshot();
  const longTasks = useLongTasks();
  const engine =
    stats?.engine === "worker-cpu" ? "worker CPU" : stats?.engine === "worker-gpu" ? "worker GPU" : stats ? "main" : "—";
  const st = snap?.stats ?? {};
  const rt = snap?.rates ?? {};
  const tracking = trackingStatus === "ready" && trackerFps > 0;
  const tracker = tracking ? trackerFps : undefined;
  const target = camera.target ?? 30;
  const unanalysed =
    tracker != null && camera.fps != null ? Math.max(0, Math.round(camera.fps - tracker)) : undefined;
  // The fit engine only reports pose timings while a face is in view.
  const face = st.poseAge != null;

  const rows: Row[] = [
    { section: "rates" },
    { label: "camera", value: fmtFps(camera.fps ?? undefined, camera.target), tone: atLeast(camera.fps ?? undefined, target - 2) },
    { label: `tracker (${engine})`, value: fmtFps(tracker), tone: atLeast(tracker, target - 3) },
    { label: "not analysed", value: unanalysed == null ? "—" : `${unanalysed} /s`, tone: atMost(unanalysed, 3) },
    { label: `3D draws${paced ? " (paced)" : ""}`, value: fmtFps(rt.draw), tone: atLeast(rt.draw, target - 2) },
    { label: "worst draw gap", value: fmtMs(st.drawGap?.max), tone: atMost(st.drawGap?.max, 1.5 * FRAME_MS) },
    ...(locked
      ? [{ label: "locked frames shown", value: fmtFps(rt.shown), tone: atLeast(rt.shown, target - 3) } as Row]
      : []),

    { section: "one frame: camera → glasses" },
    { label: "queue", value: fmtMs(st.wait?.avg), tone: atMost(st.wait?.avg, 5) },
    { label: "detect", value: fmtMs(st.detect?.avg), tone: atMost(st.detect?.avg, FRAME_MS) },
    { label: "hand-off", value: fmtMs(st.handoff?.avg), tone: atMost(st.handoff?.avg, 5) },
    { label: "wait to draw", value: fmtMs(st.toDraw?.avg), tone: atMost(st.toDraw?.avg, FRAME_MS / 2) },
    { label: "age first drawn", value: face ? fmtMs(st.firstAge?.avg) : "no face", tone: atMost(st.firstAge?.avg, 1.5 * FRAME_MS) },
    { label: "age on screen (avg)", value: face ? fmtMs(st.poseAge?.avg) : "no face", tone: atMost(st.poseAge?.avg, 2 * FRAME_MS) },
    { label: "age on screen (max)", value: face ? fmtMs(st.poseAge?.max) : "no face", tone: atMost(st.poseAge?.max, 3 * FRAME_MS) },

    ...(locked
      ? ([
          { section: "lock: picture = analysed frame" },
          { label: "glasses behind face", value: "0 ms", tone: "good" },
          { label: "mirror delay", value: face ? fmtMs(st.poseAge?.avg) : "—", tone: atMost(st.poseAge?.avg, 2 * FRAME_MS) },
        ] as Row[])
      : ([
          { section: "live: newest picture" },
          { label: "picture age", value: fmtMs(st.picAge?.avg), tone: atMost(st.picAge?.avg, 20) },
          { label: "pose behind picture", value: fmtMs(st.behind?.avg), tone: "info" },
          { label: "covered by prediction", value: fmtMs(st.predicted?.avg), tone: "info" },
          { label: "glasses behind face", value: fmtMs(st.residual?.avg), tone: atMost(st.residual?.avg, 10) },
        ] as Row[])),

    { section: "page" },
    {
      label: "main thread busy",
      value: longTasks ? `${longTasks.msPerSec.toFixed(0)} ms/s` : "—",
      tone: atMost(longTasks?.msPerSec, 50),
    },
    {
      label: "longest block",
      value: longTasks ? `${longTasks.longest.toFixed(0)} ms` : "—",
      tone: atMost(longTasks?.longest, 50),
    },
  ];

  return (
    <table
      data-testid="dev-fps"
      className="pointer-events-none mt-1.5 rounded-md bg-black/65 font-mono text-[10px] leading-[14px] text-white/85"
    >
      <tbody>
        {rows.map((r, i) =>
          "section" in r ? (
            <tr key={i}>
              <td colSpan={2} className={`px-2 ${i ? "pt-1.5" : "pt-1"} text-[9px] uppercase tracking-wider text-white/45`}>
                {r.section}
              </td>
            </tr>
          ) : (
            <tr key={i}>
              <td className="py-px pl-2 pr-4">{r.label}</td>
              <td className={`py-px pr-2 text-right tabular-nums ${TONE_CLASS[r.tone]}`}>{r.value}</td>
            </tr>
          ),
        )}
        <tr>
          <td colSpan={2} className="pb-1" />
        </tr>
      </tbody>
    </table>
  );
}
