"use client";

import { useEffect, useRef } from "react";
import { resetVoiceSession } from "@/hooks/useVoiceAgent";
import { useKioskStore } from "@/store/kioskStore";
import { useTryOnStore } from "@/store/tryOnStore";
import { useVoiceStore } from "@/store/voiceStore";

const REPORT_URL = "/api/sessions";
const HEARTBEAT_MS = 2000;
/** No speech either way for this long → the customer walked away. */
const IDLE_MS_DEFAULT = 90_000;
/** Dev e2e can shorten it with ?idle=<ms> (never in production builds). */
function idleMs() {
  if (process.env.NODE_ENV !== "production" && typeof window !== "undefined") {
    const v = Number(new URLSearchParams(window.location.search).get("idle"));
    if (v > 0) return v;
  }
  return IDLE_MS_DEFAULT;
}
/** Warm exit screen stays this long, then the kiosk is ready for the next person. */
const DONE_MS = 15_000;
/** After staff close a session, a short thank-you, then reset. */
const CLOSED_MS = 4_000;

export type KioskView = "welcome" | "consult" | "mirror" | "handoff" | "done";

/** Which screen the kiosk shows (pure — also used by tests). */
export function kioskView(): KioskView {
  const k = useKioskStore.getState();
  const v = useVoiceStore.getState();
  if (!k.sessionId) return "welcome";
  const stage = v.session?.stage;
  if (v.staff.takeover || v.localHandoff || stage === "handoff") return "handoff";
  if (stage === "done") return "done";
  if (stage && ["tryon", "compare", "lens", "close"].includes(stage)) return "mirror";
  return "consult";
}

/** Start a conversation for a new customer. */
export function startCustomer() {
  resetVoiceSession();
  useKioskStore.getState().begin();
  useVoiceStore.getState().connect();
}

/** Customer pressed "स्टाफ़ को बुलाएँ" (with or without the AI running). */
export function callStaff() {
  if (!useKioskStore.getState().sessionId) useKioskStore.getState().begin();
  useVoiceStore.getState().requestStaff();
}

/** Back to the welcome screen for the next person. */
export function resetKiosk() {
  useVoiceStore.getState().disconnect();
  resetVoiceSession();
  useKioskStore.getState().clear();
  // Next customer starts from a neutral frame.
  try {
    useTryOnStore.getState().setFrame("aviator");
  } catch {
    // catalogue without "aviator" — keep whatever is selected
  }
}

type Report = {
  id: string;
  startedAt: number;
  session: unknown;
  transcript: unknown;
  localHandoff: unknown;
  finished: string | null;
};

async function post(report: Report) {
  const res = await fetch(REPORT_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(report),
    keepalive: true,
  });
  if (!res.ok) throw new Error(`report ${res.status}`);
  return (await res.json()) as { status: string; staff: Record<string, unknown> };
}

/**
 * Mount once on the kiosk page. Keeps the staff dashboard in sync (report on
 * every change + heartbeat), applies staff actions (take over / close), ends
 * the AI after it hands off, and resets the kiosk when a customer is done or
 * walks away.
 */
