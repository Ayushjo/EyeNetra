import { create } from "zustand";
import { setFrameSyncMode } from "@/tracking/frameSync";

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
   * Frame-synchronous display (tracking/frameSync.ts): no glasses drift, but
   * the picture only updates at the tracker's speed. Off = live camera.
   */
  syncDisplay: boolean;
  setStaffMode: (on: boolean) => void;
  setInputMode: (mode: InputMode) => void;
  setSyncDisplay: (on: boolean) => void;
};

export const useUiStore = create<UiState>((set) => ({
  staffMode: false,
  inputMode: DEFAULT_INPUT_MODE,
  syncDisplay: false,
  setStaffMode: (on) => {
    persistFlag(STAFF_KEY, on);
    set({ staffMode: on });
  },
  setInputMode: (mode) => set({ inputMode: mode }),
  setSyncDisplay: (on) => {
    persistFlag(SYNC_KEY, on);
    setFrameSyncMode(on);
    set({ syncDisplay: on });
  },
}));

/**
 * Client-only start-up: staff mode from ?staff=1 / ?staff=0 or the saved
 * flag. Runs after hydration so server and client render the same markup.
 */
export function hydrateUiStore(): void {
  try {
    if (localStorage.getItem(SYNC_KEY) === "1") useUiStore.getState().setSyncDisplay(true);
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
