import { create } from "zustand";
import { setFrameSyncMode } from "@/tracking/frameSync";
import type { DetectEngine, TrackerStats } from "@/tracking/types";

/**
 * How the customer talks to the assistant.
 *   voice : mic → Sarvam STT, replies spoken (and captioned)
 *   text  : quick replies / keyboard, replies as captions only — no mic, no
 *           speech services (bot.py's text mode)
 */
export type InputMode = "voice" | "text";

/** Kiosk default; NEXT_PUBLIC_INPUT_MODE=text while speech is unavailable. */
export const DEFAULT_INPUT_MODE: InputMode =
  process.env.NEXT_PUBLIC_INPUT_MODE === "text" ? "text" : "voice";

const STAFF_KEY = "eyenetra.staffMode";
const SYNC_KEY = "eyenetra.syncDisplay";
const ENGINE_KEY = "eyenetra.detectEngine";
const PACE_KEY = "eyenetra.paceRender";
const PREDICT_KEY = "eyenetra.predictFromCapture";
const LOWLAG_KEY = "eyenetra.lowLagSmoothing";

/**
 * Lock video to tracker by default: face and glasses always come from the
 * same camera frame (no glasses trailing behind head movement). With the
 * worker tracker the picture still runs at the camera's rate.
 */
const DEFAULT_SYNC = true;
const DEFAULT_PREDICT_FROM_CAPTURE = true;
const DEFAULT_LOW_LAG = false;
/**
 * Draw the 3D view only when there is a new picture to show. Nothing on
 * screen changes in between, and the spare GPU time lets tracking reach the
 * camera's 30 fps.
 */
const DEFAULT_PACE = true;

/** Saved "1"/"0", or the default when nothing is saved. */
function readFlag(key: string, fallback: boolean): boolean {
  try {
    const v = localStorage.getItem(key);
    return v === "1" ? true : v === "0" ? false : fallback;
  } catch {
    return fallback;
  }
}
function saveFlag(key: string, on: boolean, fallback: boolean) {
  try {
    if (on === fallback) localStorage.removeItem(key);
    else localStorage.setItem(key, on ? "1" : "0");
  } catch {
    // storage blocked
  }
}
const ENGINES: DetectEngine[] = ["worker-cpu", "worker-gpu", "main"];

function persistFlag(key: string, on: boolean) {
  try {
    if (on) localStorage.setItem(key, "1");
    else localStorage.removeItem(key);
  } catch {
    // private mode / storage blocked — the setting just won't persist
  }
}

type UiState = {
  /** Staff tools (capture, fit calibration, dev knobs) — hidden from customers. */
  staffMode: boolean;
  /** Per visit: the customer can switch between talking and typing. */
  inputMode: InputMode;
  /**
   * Lock video to tracker (tracking/frameSync.ts): show the very frame each
   * pose came from — no glasses drift; the picture updates at the tracker's
   * rate. Off = live camera, glasses follow by smoothing + prediction.
   */
  syncDisplay: boolean;
  /**
   * Unlocked only: extrapolate the pose by the analysed frame's real age
   * (capture → now) instead of the time since detection finished.
   */
  predictFromCapture: boolean;
  /** Unlocked only: snappier pose filter — less lag, more jitter at rest. */
  lowLagSmoothing: boolean;
  /**
   * Where face detection runs (tracking/WorkerMediaPipeProvider.ts). A
   * worker keeps it off the main thread the 3D renderer draws on; "main" is
   * the old single-thread path. SYNC display always uses "main".
   */
  detectEngine: DetectEngine;
  /**
   * Draw the 3D view once per camera frame instead of every display refresh
   * (TryOnCanvas.tsx) — frees GPU time for the tracker. Staff option.
   */
  paceRenderToCamera: boolean;
  /** Live readout from the running tracker (staff panel). */
  trackerStats: TrackerStats | null;
  setStaffMode: (on: boolean) => void;
  setInputMode: (mode: InputMode) => void;
  setSyncDisplay: (on: boolean) => void;
  setDetectEngine: (engine: DetectEngine) => void;
  setPaceRenderToCamera: (on: boolean) => void;
  setPredictFromCapture: (on: boolean) => void;
  setLowLagSmoothing: (on: boolean) => void;
  setTrackerStats: (stats: TrackerStats | null) => void;
};