export function useKioskSession() {
  const lastSent = useRef("");
  const inflight = useRef(false);

  // ---- reporting -------------------------------------------------------
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;

    const send = async (force = false) => {
      const k = useKioskStore.getState();
      if (!k.sessionId) return;
      const v = useVoiceStore.getState();
      const report: Report = {
        id: k.sessionId,
        startedAt: k.startedAt,
        session: v.session,
        transcript: v.transcript,
        localHandoff: v.localHandoff,
        finished: k.finished,
      };
      const body = JSON.stringify(report);
      if (!force && body === lastSent.current) return;
      if (inflight.current) return;
      inflight.current = true;
      try {
        const res = await post(report);
        lastSent.current = body;
        // Staff state for this customer (ignore if the kiosk moved on meanwhile).
        if (useKioskStore.getState().sessionId === report.id) {
          const staff = res.staff ?? {};
          const cur = useVoiceStore.getState().staff;
          if (JSON.stringify(cur) !== JSON.stringify(staff)) useVoiceStore.setState({ staff });
        }
        if (k.finished && useKioskStore.getState().sessionId === report.id) {
          // Final report delivered — ready for the next customer.
          resetKiosk();
        }
      } catch (e) {
        console.warn("[EyeNetra:kiosk] report failed, will retry", e);
      } finally {
        inflight.current = false;
      }
    };

    const schedule = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => void send(), 250);
    };
    const unsubV = useVoiceStore.subscribe((s, p) => {
      if (s.session !== p.session || s.transcript !== p.transcript || s.localHandoff !== p.localHandoff) schedule();
    });
    const unsubK = useKioskStore.subscribe((s, p) => {
      if (s.sessionId !== p.sessionId || s.finished !== p.finished) schedule();
      // Never get stuck if the server is unreachable: reset anyway.
      if (s.finished && !p.finished) {
        const id = s.sessionId;
        setTimeout(() => {
          if (useKioskStore.getState().sessionId === id) resetKiosk();
        }, 5000);
      }
    });
    const beat = setInterval(() => void send(true), HEARTBEAT_MS);
    return () => {
      unsubV();
      unsubK();
      clearInterval(beat);
      if (timer) clearTimeout(timer);
    };
  }, []);

  // ---- activity + lifecycle -------------------------------------------
  useEffect(() => {
    const touch = useKioskStore.getState().touch;
    let handoffSpoke = false;
    let handoffTimer: ReturnType<typeof setTimeout> | null = null;
    let doneTimer: ReturnType<typeof setTimeout> | null = null;
    let closedTimer: ReturnType<typeof setTimeout> | null = null;

    const endAI = () => {
      if (useVoiceStore.getState().status !== "idle") useVoiceStore.getState().disconnect();
    };

    const unsub = useVoiceStore.subscribe((s, p) => {
      if (s.phase !== p.phase || s.transcript !== p.transcript || s.userInterim !== p.userInterim) touch();

      // The AI handed off: let it finish its one line, then step back.
      const handoff = s.session?.stage === "handoff";
      if (handoff && !p.session?.handoff) {
        handoffSpoke = false;
        if (handoffTimer) clearTimeout(handoffTimer);
        handoffTimer = setTimeout(endAI, 15_000); // fallback if no audio events arrive
      }
      if (handoff && p.phase === "speaking" && s.phase !== "speaking") handoffSpoke = true;
      if (handoff && handoffSpoke && s.phase === "listening" && s.status === "connected") {
        handoffSpoke = false;
        if (handoffTimer) clearTimeout(handoffTimer);
        handoffTimer = setTimeout(endAI, 900);
      }

      // Staff took over from the dashboard: the AI stops right away.
      if (s.staff.takeover && !p.staff.takeover) endAI();

      // Staff closed the session: brief thank-you, then reset.
      if (s.staff.closed && !p.staff.closed) {
        endAI();
        if (closedTimer) clearTimeout(closedTimer);
        closedTimer = setTimeout(() => useKioskStore.getState().finish("left"), CLOSED_MS);
      }

      // Warm exit: stop listening after the line, reset after a while.
      if (s.session?.stage === "done" && p.session?.stage !== "done") {
        if (doneTimer) clearTimeout(doneTimer);
        doneTimer = setTimeout(() => useKioskStore.getState().finish("left"), DONE_MS);
      }
      if (p.session?.stage === "done" && s.session?.stage !== "done" && doneTimer) {
        clearTimeout(doneTimer); // they came back and kept talking
        doneTimer = null;
      }
    });

    // The AI failed mid-conversation (call dropped, or stuck "thinking"):
    // never leave the customer staring at a frozen screen — hand to staff.
    let thinkingSince = 0;
    let errorSince = 0;
    const aiFailed = (why: string) => {
      const v = useVoiceStore.getState();
      if (!useKioskStore.getState().sessionId || v.localHandoff || v.staff.takeover) return;
      if (v.session?.stage === "handoff" || v.session?.stage === "done") return;
      console.warn(`[EyeNetra:kiosk] AI unavailable (${why}) — handing to staff`);
      endAI();
      useVoiceStore.setState({ localHandoff: { reason: "ai_unavailable" } });
    };
    const unsubFail = useVoiceStore.subscribe((s, p) => {
      if (s.dropped && !p.dropped) aiFailed("call dropped");
      if (s.phase === "thinking" && p.phase !== "thinking") thinkingSince = Date.now();
      if (s.phase !== "thinking") thinkingSince = 0;
      if (s.status === "connected" && s.errorMessage && !p.errorMessage) errorSince = Date.now();
      if (s.phase === "speaking") errorSince = 0;
    });
    const watchdog = setInterval(() => {
      if (thinkingSince && Date.now() - thinkingSince > 15_000) aiFailed("no reply in 15 s");
      if (errorSince && Date.now() - errorSince > 10_000) aiFailed("service error");
    }, 1000);

    // Walked away mid-conversation (not while waiting for staff).
    const idle = setInterval(() => {
      const k = useKioskStore.getState();
      if (!k.sessionId || k.finished) return;
      const v = useVoiceStore.getState();
      const waitingForStaff = v.session?.stage === "handoff" || v.localHandoff || v.staff.takeover;
      if (waitingForStaff) {
        // Staff are expected to close it; after 10 min assume the customer was served.
        if (Date.now() - k.lastActivity > 10 * 60_000) useKioskStore.getState().finish("left");
        return;
      }
      if (v.phase === "speaking" || v.phase === "user") return;
      if (Date.now() - k.lastActivity > idleMs()) {
        useKioskStore.getState().finish("abandoned");
      }
    }, 1000);

    return () => {
      unsub();
      unsubFail();
      clearInterval(watchdog);
      clearInterval(idle);
      for (const t of [handoffTimer, doneTimer, closedTimer]) if (t) clearTimeout(t);
    };
  }, []);
}
