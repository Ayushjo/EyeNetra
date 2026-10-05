"use client";

import { useCallback, useEffect, useRef } from "react";
import { useVoiceAgent, type TryOnSuggestion } from "@/hooks/useVoiceAgent";
import { getFrameById } from "@/data/frames";
import { useTryOnStore } from "@/store/tryOnStore";

function describeTryOnModel(frameId: string, variantId: string): string {
  try {
    const frame = getFrameById(frameId);
    const variant = frame.variants.find((v) => v.id === variantId);
    return variant ? `${frame.name} · ${variant.name} (similar style)` : `${frame.name} (similar style)`;
  } catch {
    return "no 3D model mapped";
  }
}

const STATUS_LABEL: Record<string, string> = {
  idle: "Not connected",
  connecting: "Connecting…",
  connected: "Listening",
  error: "Connection failed",
};

/**
 * Voice assistant dock that lives ON the try-on page. The WebRTC session,
 * mic, bot audio, and transcript all stay alive while frames change on the
 * live face: a try_on_frame tool call from the agent selects the frame in
 * the try-on store directly — no navigation, no confirmation step (the
 * customer already asked to see it; they can say "pehle wala dikhao" or tap
 * another card to switch back).
 */
export function VoiceAgentPanel() {
  const selectedFrameId = useTryOnStore((s) => s.selectedFrameId);
  const selectedVariantId = useTryOnStore((s) => s.selectedVariantId);

  const showOnFace = useCallback((s: TryOnSuggestion) => {
    const store = useTryOnStore.getState();
    // Guard against a stale catalogue map: only ids that exist in frames.ts.
    let frame;
    try {
      frame = getFrameById(s.frameId);
    } catch {
      console.warn(`[EyeNetra:voice] try_on_frame → unknown frame id ${s.frameId}`);
      return;
    }
    // setFrame before setVariant — setFrame resets the variant to default.
    store.setFrame(frame.id);
    if (frame.variants.some((v) => v.id === s.variantId)) {
      store.setVariant(s.variantId);
    }
    // The customer must SEE the change: banner on the stage + bring the
    // face into view (the chat lives below the stage on a tall page).
    store.setShowcase({ name: s.name, brand: s.brand });
    document
      .getElementById("tryon-stage")
      ?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, []);

  const {
    status,
    errorMessage,
    transcript,
    suggestions,
    activeSku,
    setActiveSku,
    botSpeaking,
    connect,
    disconnect,
  } = useVoiceAgent({ onTryOnFrame: showOnFace });

  const transcriptEndRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    transcriptEndRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [transcript]);

  const connected = status === "connected";
  const busy = status === "connecting";

  return (
    <section
      id="voice"
      className="space-y-4 rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm"
    >
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <span
            className={`h-2.5 w-2.5 rounded-full ${
              connected
                ? botSpeaking
                  ? "bg-emerald-500 animate-pulse"
                  : "bg-emerald-400"
                : status === "error"
                  ? "bg-red-500"
                  : "bg-zinc-300"
            }`}
            aria-hidden
          />
          <div>
            <p className="text-sm font-medium text-zinc-800">
              Voice assistant · {STATUS_LABEL[status]}
              {connected && botSpeaking ? " — speaking" : ""}
            </p>
            {errorMessage ? (
              <p className="text-xs text-red-600">{errorMessage}</p>
            ) : (
              <p className="text-xs text-zinc-500">
                {connected
                  ? "Mic is live — Hindi, Hinglish or English. Frames it suggests appear on your face."
                  : "Start the assistant, then allow microphone access."}
              </p>
            )}
          </div>
        </div>
        <button
          type="button"
          onClick={() => (connected ? void disconnect() : void connect())}
          disabled={busy}
          className={`rounded-lg px-5 py-2.5 text-sm font-medium transition ${
            connected
              ? "bg-zinc-200 text-zinc-800 hover:bg-zinc-300"
              : "bg-zinc-900 text-white hover:bg-zinc-700"
          } disabled:opacity-50`}
        >
          {busy ? "Connecting…" : connected ? "End conversation" : "Talk to assistant"}
        </button>
      </div>

      {suggestions.length > 0 ? (
        <div>
          <p className="mb-2 text-xs font-medium uppercase tracking-[0.16em] text-zinc-500">
            Suggested by the assistant
          </p>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {suggestions.map((s) => {
              const onFace =
                s.sku === activeSku &&
                selectedFrameId === s.frameId &&
                selectedVariantId === s.variantId;
              return (
                <div
                  key={s.sku}
                  className={`flex items-center justify-between gap-3 rounded-xl border px-4 py-3 ${
                    onFace ? "border-emerald-400 bg-emerald-50" : "border-zinc-200 bg-white"
                  }`}
                >
                  <div>
                    <p className="text-sm font-medium text-zinc-900">{s.name}</p>
                    <p className="text-xs text-zinc-500">
                      {s.brand}
                      {onFace ? " · on your face now" : ""}
                    </p>
                    {/* The catalogue maps onto four generic 3D models — say
                        which one is actually rendered so nobody mistakes it
                        for an exact visualization of the SKU. */}
                    <p className="text-[11px] text-zinc-400">
                      Shown as: {describeTryOnModel(s.frameId, s.variantId)}
                    </p>
                  </div>
                  <button
                    type="button"
                    disabled={onFace}
                    onClick={() => {
                      setActiveSku(s.sku);
                      showOnFace(s);
                    }}
                    className="shrink-0 rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-zinc-700 disabled:bg-emerald-600"
                  >
                    {onFace ? "Showing" : "Show on me"}
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      ) : null}

      <div className="rounded-xl border border-zinc-200">
        <p className="border-b border-zinc-100 px-4 py-2 text-xs font-medium uppercase tracking-[0.16em] text-zinc-500">
          Conversation
        </p>
        <div className="flex max-h-56 min-h-24 flex-col gap-2 overflow-y-auto px-4 py-3">
          {transcript.length === 0 ? (
            <p className="text-sm text-zinc-400">
              The conversation transcript will appear here once you connect.
            </p>
          ) : (
            transcript.map((line) => (
              <p
                key={line.id}
                className={`text-sm ${
                  line.role === "user" ? "text-zinc-500" : "font-medium text-zinc-900"
                }`}
              >
                <span className="mr-2 text-[11px] uppercase tracking-wide text-zinc-400">
                  {line.role === "user" ? "You" : "Agent"}
                </span>
                {line.text}
              </p>
            ))
          )}
          <div ref={transcriptEndRef} />
        </div>
      </div>
    </section>
  );
}
