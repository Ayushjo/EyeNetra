"use client";

import { useEffect, useMemo, useRef, useSyncExternalStore } from "react";
import { FrameGlyph } from "@/components/voice/FrameGlyph";
import { showSuggestionOnFace } from "@/components/voice/VoiceStageOverlay";
import { useVoiceAgent } from "@/hooks/useVoiceAgent";
import { callStaff, kioskView, startCustomer, useKioskSession, type KioskView } from "@/hooks/useKioskSession";
import { sfx } from "@/lib/sfx";
import { useKioskStore } from "@/store/kioskStore";
import { useVoiceStore, type KioskFrame, type KioskSession } from "@/store/voiceStore";
import { Avatar } from "./Avatar";
import { KioskMirror } from "./KioskMirror";
import {
  HANDOFF_HI,
  MATERIAL_HI,
  SAY_HINTS,
  SHAPE_HI,
  STEPS,
  TIER_HI,
  profileRows,
  rupee,
  stepIndex,
} from "./labels";

/* ------------------------------------------------------------------ */
/* State hooks                                                          */
/* ------------------------------------------------------------------ */

function subscribeView(cb: () => void) {
  const a = useVoiceStore.subscribe(cb);
  const b = useKioskStore.subscribe(cb);
  return () => {
    a();
    b();
  };
}

function useView(): KioskView {
  return useSyncExternalStore(subscribeView, kioskView, () => "welcome" as KioskView);
}

function useSession() {
  return useVoiceStore((s) => s.session);
}

/** Put the bot's current frame on the face whenever the set/current changes. */
function useFollowCurrentFrame() {
  useEffect(
    () =>
      useVoiceStore.subscribe((s, p) => {
        const cur = s.session;
        if (!cur || cur.current == null) return;
        if (p.session && p.session.current === cur.current && p.session.set === cur.set) return;
        const f = cur.set[cur.current];
        if (f?.frameId && f.variantId && f.sku !== useVoiceStore.getState().activeSku) {
          showSuggestionOnFace({ kind: "try_on_frame", sku: f.sku, name: f.name, brand: f.brand,
            frameId: f.frameId, variantId: f.variantId, price: f.price, shape: f.shape });
        }
      }),
    [],
  );
}

function canDo(session: KioskSession | null, action: string) {
  return !!session?.actions?.includes(action);
}

/* ------------------------------------------------------------------ */
/* Small parts                                                          */
/* ------------------------------------------------------------------ */

function Wordmark() {
  return (
    <div className="flex items-baseline gap-3">
      <span className="font-[family-name:var(--font-display)] text-[28px] leading-none tracking-[0.18em] text-ink">
        KG OPTIC
      </span>
      <span className="hidden text-sm text-muted xl:inline">रायपुर</span>
    </div>
  );
}

function StaffButton({ big = false }: { big?: boolean }) {
  const view = useView();
  if (view === "handoff") return <span className="w-48" aria-hidden />;
  return (
    <button
      type="button"
      data-testid="call-staff"
      onClick={() => {
        sfx.connect?.();
        callStaff();
      }}
      className={`flex items-center gap-2 rounded-full border border-ink/15 bg-white/80 font-medium text-ink shadow-sm backdrop-blur transition hover:bg-white active:scale-[0.98] ${
        big ? "px-6 py-3.5 text-lg" : "px-5 py-2.5 text-base"
      }`}
    >
      <svg viewBox="0 0 24 24" className="h-5 w-5 text-brass-deep" fill="currentColor" aria-hidden>
        <path d="M12 12a4.5 4.5 0 1 0 0-9 4.5 4.5 0 0 0 0 9Zm0 2c-4.4 0-8 2.2-8 5v1.5h16V19c0-2.8-3.6-5-8-5Z" />
      </svg>
      स्टाफ़ को बुलाएँ
    </button>
  );
}

