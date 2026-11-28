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
type Row = { label: string; what: string; value: string; tone: Tone };

const TONE_CLASS: Record<Tone, string> = {
  good: "text-emerald-400",
  bad: "text-red-400",
  info: "text-white/85",
};

/** Higher is better: good at or above `min`. */
const atLeast = (v: number | undefined, min: number): Tone => (v == null ? "info" : v >= min ? "good" : "bad");
/** Lower is better: good at or below `max`. */
const atMost = (v: number | undefined, max: number): Tone => (v == null ? "info" : v <= max ? "good" : "bad");

const fmtMs = (v: number | undefined) => (v == null ? "—" : `${v.toFixed(0)} ms`);
const fmtFps = (v: number | undefined, of?: number | null) =>
  v == null ? "—" : `${v.toFixed(0)}${of ? `/${of}` : ""} fps`;

/** One camera frame at 30 fps. Thresholds below are in camera frames. */
const FRAME_MS = 1000 / 30;

/**
 * The few numbers worth watching, each with a one-line "what it measures".
 * (devMetrics collects more; add rows here when chasing something specific.)
 */
const HIDDEN_KEY = "eyenetra.devSpeedHidden";

/** Hide/show the table; remembered in this browser. */
function useHidden(): [boolean, (on: boolean) => void] {
  const [hidden, setState] = useState(false);
  useEffect(() => {
    try {
      setState(localStorage.getItem(HIDDEN_KEY) === "1");
    } catch {
      // storage blocked: start shown
    }
  }, []);
  const set = (on: boolean) => {
    setState(on);
    try {
      if (on) localStorage.setItem(HIDDEN_KEY, "1");
      else localStorage.removeItem(HIDDEN_KEY);
    } catch {
      // not remembered
    }
  };
  return [hidden, set];
}

function Readout() {
  const [hidden, setHidden] = useHidden();
  const camera = useCameraFps();
  const trackingStatus = useTryOnStore((s) => s.trackingStatus);
  const trackerFps = useTryOnStore((s) => s.fps);
  const locked = useUiStore((s) => s.syncDisplay);
  const snap = useDevSnapshot();
  const st = snap?.stats ?? {};
  const rt = snap?.rates ?? {};
  const tracker = trackingStatus === "ready" && trackerFps > 0 ? trackerFps : undefined;
  const target = camera.target ?? 30;
  // Pose timings exist only while a face is in view.
  const face = st.poseAge != null;
  const noFace = (v: string) => (face ? v : "no face");

  const rows: Row[] = [
    {
      label: "Camera",
      what: "pictures the camera sends per second",
      value: fmtFps(camera.fps ?? undefined, camera.target),
      tone: atLeast(camera.fps ?? undefined, target - 2),
    },
    {
      label: "Tracking",
      what: "new glasses positions per second",
      value: fmtFps(tracker),
      tone: atLeast(tracker, target - 3),
    },
    {
      label: "Face finding",
      what: "time to find the face in one picture",
      value: fmtMs(st.detect?.avg),
      tone: atMost(st.detect?.avg, FRAME_MS),
    },
    {
      label: "Glasses delay",
      what: "camera picture → glasses on screen",
      value: noFace(fmtMs(st.firstAge?.avg)),
      tone: atMost(st.firstAge?.avg, 1.5 * FRAME_MS),
    },
    locked
      ? {
          label: "Glasses behind face",
          what: "how far the glasses trail your head",
          value: noFace("0 ms"),
          tone: face ? "good" : "info",
        }
      : {
          label: "Glasses behind face",
          what: "trail left after prediction",
          value: noFace(fmtMs(st.residual?.avg)),
          tone: atMost(st.residual?.avg, 10),
        },
    ...(locked
      ? [
          {
            label: "Mirror delay",
            what: "how late the whole picture runs",
            value: noFace(fmtMs(st.poseAge?.avg)),
            tone: atMost(st.poseAge?.avg, 2 * FRAME_MS),
          } as Row,
        ]
      : []),
    {
      label: "Screen redraws",
      what: "3D redraws per second",
      value: fmtFps(rt.draw),
      tone: atLeast(rt.draw, target - 2),
    },
  ];

  if (hidden) {
    return (
      <button
        type="button"
        onPointerDown={(e) => e.stopPropagation()}
        onClick={() => setHidden(false)}
        className="pointer-events-auto mt-1.5 block rounded-md bg-black/55 px-2 py-0.5 font-mono text-[10px] text-white/70 hover:text-white"
      >
        show speed
      </button>
    );
  }

  return (
    <table
      data-testid="dev-fps"
      className="pointer-events-none mt-1.5 rounded-md bg-black/65 font-mono text-[10px] text-white/85"
    >
      <thead>
        <tr>
          <th colSpan={2} className="pl-2 pr-1 pt-1 text-right font-normal">
            <button
              type="button"
              // Inside the wordmark, whose long press opens staff tools.
              onPointerDown={(e) => e.stopPropagation()}
              onClick={() => setHidden(true)}
              className="pointer-events-auto rounded px-1.5 text-[10px] text-white/55 hover:bg-white/10 hover:text-white"
            >
              hide
            </button>
          </th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.label}>
            <td className="py-[3px] pl-2 pr-4 align-top leading-[12px]">
              <div>{r.label}</div>
              <div className="text-[9px] text-white/45">{r.what}</div>
            </td>
            <td className={`py-[3px] pr-2 text-right align-top leading-[12px] tabular-nums ${TONE_CLASS[r.tone]}`}>
              {r.value}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