// frameSync keeps its own flag (read every render); start it in step.
setFrameSyncMode(DEFAULT_SYNC);

export const useUiStore = create<UiState>((set) => ({
  staffMode: false,
  inputMode: DEFAULT_INPUT_MODE,
  syncDisplay: DEFAULT_SYNC,
  predictFromCapture: DEFAULT_PREDICT_FROM_CAPTURE,
  lowLagSmoothing: DEFAULT_LOW_LAG,
  detectEngine: "worker-cpu",
  paceRenderToCamera: DEFAULT_PACE,
  trackerStats: null,
  setStaffMode: (on) => {
    persistFlag(STAFF_KEY, on);
    set({ staffMode: on });
  },
  setInputMode: (mode) => set({ inputMode: mode }),
  setSyncDisplay: (on) => {
    saveFlag(SYNC_KEY, on, DEFAULT_SYNC);
    setFrameSyncMode(on);
    set({ syncDisplay: on });
  },
  setPredictFromCapture: (on) => {
    saveFlag(PREDICT_KEY, on, DEFAULT_PREDICT_FROM_CAPTURE);
    set({ predictFromCapture: on });
  },
  setLowLagSmoothing: (on) => {
    saveFlag(LOWLAG_KEY, on, DEFAULT_LOW_LAG);
    set({ lowLagSmoothing: on });
  },
  setDetectEngine: (engine) => {
    try {
      if (engine === "worker-cpu") localStorage.removeItem(ENGINE_KEY);
      else localStorage.setItem(ENGINE_KEY, engine);
    } catch {
      // storage blocked
    }
    set({ detectEngine: engine });
  },
  setPaceRenderToCamera: (on) => {
    saveFlag(PACE_KEY, on, DEFAULT_PACE);
    set({ paceRenderToCamera: on });
  },
  setTrackerStats: (stats) => set({ trackerStats: stats }),
}));

/**
 * Client-only start-up: staff mode from ?staff=1 / ?staff=0 or the saved
 * flag. Runs after hydration so server and client render the same markup.
 */
export function hydrateUiStore(): void {
  const sync = readFlag(SYNC_KEY, DEFAULT_SYNC);
  setFrameSyncMode(sync);
  useUiStore.setState({ syncDisplay: sync });
  try {
    useUiStore.setState({
      predictFromCapture: readFlag(PREDICT_KEY, DEFAULT_PREDICT_FROM_CAPTURE),
      lowLagSmoothing: readFlag(LOWLAG_KEY, DEFAULT_LOW_LAG),
    });
    const engine = localStorage.getItem(ENGINE_KEY) as DetectEngine | null;
    if (engine && ENGINES.includes(engine)) useUiStore.setState({ detectEngine: engine });
    useUiStore.setState({ paceRenderToCamera: readFlag(PACE_KEY, DEFAULT_PACE) });
  } catch {
    // storage blocked
  }
  const params = new URLSearchParams(window.location.search);
  const staffParam = params.get("staff");
  if (staffParam === "1" || staffParam === "0") {
    useUiStore.getState().setStaffMode(staffParam === "1");
    params.delete("staff");
    const qs = params.toString();
    window.history.replaceState(null, "", `${window.location.pathname}${qs ? `?${qs}` : ""}${window.location.hash}`);
    return;
  }
  try {
    if (localStorage.getItem(STAFF_KEY) === "1") useUiStore.setState({ staffMode: true });
  } catch {
    // storage blocked
  }
}