function Stepper() {
  const stage = useVoiceStore((s) => s.session?.stage);
  const need = useVoiceStore((s) => s.session?.profile.need);
  const at = stepIndex(stage);
  const skip = (key: string) =>
    (key === "rx" && (need === "sunglasses" || need === "browsing")) ||
    (key === "lens" && (need === "sunglasses" || need === "browsing"));
  return (
    <ol className="hidden items-center gap-1 lg:flex" aria-label="आपकी यात्रा">
      {STEPS.map((s, i) => {
        const done = i < at;
        const now = i === at;
        if (skip(s.key) && !now) return null;
        return (
          <li key={s.key} className="flex items-center gap-1">
            {i > 0 ? <span className={`h-px w-6 ${done || now ? "bg-brass" : "bg-line"}`} /> : null}
            <span
              className={`flex items-center gap-1.5 rounded-full px-3 py-1 text-sm transition ${
                now ? "bg-ink text-ivory" : done ? "text-brass-deep" : "text-muted/70"
              }`}
            >
              {done ? (
                <svg viewBox="0 0 20 20" className="h-3.5 w-3.5" fill="currentColor" aria-hidden>
                  <path d="M7.7 13.6 4.2 10l-1.2 1.2 4.7 4.7 10-10-1.2-1.2z" />
                </svg>
              ) : null}
              {s.label}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

function TopBar() {
  const view = useView();
  return (
    <header className="flex h-20 shrink-0 items-center justify-between gap-6 px-6 lg:px-10">
      <Wordmark />
      {view === "consult" || view === "mirror" ? <Stepper /> : <span />}
      <StaffButton />
    </header>
  );
}

const PHASE_TEXT: Record<string, string> = {
  connecting: "जुड़ रहा हूँ…",
  listening: "आप बोलिए, मैं सुन रहा हूँ",
  user: "सुन रहा हूँ…",
  thinking: "एक पल…",
  speaking: "",
  error: "",
  off: "",
};

function ListeningPill() {
  const phase = useVoiceStore((s) => s.phase);
  const text = PHASE_TEXT[phase];
  if (!text) return null;
  const active = phase === "user" || phase === "listening";
  return (
    <div className="flex items-center gap-2.5 rounded-full bg-white/80 px-4 py-2 text-base text-ink shadow-sm backdrop-blur" data-testid="listen-pill">
      <span className="flex h-4 items-end gap-[3px]" aria-hidden>
        {[0, 1, 2, 3].map((i) => (
          <span
            key={i}
            className={`w-[3px] rounded-full ${active ? "kiosk-bar bg-sage" : "h-1.5 bg-muted/60"}`}
            style={active ? { height: "100%", animationDelay: `${i * 120}ms`, animationDuration: phase === "user" ? "520ms" : "1100ms" } : undefined}
          />
        ))}
      </span>
      {text}
    </div>
  );
}

/** What the assistant is saying (and what we heard), under the avatar. */
function Caption({ size = "lg" }: { size?: "lg" | "sm" }) {
  const bot = useVoiceStore((s) => s.botCaption);
  const interim = useVoiceStore((s) => s.userInterim);
  // Last line is the customer's (bot has not answered yet) → show what we heard.
  const lastUserText = useVoiceStore((s) => {
    const l = s.transcript[s.transcript.length - 1];
    return l?.role === "user" ? l.text : "";
  });
  const heard = interim || lastUserText;
  const text = bot.length > 220 ? "…" + bot.slice(-220) : bot;
  return (
    <div className="flex flex-col gap-3" aria-live="polite">
      {text ? (
        <p
          data-testid="bot-caption"
          className={`font-[family-name:var(--font-display)] leading-snug text-ink ${size === "lg" ? "text-[28px] xl:text-[32px]" : "text-xl"}`}
        >
          {text}
        </p>
      ) : null}
      {heard ? (
        <p className={`text-muted ${size === "lg" ? "text-lg" : "text-base"}`} data-testid="heard">
          <span className="mr-2 rounded-md bg-ink/5 px-2 py-0.5 text-sm text-muted">आप</span>
          {heard}
        </p>
      ) : null}
    </div>
  );
}

function Hints() {
  const stage = useVoiceStore((s) => s.session?.stage ?? "greet");
  const phase = useVoiceStore((s) => s.phase);
  const hints = SAY_HINTS[stage];
  if (!hints || phase === "connecting" || phase === "off") return null;
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-sm text-muted">ऐसे बोल सकते हैं:</span>
      {hints.map((h) => (
        <span key={h} className="rounded-full border border-line bg-white/70 px-3 py-1 text-sm text-ink/80">
          “{h}”
        </span>
      ))}
    </div>
  );
}

function VoiceError() {
  const status = useVoiceStore((s) => s.status);
  const err = useVoiceStore((s) => s.errorMessage);
  const connect = useVoiceStore((s) => s.connect);
  if (status !== "error") return null;
  return (
    <div className="kiosk-rise rounded-3xl border border-alert/20 bg-white p-6" data-testid="voice-error">
      <p className="text-xl font-semibold text-ink">आवाज़ सहायक से जुड़ नहीं पाए</p>
      <p className="mt-1 text-base text-muted">
        {/microphone|permission|NotAllowed/i.test(err ?? "") ? "माइक की अनुमति दीजिए।" : "इंटरनेट या सर्वर में दिक़्क़त है।"}
      </p>
      <div className="mt-4 flex gap-3">
        <button type="button" onClick={() => connect()} className="rounded-full bg-ink px-6 py-3 text-base font-medium text-ivory">
          फिर कोशिश करें
        </button>
        <StaffButton />
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Views                                                                */
/* ------------------------------------------------------------------ */

function Welcome() {
  return (
    <div className="flex min-h-0 flex-1 flex-col items-center gap-8 px-6 pb-10 lg:flex-row lg:gap-16 lg:px-16" data-testid="view-welcome">
      <button
        type="button"
        onClick={startCustomer}
        className="group relative flex aspect-[4/5] h-[46vh] shrink-0 items-end justify-center overflow-hidden rounded-t-[999px] rounded-b-[40px] bg-gradient-to-b from-cream to-sand shadow-[0_40px_90px_-40px_rgba(90,60,20,0.55)] lg:h-[74vh]"
        aria-label="बात शुरू करें"
      >
        <span className="kiosk-pulse-ring absolute inset-[8%] rounded-t-[999px] rounded-b-[40px] border-2 border-brass/40" aria-hidden />
        <Avatar mood="idle" className="relative w-[92%] transition-transform duration-500 group-hover:scale-[1.02]" />
      </button>
      <div className="kiosk-rise flex max-w-xl flex-col items-center text-center lg:items-start lg:text-left">
        <p className="text-lg tracking-[0.25em] text-brass-deep">KG OPTIC</p>
        <h1 className="mt-3 font-[family-name:var(--font-display)] text-6xl leading-[1.1] text-ink xl:text-7xl">
          नमस्ते जी
        </h1>
        <p className="mt-5 text-2xl leading-relaxed text-ink/80">
          मैं आरव हूँ। आपकी ज़रूरत समझकर, आपके लिए सही चश्मा चुनने में मदद करूँगा।
        </p>
        <button
          type="button"
          onClick={startCustomer}
          data-testid="start"
          className="mt-10 flex items-center gap-4 rounded-full bg-ink py-5 pl-6 pr-9 text-2xl font-medium text-ivory shadow-[0_20px_40px_-18px_rgba(27,23,19,0.8)] transition hover:bg-[#2a241e] active:scale-[0.98]"
        >
          <span className="flex h-12 w-12 items-center justify-center rounded-full bg-brass">
            <svg viewBox="0 0 24 24" className="h-6 w-6 text-white" fill="currentColor" aria-hidden>
              <path d="M12 14a3 3 0 0 0 3-3V5a3 3 0 1 0-6 0v6a3 3 0 0 0 3 3Zm5-3a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.92V21h2v-3.08A7 7 0 0 0 19 11h-2Z" />
            </svg>
          </span>
          बात शुरू करें
        </button>
        <p className="mt-5 text-base text-muted">हिंदी, Hinglish या English — जैसे चाहें बोलिए</p>
      </div>
    </div>
  );
}

function AvatarStage() {
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-end" data-testid="avatar-stage">
      <div className="absolute inset-x-0 top-0 h-2/3 bg-[radial-gradient(ellipse_at_50%_30%,rgba(255,255,255,0.7),transparent_65%)]" />
      <Avatar className="relative h-[86%] max-w-[92%]" />
      <div className="absolute left-6 top-6">
        <ListeningPill />
      </div>
    </div>
  );
}

function ConsultPanel() {
  const session = useSession();
  const rows = profileRows(session?.profile);
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-6" data-testid="view-consult">
      <div className="min-h-[7.5rem]">
        <Caption />
      </div>
      <VoiceError />
      <div className="rounded-[28px] bg-white/85 p-7 shadow-[0_20px_50px_-30px_rgba(60,40,10,0.35)] ring-1 ring-line" data-testid="profile-card">
        <p className="text-sm font-medium text-brass-deep">आपकी जानकारी</p>
        <dl className="mt-4 divide-y divide-line">
          {rows.map((r) => (
            <div key={r.key} className="flex items-baseline justify-between gap-6 py-3.5" data-row={r.key}>
              <dt className="shrink-0 text-base text-muted">{r.label}</dt>
              <dd
                key={r.value ?? "empty"}
                className={`rounded-lg px-2 text-right text-lg ${r.value ? "kiosk-fill font-medium text-ink" : "text-muted/50"}`}
              >
                {r.value ?? "—"}
              </dd>
            </div>
          ))}
        </dl>
        <p className="mt-4 text-sm text-muted">
          आपकी ज़रूरत समझने के बाद ही फ्रेम दिखाए जाएँगे — सीधे आपके चेहरे पर।
        </p>
      </div>
      <div className="mt-auto">
        <Hints />
      </div>
    </div>
  );
}

function MiniAvatarCaption() {
  return (
    <div className="flex items-start gap-4">
      <div className="relative h-24 w-24 shrink-0 overflow-hidden rounded-full bg-gradient-to-b from-cream to-sand ring-1 ring-line">
        <Avatar className="absolute left-1/2 top-1 w-[118%] -translate-x-1/2" />
      </div>
      <div className="min-w-0 flex-1 pt-1">
        <Caption size="sm" />
        <div className="mt-2">
          <ListeningPill />
        </div>
      </div>
    </div>
  );
}

function FrameCard({
  f,
  i,
  active,
  liked,
  recommended,
  onTap,
}: {
  f: KioskFrame;
  i: number;
  active: boolean;
  liked: boolean;
  recommended?: boolean;
  onTap?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onTap}
      disabled={!onTap}
      data-testid={`frame-card-${f.sku}`}
      data-active={active}
      className={`relative flex w-full items-center gap-4 rounded-2xl border p-4 text-left transition ${
        active ? "border-ink bg-white shadow-[0_16px_40px_-24px_rgba(27,23,19,0.6)]" : "border-line bg-white/60 hover:bg-white"
      }`}
    >
      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-ink/5 text-sm text-muted">{i + 1}</span>
      <FrameGlyph shape={f.shape} color={active ? "#1B1713" : "#7c7166"} className="h-10 w-20 shrink-0" />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-lg font-medium text-ink">{f.name}</span>
        <span className="block truncate text-sm text-muted">
          {f.brand} · {SHAPE_HI[f.shape] ?? f.shape} · {MATERIAL_HI[f.material] ?? f.material}
        </span>
      </span>
      <span className="shrink-0 text-right">
        <span className="block text-lg font-semibold text-ink">{rupee(f.price)}</span>
        {recommended ? <span className="block text-xs font-medium text-brass-deep">मेरी सलाह</span> : null}
      </span>
      {liked ? (
        <svg viewBox="0 0 24 24" className="absolute -right-2 -top-2 h-6 w-6 text-alert drop-shadow" fill="currentColor" aria-label="पसंद">
          <path d="M12 21s-7.5-4.9-9.8-9.2C.6 8.6 2.4 5.4 5.6 5.4c1.9 0 3.4 1 4.3 2.5L12 10.6l2.1-2.7c.9-1.5 2.4-2.5 4.3-2.5 3.2 0 5 3.2 3.4 6.4C19.5 16.1 12 21 12 21Z" />
        </svg>
      ) : null}
    </button>
  );
}

function ActionButton({
  label,
  onClick,
  enabled,
  primary = false,
  testid,
}: {
  label: string;
  onClick: () => void;
  enabled: boolean;
  primary?: boolean;
  testid?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!enabled}
      data-testid={testid}
      className={`flex-1 rounded-full px-5 py-4 text-lg font-medium transition active:scale-[0.98] disabled:opacity-40 ${
        primary ? "bg-ink text-ivory hover:bg-[#2a241e]" : "border border-ink/15 bg-white text-ink hover:bg-ivory"
      }`}
    >
      {label}
    </button>
  );
}

function FramesPanel() {
  const session = useSession()!;
  const send = useVoiceStore((s) => s.sendAction);
  const comparing = session.stage === "compare";
  const list = comparing ? session.set.filter((f) => session.shortlist.includes(f.sku)) : session.set;
  const activeSku = useVoiceStore((s) => s.activeSku);
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4" data-testid="frames-panel">
      <div className="flex items-baseline justify-between">
        <p className="text-sm font-medium text-brass-deep">
          {comparing ? "आपकी पसंद" : "आपके लिए चुने गए फ्रेम"}
        </p>
        {session.shortlist.length ? (
          <p className="text-sm text-muted">पसंद में {session.shortlist.length} / 3</p>
        ) : null}
      </div>
      <div className="flex min-h-0 flex-col gap-3 overflow-y-auto pb-1 pr-1">
        {list.map((f) => {
          const i = session.set.indexOf(f);
          return (
            <FrameCard
              key={f.sku}
              f={f}
              i={comparing ? session.shortlist.indexOf(f.sku) : i}
              active={f.sku === activeSku}
              liked={session.shortlist.includes(f.sku)}
              recommended={comparing && session.recommended === f.sku}
              onTap={
                comparing
                  ? canDo(session, "show_shortlisted")
                    ? () => send("show_shortlisted", { number: session.shortlist.indexOf(f.sku) + 1 })
                    : undefined
                  : canDo(session, "show_option")
                    ? () => send("show_option", { number: i + 1 })
                    : undefined
              }
            />
          );
        })}
      </div>
      <div className="mt-auto flex gap-3">
        {comparing ? (
          <ActionButton
            label={`${list.find((f) => f.sku === activeSku)?.name ?? "यही"} फ़ाइनल करें`}
            primary
            enabled={canDo(session, "choose_frame")}
            testid="btn-choose"
            onClick={() => {
              const n = session.shortlist.indexOf(activeSku ?? "") + 1;
              send("choose_frame", n > 0 ? { number: n } : {});
            }}
          />
        ) : (
          <>
            <ActionButton label="♡ पसंद में रखें" enabled={canDo(session, "like_frame")} testid="btn-like" onClick={() => send("like_frame")} />
            <ActionButton label="अगला →" enabled={canDo(session, "next_frame")} testid="btn-next" onClick={() => send("next_frame")} />
            <ActionButton label="यही लूँगा" primary enabled={canDo(session, "choose_frame")} testid="btn-choose" onClick={() => send("choose_frame")} />
          </>
        )}
      </div>
      {!comparing && canDo(session, "more_frames") ? (
        <ActionButton label="और फ्रेम दिखाइए" enabled testid="btn-more" onClick={() => send("more_frames")} />
      ) : null}
    </div>
  );
}

function ChosenFrameRow({ session }: { session: KioskSession }) {
  const f = session.set.find((x) => x.sku === session.chosen);
  if (!f) return null;
  return (
    <div className="flex items-center gap-4 rounded-2xl bg-white/70 p-4 ring-1 ring-line">
      <FrameGlyph shape={f.shape} color="#1B1713" className="h-9 w-[4.5rem] shrink-0" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-lg font-medium">{f.name}</p>
        <p className="text-sm text-muted">{f.brand} · फ्रेम</p>
      </div>
      <p className="text-lg font-semibold">{rupee(f.price)}</p>
    </div>
  );
}

function LensPanel() {
  const session = useSession()!;
  const send = useVoiceStore((s) => s.sendAction);
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4" data-testid="lens-panel">
      <ChosenFrameRow session={session} />
      <p className="mt-2 text-sm font-medium text-brass-deep">लेंस चुनिए</p>
      <div className="flex flex-col gap-3">
        {session.lenses.map((l) => (
          <button
            key={l.code}
            type="button"
            data-testid={`lens-${l.code}`}
            disabled={!canDo(session, "choose_lens")}
            onClick={() => send("choose_lens", { code: l.code })}
            className={`relative rounded-2xl border p-5 text-left transition active:scale-[0.99] ${
              l.recommended ? "border-brass bg-white shadow-[0_16px_40px_-24px_rgba(124,92,46,0.6)]" : "border-line bg-white/60 hover:bg-white"
            }`}
          >
            {l.recommended ? (
              <span className="absolute -top-3 left-5 rounded-full bg-brass px-3 py-0.5 text-xs font-medium text-white">मेरी सलाह</span>
            ) : null}
            <span className="flex items-baseline justify-between gap-4">
              <span className="text-lg font-medium text-ink">
                <span className="mr-2 text-sm font-normal text-muted">{TIER_HI[l.tier]}</span>
                {l.name}
              </span>
              <span className="text-lg font-semibold">{rupee(l.price)}</span>
            </span>
            <span className="mt-1 block text-base text-muted">{l.reason}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

function Summary({ session }: { session: KioskSession }) {
  const f = session.set.find((x) => x.sku === session.chosen);
  const l = session.lenses.find((x) => x.code === session.lens);
  if (!f) return null;
  return (
    <div className="rounded-[24px] bg-white p-6 ring-1 ring-line" data-testid="summary">
      <p className="text-sm font-medium text-brass-deep">आपका चश्मा</p>
      <div className="mt-3 space-y-2 text-lg">
        <div className="flex justify-between gap-4">
          <span>
            {f.brand} {f.name}
          </span>
          <span>{rupee(f.price)}</span>
        </div>
        {l ? (
          <div className="flex justify-between gap-4">
            <span>{l.name} लेंस</span>
            <span>{rupee(l.price)}</span>
          </div>
        ) : null}
        <div className="flex justify-between gap-4 border-t border-line pt-3 text-xl font-semibold">
          <span>कुल</span>
          <span data-testid="total">{rupee(session.total)}</span>
        </div>
      </div>
      <p className="mt-3 text-sm text-muted">नाप, बिलिंग और डिलीवरी की तारीख़ हमारे स्टाफ़ बताएँगे।</p>
    </div>
  );
}

function ClosePanel() {
  const session = useSession()!;
  const send = useVoiceStore((s) => s.sendAction);
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-5" data-testid="close-panel">
      <Summary session={session} />
      <div className="rounded-[24px] bg-brass-soft/60 p-6">
        <p className="text-xl font-medium text-ink">बिल WhatsApp पर चाहिए?</p>
        <p className="mt-1 text-base text-muted">अपना नाम और मोबाइल नंबर बोलिए। न देना चाहें तो कोई बात नहीं।</p>
        <div className="mt-4 flex">
          <ActionButton label="बिना नंबर आगे बढ़ें" enabled={canDo(session, "skip_contact")} testid="btn-skip" onClick={() => send("skip_contact")} />
        </div>
      </div>
    </div>
  );
}

function MirrorPanel() {
  const stage = useVoiceStore((s) => s.session?.stage);
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-6" data-testid="view-mirror">
      <MiniAvatarCaption />
      {stage === "lens" ? <LensPanel /> : stage === "close" ? <ClosePanel /> : <FramesPanel />}
    </div>
  );
}

function CurrentFrameTag() {
  const session = useSession();
  const activeSku = useVoiceStore((s) => s.activeSku);
  const f = session?.set.find((x) => x.sku === activeSku);
  if (!f) return null;
  const i = session!.set.indexOf(f);
  return (
    <div className="pointer-events-none absolute bottom-5 left-1/2 z-30 -translate-x-1/2" data-testid="frame-tag">
      <div key={f.sku} className="kiosk-rise flex items-center gap-4 rounded-full bg-white/90 py-2.5 pl-4 pr-6 shadow-lg backdrop-blur">
        <FrameGlyph shape={f.shape} color="#1B1713" className="h-7 w-14" />
        <span className="text-lg font-medium text-ink">{f.name}</span>
        <span className="text-lg text-muted">{rupee(f.price)}</span>
        {session!.stage === "tryon" ? <span className="text-sm text-muted">{i + 1} / {session!.set.length}</span> : null}
      </div>
    </div>
  );
}

function HandoffPanel() {
  const session = useSession();
  const staff = useVoiceStore((s) => s.staff);
  const local = useVoiceStore((s) => s.localHandoff);
  const reason = session?.handoff?.reason ?? local?.reason ?? (staff.takeover ? "staff_takeover" : "customer_request");
  const name = session?.contact?.name;
  const title = staff.closed
    ? "धन्यवाद! फिर मिलेंगे 🙏"
    : staff.acceptedBy
      ? `${staff.acceptedBy} आपकी मदद के लिए आ रहे हैं`
      : "हमारे स्टाफ़ बस आ रहे हैं";
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-6" data-testid="view-handoff">
      <div className="kiosk-rise rounded-[28px] bg-ink p-8 text-ivory">
        <p className="text-sm font-medium text-brass-soft/80">{HANDOFF_HI[reason] ?? "स्टाफ़"}</p>
        <p className="mt-3 font-[family-name:var(--font-display)] text-4xl leading-snug" data-testid="handoff-title">
          {name && !staff.closed ? `${name} जी, ` : ""}
          {title}
        </p>
        {!staff.closed ? (
          <p className="mt-4 flex items-center gap-3 text-lg text-ivory/70">
            <span className="relative flex h-3 w-3">
              <span className="kiosk-pulse-ring absolute inset-0 rounded-full bg-brass" />
              <span className="relative h-3 w-3 rounded-full bg-brass" />
            </span>
            {staff.acceptedBy ? "आपकी जानकारी उन तक पहुँच गई है।" : "आपकी पूरी जानकारी स्टाफ़ की स्क्रीन पर है, कुछ दोहराना नहीं पड़ेगा।"}
          </p>
        ) : null}
      </div>
      {session?.chosen ? <Summary session={session} /> : null}
      {!session?.chosen && session?.shortlist.length ? (
        <div className="rounded-[24px] bg-white p-6 ring-1 ring-line">
          <p className="text-sm font-medium text-brass-deep">आपकी पसंद</p>
          <ul className="mt-3 space-y-2 text-lg">
            {session.set.filter((f) => session.shortlist.includes(f.sku)).map((f) => (
              <li key={f.sku} className="flex justify-between"><span>{f.brand} {f.name}</span><span>{rupee(f.price)}</span></li>
            ))}
          </ul>
        </div>
      ) : null}
      {!session?.chosen && !session?.shortlist.length && session?.profile?.need ? (
        <div className="rounded-[24px] bg-white p-6 ring-1 ring-line">
          <p className="text-sm font-medium text-brass-deep">आपकी जानकारी</p>
          <dl className="mt-2 divide-y divide-line">
            {profileRows(session.profile).filter((r) => r.value).map((r) => (
              <div key={r.key} className="flex justify-between gap-6 py-2.5 text-lg">
                <dt className="text-muted">{r.label}</dt>
                <dd className="font-medium">{r.value}</dd>
              </div>
            ))}
          </dl>
        </div>
      ) : null}
      {session?.set.length ? (
        <p className="mt-auto text-base text-muted">तब तक आईने में फ्रेम देखते रहिए — नीचे किसी भी फ्रेम को छूकर पहनिए।</p>
      ) : null}
      {session?.set.length ? (
        <div className="flex flex-wrap gap-2">
          {session.set.map((f) => (
            <button
              key={f.sku}
              type="button"
              onClick={() =>
                f.frameId && f.variantId &&
                showSuggestionOnFace({ kind: "try_on_frame", sku: f.sku, name: f.name, brand: f.brand, frameId: f.frameId, variantId: f.variantId })
              }
              className="rounded-full border border-line bg-white px-4 py-2 text-base"
            >
              {f.name}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function DonePanel() {
  const session = useSession();
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-6" data-testid="view-done">
      <div className="kiosk-rise">
        <p className="font-[family-name:var(--font-display)] text-5xl leading-tight">धन्यवाद जी 🙏</p>
        <p className="mt-4 text-2xl text-ink/80">आप आराम से decide कीजिए — जब भी ready हों, हम यहीं हैं।</p>
      </div>
      {session?.shortlist.length ? (
        <div className="rounded-[24px] bg-white p-6 ring-1 ring-line">
          <p className="text-sm font-medium text-brass-deep">आपकी पसंद नोट कर ली है</p>
          <ul className="mt-3 space-y-2 text-lg">
            {session.set.filter((f) => session.shortlist.includes(f.sku)).map((f) => (
              <li key={f.sku} className="flex justify-between"><span>{f.brand} {f.name}</span><span>{rupee(f.price)}</span></li>
            ))}
          </ul>
        </div>
      ) : null}
      <button type="button" onClick={() => useKioskStore.getState().finish("left")} className="mt-auto self-start rounded-full border border-ink/15 bg-white px-6 py-3 text-base">
        नया ग्राहक
      </button>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* App                                                                  */
/* ------------------------------------------------------------------ */

export function KioskApp() {
  useVoiceAgent({ onTryOnFrame: showSuggestionOnFace });
  useKioskSession();
  useFollowCurrentFrame();
  const view = useView();
  const sessionId = useKioskStore((s) => s.sessionId);
  const hasSet = useVoiceStore((s) => (s.session?.set.length ?? 0) > 0);
  const mirrorVisible = view === "mirror" || ((view === "handoff" || view === "done") && hasSet);

  // Sound cues.
  const prevView = useRef(view);
  useEffect(() => {
    if (prevView.current !== view && view === "mirror") sfx.drop?.();
    prevView.current = view;
  }, [view]);
  useEffect(
    () =>
      useVoiceStore.subscribe((s, p) => {
        if (s.status === "connected" && p.status !== "connected") sfx.connect?.();
        if (s.likeSeq > p.likeSeq) sfx.like?.();
      }),
    [],
  );

  const right = useMemo(() => {
    switch (view) {
      case "consult":
        return <ConsultPanel />;
      case "mirror":
        return <MirrorPanel />;
      case "handoff":
        return <HandoffPanel />;
      case "done":
        return <DonePanel />;
      default:
        return null;
    }
  }, [view]);

  return (
    <div className="flex h-dvh w-full flex-col overflow-hidden bg-ivory font-[family-name:var(--font-hindi)] text-ink" data-view={view}>
      <TopBar />
      {view === "welcome" ? (
        <Welcome />
      ) : (
        <main className="flex min-h-0 flex-1 flex-col gap-6 px-6 pb-6 lg:flex-row lg:gap-8 lg:px-10 lg:pb-10">
          <section className="relative min-h-[40vh] flex-[1.4] overflow-hidden rounded-[32px] bg-gradient-to-b from-cream to-sand lg:min-h-0">
            <div className="absolute inset-4">
              <KioskMirror warm={!!sessionId} visible={mirrorVisible} />
            </div>
            {mirrorVisible ? <CurrentFrameTag /> : <AvatarStage />}
          </section>
          <aside key={view} className="kiosk-rise flex min-h-0 flex-1 flex-col lg:max-w-[560px]">
            {right}
          </aside>
        </main>
      )}
    </div>
  );
}
