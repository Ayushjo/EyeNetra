"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FrameGlyph } from "@/components/voice/FrameGlyph";
import { HANDOFF_HI, MATERIAL_HI, NEED_HI, SHAPE_HI, TIER_HI, profileRows, rupee } from "@/components/kiosk/labels";
import type { SessionStatus, StoredSession } from "@/lib/server/sessionStore";

const POLL_MS = 1500;

const STATUS: Record<SessionStatus, { label: string; cls: string }> = {
  waiting: { label: "Needs staff", cls: "bg-alert text-white" },
  attending: { label: "Staff with customer", cls: "bg-brass text-white" },
  ai: { label: "With AI", cls: "bg-sage/15 text-sage" },
  left: { label: "Left", cls: "bg-ink/5 text-muted" },
  closed: { label: "Closed", cls: "bg-ink/5 text-muted" },
};

const STAGE_EN: Record<string, string> = {
  greet: "Welcome / need",
  rx: "Prescription",
  lifestyle: "Lifestyle",
  style: "Budget & style",
  tryon: "Trying frames",
  compare: "Comparing shortlist",
  lens: "Choosing lens",
  close: "Closing",
  handoff: "Handed to staff",
  done: "Left (warm exit)",
};

function ago(ms: number, now: number) {
  const s = Math.max(0, Math.round((now - ms) / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  return `${Math.round(m / 60)} h ago`;
}

function customerName(s: StoredSession) {
  const c = s.session?.contact;
  if (c?.name) return c.name;
  return `Guest · ${s.id.slice(-4).toUpperCase()}`;
}

/** A soft two-tone chime for "customer needs staff". */
function chime() {
  try {
    const ctx = new AudioContext();
    const t = ctx.currentTime;
    for (const [f, d] of [[880, 0], [1174.7, 0.18]] as const) {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.frequency.value = f;
      o.type = "sine";
      g.gain.setValueAtTime(0, t + d);
      g.gain.linearRampToValueAtTime(0.18, t + d + 0.02);
      g.gain.exponentialRampToValueAtTime(0.001, t + d + 0.6);
      o.connect(g).connect(ctx.destination);
      o.start(t + d);
      o.stop(t + d + 0.65);
    }
    setTimeout(() => void ctx.close(), 1200);
  } catch {
    // audio blocked until the first click — fine
  }
}

async function act(id: string, action: "accept" | "takeover" | "close", name: string) {
  const res = await fetch(`/api/sessions/${id}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action, name }),
  });
  if (!res.ok) throw new Error(`${action} failed (${res.status})`);
}

export function StaffDashboard() {
  const [sessions, setSessions] = useState<StoredSession[]>([]);
  const [now, setNow] = useState(() => Date.now());
  const [online, setOnline] = useState(true);
  const [selected, setSelected] = useState<string | null>(null);
  const [filter, setFilter] = useState<"active" | "all">("active");
  const [staffName, setStaffName] = useState("");
  const [sound, setSound] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const alerted = useRef<Map<string, number>>(new Map());

  useEffect(() => {
    try {
      setStaffName(localStorage.getItem("kg-staff-name") ?? "");
      setSound(localStorage.getItem("kg-staff-sound") !== "off");
    } catch {
      // storage blocked
    }
  }, []);

  const poll = useCallback(async () => {
    try {
      const res = await fetch("/api/sessions", { cache: "no-store" });
      const data = (await res.json()) as { sessions: StoredSession[]; now: number };
      setSessions(data.sessions);
      setNow(Date.now());
      setOnline(true);
    } catch {
      setOnline(false);
    }
  }, []);

  useEffect(() => {
    void poll();
    const id = setInterval(() => void poll(), POLL_MS);
    return () => clearInterval(id);
  }, [poll]);

  const waiting = sessions.filter((s) => s.status === "waiting");

  // Chime once per new request, then every 20 s while nobody has accepted.
  useEffect(() => {
    if (!sound) return;
    for (const s of waiting) {
      const last = alerted.current.get(s.id) ?? 0;
      if (Date.now() - last > 20_000) {
        alerted.current.set(s.id, Date.now());
        chime();
      }
    }
  }, [waiting, sound]);

  const visible = useMemo(
    () =>
      sessions.filter((s) =>
        filter === "all" ? true : s.status === "ai" || s.status === "waiting" || s.status === "attending",
      ),
    [sessions, filter],
  );
  const current = sessions.find((s) => s.id === selected) ?? visible[0] ?? null;

  const run = async (id: string, action: "accept" | "takeover" | "close") => {
    setError(null);
    try {
      await act(id, action, staffName || "Staff");
      await poll();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <div className="flex h-dvh flex-col bg-ivory font-[family-name:var(--font-hindi)] text-ink">
      <header className="flex items-center justify-between gap-6 border-b border-line bg-white/70 px-6 py-4 backdrop-blur">
        <div className="flex items-baseline gap-3">
          <span className="font-[family-name:var(--font-display)] text-2xl tracking-[0.18em]">KG OPTIC</span>
          <span className="text-base text-muted">Staff · Kiosk customers</span>
        </div>
        <div className="flex items-center gap-4">
          <span className={`flex items-center gap-2 text-sm ${online ? "text-sage" : "text-alert"}`}>
            <span className={`h-2 w-2 rounded-full ${online ? "bg-sage" : "bg-alert"}`} />
            {online ? "Live" : "Offline — retrying"}
          </span>
          <label className="flex items-center gap-2 text-sm text-muted">
            Your name
            <input
              value={staffName}
              onChange={(e) => {
                setStaffName(e.target.value);
                try {
                  localStorage.setItem("kg-staff-name", e.target.value);
                } catch {}
              }}
              placeholder="e.g. Rahul"
              className="w-36 rounded-lg border border-line bg-white px-3 py-1.5 text-base text-ink"
              data-testid="staff-name"
            />
          </label>
          <button
            type="button"
            onClick={() => {
              const v = !sound;
              setSound(v);
              try {
                localStorage.setItem("kg-staff-sound", v ? "on" : "off");
              } catch {}
              if (v) chime();
            }}
            className="rounded-lg border border-line bg-white px-3 py-1.5 text-sm"
          >
            Sound {sound ? "on" : "off"}
          </button>
        </div>
      </header>

      {waiting.length ? (
        <div className="flex flex-col gap-2 border-b border-alert/20 bg-alert/10 px-6 py-3" data-testid="alerts">
          {waiting.map((s) => (
            <div key={s.id} className="flex items-center justify-between gap-4">
              <p className="text-base">
                <span className="mr-2 inline-block h-2.5 w-2.5 animate-pulse rounded-full bg-alert" />
                <b>{customerName(s)}</b> needs staff — {HANDOFF_HI[s.handoff?.reason ?? ""] ?? s.handoff?.reason}
                <span className="ml-2 text-muted">{s.handoff ? ago(s.handoff.at, now) : ""}</span>
              </p>
              <div className="flex gap-2">
                <button type="button" onClick={() => setSelected(s.id)} className="rounded-lg border border-line bg-white px-3 py-1.5 text-sm">
                  View
                </button>
                <button
                  type="button"
                  data-testid={`accept-${s.id}`}
                  onClick={() => void run(s.id, "accept")}
                  className="rounded-lg bg-ink px-4 py-1.5 text-sm font-medium text-ivory"
                >
                  I&apos;m going
                </button>
              </div>
            </div>
          ))}
        </div>
      ) : null}

      <div className="flex min-h-0 flex-1">
        <aside className="flex w-[380px] shrink-0 flex-col border-r border-line">
          <div className="flex gap-2 p-4">
            {(["active", "all"] as const).map((f) => (
              <button
                key={f}
                type="button"
                onClick={() => setFilter(f)}
                className={`rounded-full px-4 py-1.5 text-sm ${filter === f ? "bg-ink text-ivory" : "bg-white text-muted ring-1 ring-line"}`}
              >
                {f === "active" ? `Active (${sessions.filter((s) => ["ai", "waiting", "attending"].includes(s.status)).length})` : `All (${sessions.length})`}
              </button>
            ))}
          </div>
          <ul className="min-h-0 flex-1 overflow-y-auto px-3 pb-4" data-testid="session-list">
            {visible.length === 0 ? (
              <li className="px-3 py-10 text-center text-muted">No customers at the kiosk right now.</li>
            ) : null}
            {visible.map((s) => {
              const st = STATUS[s.status];
              const need = s.session?.profile?.need;
              return (
                <li key={s.id}>
                  <button
                    type="button"
                    onClick={() => setSelected(s.id)}
                    data-testid={`session-${s.id}`}
                    className={`mb-2 w-full rounded-2xl p-4 text-left transition ${
                      current?.id === s.id ? "bg-white shadow-sm ring-1 ring-ink/20" : "hover:bg-white/60"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <span className="truncate text-lg font-medium">{customerName(s)}</span>
                      <span className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-medium ${st.cls}`}>{st.label}</span>
                    </div>
                    <p className="mt-1 truncate text-sm text-muted">
                      {need ? NEED_HI[need] ?? need : "—"} · {STAGE_EN[s.session?.stage ?? ""] ?? "Starting"} · {ago(s.updatedAt, now)}
                    </p>
                  </button>
                </li>
              );
            })}
          </ul>
        </aside>

        <main className="min-h-0 flex-1 overflow-y-auto p-8">
          {error ? <p className="mb-4 rounded-lg bg-alert/10 px-4 py-2 text-alert">{error}</p> : null}
          {current ? <Detail s={current} now={now} run={run} /> : <p className="text-muted">Select a customer.</p>}
        </main>
      </div>
    </div>
  );
}

function Detail({
  s,
  now,
  run,
}: {
  s: StoredSession;
  now: number;
  run: (id: string, a: "accept" | "takeover" | "close") => Promise<void>;
}) {
  const ss = s.session;
  const rows = profileRows(ss?.profile);
  const chosen = ss?.set.find((f) => f.sku === ss.chosen);
  const lens = ss?.lenses.find((l) => l.code === ss.lens);
  const live = s.status === "ai" || s.status === "waiting" || s.status === "attending";
  return (
    <div className="mx-auto max-w-5xl space-y-6" data-testid="detail">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="font-[family-name:var(--font-display)] text-3xl">{customerName(s)}</p>
          <p className="mt-1 text-base text-muted">
            Started {new Date(s.startedAt).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })} ·{" "}
            {STAGE_EN[ss?.stage ?? ""] ?? "Starting"} · updated {ago(s.updatedAt, now)}
            {s.staff.acceptedBy ? ` · with ${s.staff.acceptedBy}` : ""}
          </p>
          {ss?.contact?.phone ? (
            <a href={`tel:${ss.contact.phone}`} className="mt-1 inline-block text-lg font-medium text-brass-deep" data-testid="phone">
              {ss.contact.phone}
            </a>
          ) : ss?.contact?.guest ? (
            <p className="mt-1 text-base text-muted">Guest — no number shared</p>
          ) : null}
        </div>
        <div className="flex gap-2">
          {live && !s.staff.acceptedBy ? (
            <button type="button" data-testid="btn-accept" onClick={() => void run(s.id, "accept")} className="rounded-xl bg-ink px-5 py-2.5 text-base font-medium text-ivory">
              I&apos;m going
            </button>
          ) : null}
          {s.status === "ai" ? (
            <button type="button" data-testid="btn-takeover" onClick={() => void run(s.id, "takeover")} className="rounded-xl border border-ink/20 bg-white px-5 py-2.5 text-base font-medium">
              Take over (stop AI)
            </button>
          ) : null}
          {s.status !== "closed" ? (
            <button type="button" data-testid="btn-close" onClick={() => void run(s.id, "close")} className="rounded-xl border border-line bg-white px-5 py-2.5 text-base text-muted">
              Done · close
            </button>
          ) : null}
        </div>
      </div>

      {s.handoff ? (
        <div className={`rounded-2xl px-5 py-4 ${s.status === "waiting" ? "bg-alert/10 text-alert" : "bg-brass-soft text-brass-deep"}`}>
          <b>Handoff:</b> {HANDOFF_HI[s.handoff.reason] ?? s.handoff.reason}
          {ss?.handoff?.detail ? ` — “${ss.handoff.detail}”` : ""} · {ago(s.handoff.at, now)}
        </div>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="rounded-2xl bg-white p-6 ring-1 ring-line">
          <h3 className="text-sm font-semibold text-brass-deep">Consultation</h3>
          <dl className="mt-3 divide-y divide-line">
            {rows.map((r) => (
              <div key={r.key} className="flex justify-between gap-4 py-2.5">
                <dt className="text-muted">{r.label}</dt>
                <dd className="text-right font-medium">{r.value ?? "—"}</dd>
              </div>
            ))}
            {ss?.profile?.symptoms ? (
              <div className="flex justify-between gap-4 py-2.5">
                <dt className="text-muted">Symptoms</dt>
                <dd className="text-right font-medium text-alert">Headache / blur mentioned</dd>
              </div>
            ) : null}
            {ss?.profile?.rx_source === "customer" ? (
              <div className="flex justify-between gap-4 py-2.5">
                <dt className="text-muted">Power</dt>
                <dd className="text-right font-medium">Customer-provided (declined free test)</dd>
              </div>
            ) : null}
          </dl>
        </section>

        <section className="rounded-2xl bg-white p-6 ring-1 ring-line">
          <h3 className="text-sm font-semibold text-brass-deep">Order</h3>
          {chosen ? (
            <div className="mt-3 space-y-2 text-lg">
              <div className="flex justify-between"><span>{chosen.brand} {chosen.name} <span className="text-sm text-muted">({chosen.sku})</span></span><span>{rupee(chosen.price)}</span></div>
              {lens ? <div className="flex justify-between"><span>{lens.name} <span className="text-sm text-muted">({TIER_HI[lens.tier]})</span></span><span>{rupee(lens.price)}</span></div> : null}
              <div className="flex justify-between border-t border-line pt-2 text-xl font-semibold"><span>Total</span><span data-testid="staff-total">{rupee(ss?.total)}</span></div>
              <p className="text-sm text-muted">Take PD / fitting measurements, confirm delivery date, bill as per store policy.</p>
            </div>
          ) : (
            <p className="mt-3 text-muted">No frame finalised yet.</p>
          )}
        </section>
      </div>

      {ss?.set.length ? (
        <section className="rounded-2xl bg-white p-6 ring-1 ring-line">
          <h3 className="text-sm font-semibold text-brass-deep">Frames shown</h3>
          <ul className="mt-3 grid gap-3 sm:grid-cols-2">
            {ss.set.map((f) => (
              <li key={f.sku} className={`flex items-center gap-3 rounded-xl p-3 ring-1 ${f.sku === ss.chosen ? "bg-brass-soft ring-brass" : "ring-line"}`}>
                <FrameGlyph shape={f.shape} color="#1B1713" className="h-8 w-16 shrink-0" />
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{f.brand} {f.name}</p>
                  <p className="text-sm text-muted">{f.sku} · {SHAPE_HI[f.shape] ?? f.shape} · {MATERIAL_HI[f.material] ?? f.material}</p>
                </div>
                <div className="text-right">
                  <p className="font-medium">{rupee(f.price)}</p>
                  <p className="text-xs">
                    {f.sku === ss.chosen ? "Chosen" : ss.shortlist.includes(f.sku) ? "♥ Shortlisted" : ""}
                    {ss.recommended === f.sku ? " · AI recommended" : ""}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="rounded-2xl bg-white p-6 ring-1 ring-line">
        <h3 className="text-sm font-semibold text-brass-deep">Conversation</h3>
        <div className="mt-3 flex max-h-[420px] flex-col gap-2 overflow-y-auto" data-testid="transcript">
          {s.transcript.length === 0 ? <p className="text-muted">—</p> : null}
          {s.transcript.map((l) => (
            <p
              key={l.id}
              className={`max-w-[80%] rounded-2xl px-4 py-2 text-base ${
                l.role === "user" ? "self-end bg-ink/5" : "self-start bg-brass-soft/60"
              }`}
            >
              <span className="mr-2 text-xs text-muted">{l.role === "user" ? "Customer" : "AI"}</span>
              {l.text}
            </p>
          ))}
        </div>
      </section>
    </div>
  );
}
