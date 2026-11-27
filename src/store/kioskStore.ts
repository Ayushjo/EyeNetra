import { create } from "zustand";

/** One customer at the kiosk, from "बात शुरू करें" until the screen resets. */
type KioskState = {
  sessionId: string | null;
  startedAt: number;
  /** Set when this customer is finished; the reporter sends it once, then the kiosk resets. */
  finished: "left" | "abandoned" | null;
  /** Last time the customer or the assistant did anything (idle timeout). */
  lastActivity: number;
  begin: () => string;
  finish: (how: "left" | "abandoned") => void;
  clear: () => void;
  touch: () => void;
};

function newId() {
  const rnd =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID().replace(/-/g, "").slice(0, 12)
      : Math.random().toString(36).slice(2, 14);
  return `c-${Date.now().toString(36)}-${rnd}`;
}

export const useKioskStore = create<KioskState>((set) => ({
  sessionId: null,
  startedAt: 0,
  finished: null,
  lastActivity: 0,
  begin: () => {
    const id = newId();
    set({ sessionId: id, startedAt: Date.now(), finished: null, lastActivity: Date.now() });
    return id;
  },
  finish: (how) => set((s) => (s.sessionId && !s.finished ? { finished: how } : {})),
  clear: () => set({ sessionId: null, startedAt: 0, finished: null }),
  touch: () => set({ lastActivity: Date.now() }),
}));
