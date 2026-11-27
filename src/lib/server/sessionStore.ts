import { promises as fs } from "node:fs";
import path from "node:path";
import type { KioskSession, StaffState, TranscriptLine } from "@/store/voiceStore";

/**
 * Customer sessions shared by the kiosk (writer) and the staff dashboard
 * (reader + staff actions). One Next.js server on the shop PC: kept in
 * memory, persisted to .data/kiosk-sessions.json after every change (atomic
 * write) so a restart loses nothing.
 */

export type SessionStatus =
  | "ai" // talking with the AI
  | "waiting" // asked for staff, nobody has accepted yet
  | "attending" // a staff member accepted
  | "left" // walked away / warm exit without buying
  | "closed"; // staff marked it done

export type StoredSession = {
  id: string;
  kiosk: string;
  startedAt: number;
  updatedAt: number;
  /** Set when the kiosk stops reporting (customer gone / next customer). */
  endedAt?: number;
  status: SessionStatus;
  session: KioskSession | null;
  transcript: TranscriptLine[];
  handoff: { reason: string; at: number } | null;
  staff: StaffState;
};

export type KioskReport = {
  id: string;
  kiosk?: string;
  startedAt: number;
  session: KioskSession | null;
  transcript: TranscriptLine[];
  /** Handoff requested on the kiosk itself (button while AI off, or staff took over). */
  localHandoff?: { reason: string } | null;
  /** The kiosk moved on (next customer / timeout). */
  finished?: "left" | "abandoned" | null;
};

const MAX_SESSIONS = 300;
const FILE = path.join(process.cwd(), ".data", "kiosk-sessions.json");

type Store = { sessions: Map<string, StoredSession>; loaded: boolean; writing: Promise<void> };
const g = globalThis as unknown as { __kioskStore?: Store };
const store: Store = (g.__kioskStore ??= { sessions: new Map(), loaded: false, writing: Promise.resolve() });

async function load() {
  if (store.loaded) return;
  store.loaded = true;
  try {
    const raw = JSON.parse(await fs.readFile(FILE, "utf8")) as StoredSession[];
    for (const s of raw) store.sessions.set(s.id, s);
  } catch {
    // first run / unreadable file: start empty
  }
}

function persist() {
  const data = JSON.stringify([...store.sessions.values()]);
  store.writing = store.writing.then(async () => {
    try {
      await fs.mkdir(path.dirname(FILE), { recursive: true });
      const tmp = `${FILE}.${process.pid}.tmp`;
      await fs.writeFile(tmp, data, "utf8");
      await fs.rename(tmp, FILE);
    } catch (e) {
      console.error("[kiosk-store] persist failed", e);
    }
  });
  return store.writing;
}

function prune() {
  if (store.sessions.size <= MAX_SESSIONS) return;
  const oldest = [...store.sessions.values()].sort((a, b) => a.updatedAt - b.updatedAt);
  for (const s of oldest.slice(0, store.sessions.size - MAX_SESSIONS)) store.sessions.delete(s.id);
}

function deriveStatus(s: StoredSession, report: KioskReport): SessionStatus {
  if (s.staff.closed) return "closed";
  if (s.handoff) return s.staff.acceptedBy ? "attending" : "waiting";
  if (report.finished || report.session?.stage === "done") return "left";
  return "ai";
}

/** Kiosk heartbeat / change report. Returns the staff state for the kiosk. */
export async function reportFromKiosk(report: KioskReport): Promise<StoredSession> {
  await load();
  const now = Date.now();
  const prev = store.sessions.get(report.id);
  const s: StoredSession = prev ?? {
    id: report.id,
    kiosk: report.kiosk ?? "kiosk-1",
    startedAt: report.startedAt || now,
    updatedAt: now,
    status: "ai",
    session: null,
    transcript: [],
    handoff: null,
    staff: {},
  };
  s.updatedAt = now;
  if (report.session) s.session = report.session;
  if (Array.isArray(report.transcript) && report.transcript.length >= s.transcript.length) {
    s.transcript = report.transcript.slice(-400);
  }
  const reason = report.session?.handoff?.reason ?? report.localHandoff?.reason;
  if (reason && !s.handoff) s.handoff = { reason, at: now };
  if (report.finished && !s.endedAt) s.endedAt = now;
  s.status = deriveStatus(s, report);
  store.sessions.set(s.id, s);
  prune();
  await persist();
  return s;
}

/** The kiosk reports every 2 s while a customer is with the AI; silence
 *  this long means the kiosk was closed / crashed / lost power. */
const STALE_MS = 30_000;

function expireStale(now = Date.now()) {
  let changed = false;
  for (const s of store.sessions.values()) {
    if (s.status === "ai" && now - s.updatedAt > STALE_MS) {
      s.status = "left";
      s.endedAt ??= s.updatedAt;
      changed = true;
    }
  }
  if (changed) void persist();
}

export async function listSessions(): Promise<StoredSession[]> {
  await load();
  expireStale();
  return [...store.sessions.values()].sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function getSession(id: string): Promise<StoredSession | null> {
  await load();
  expireStale();
  return store.sessions.get(id) ?? null;
}

export type StaffAction = { action: "accept" | "takeover" | "close"; name?: string };

export async function staffAction(id: string, a: StaffAction): Promise<StoredSession | null> {
  await load();
  const s = store.sessions.get(id);
  if (!s) return null;
  const now = Date.now();
  const name = (a.name ?? "").trim().slice(0, 40) || "Staff";
  if (a.action === "accept") {
    s.staff = { ...s.staff, acceptedBy: name, acceptedAt: now };
    if (!s.handoff) s.handoff = { reason: "staff_initiated", at: now };
  } else if (a.action === "takeover") {
    s.staff = { ...s.staff, takeover: true, acceptedBy: s.staff.acceptedBy ?? name, acceptedAt: s.staff.acceptedAt ?? now };
    if (!s.handoff) s.handoff = { reason: "staff_takeover", at: now };
  } else if (a.action === "close") {
    s.staff = { ...s.staff, closed: true };
    s.endedAt ??= now;
  } else {
    return null;
  }
  s.status = s.staff.closed ? "closed" : s.handoff ? (s.staff.acceptedBy ? "attending" : "waiting") : s.status;
  s.updatedAt = now;
  await persist();
  return s;
}

/** Test helper: wipe everything. */
export async function clearSessions() {
  store.sessions.clear();
  store.loaded = true;
  await persist();
}
