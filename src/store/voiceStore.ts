import { create } from "zustand";

export type VoiceStatus = "idle" | "connecting" | "connected" | "error";

/**
 * What the assistant is doing right now — drives the orb and captions.
 *   listening : connected, nobody talking
 *   user      : the customer is speaking (Sarvam VAD start → stop)
 *   thinking  : customer finished, bot has not started audio yet
 *   speaking  : bot audio playing
 */
export type VoicePhase = "off" | "connecting" | "listening" | "user" | "thinking" | "speaking" | "error";

export type TryOnSuggestion = {
  kind: "try_on_frame";
  sku: string;
  name: string;
  brand: string;
  frameId: string;
  variantId: string;
  /** Rupees, and catalogue shape — sent by bot.py on codex/voice-ui. */
  price?: number;
  shape?: string;
  /** 0-based position in the current shortlist, and its length. */
  index?: number;
  total?: number;
};

/** One frame of the curated set (flow.py _ui_frame). */
export type KioskFrame = {
  sku: string;
  name: string;
  brand: string;
  price: number;
  shape: string;
  material: string;
  type?: string;
  frameId: string | null;
  variantId: string | null;
};

export type KioskLens = {
  code: string;
  name: string;
  price: number;
  tier: "good" | "better" | "best";
  description: string;
  reason: string;
  recommended: boolean;
};

/** SOP stage of the conversation (flow.py sync actions). */
export type KioskStage =
  | "greet" | "rx" | "lifestyle" | "style" | "tryon" | "compare" | "lens" | "close" | "handoff" | "done";

export type KioskProfile = {
  need?: string;
  need_detail?: string;
  rx?: "recent" | "old" | "none" | "unsure";
  rx_source?: string;
  symptoms?: boolean;
  eye_test?: "requested" | "accepted" | "declined";
  screen_hours?: number;
  outdoor?: boolean;
  driving?: boolean;
  sports?: boolean;
  child_age?: number;
  near_difficulty?: boolean;
  prefs?: { max_price?: number; shape?: string; material?: string; gender?: string; light?: boolean; frame_type?: string };
};

/** Full snapshot the bot pushes after every change ({kind: "session"}). */
export type KioskSession = {
  stage: KioskStage;
  profile: KioskProfile;
  set: KioskFrame[];
  current: number | null;
  shortlist: string[];
  recommended: string | null;
  chosen: string | null;
  lenses: KioskLens[];
  lens: string | null;
  total: number | null;
  contact: { name?: string; phone?: string; guest?: boolean } | null;
  handoff: { reason: string; detail?: string } | null;
  ended: boolean;
  actions: string[];
};

/** What the staff dashboard has done with this customer (server store). */
export type StaffState = {
  acceptedBy?: string;
  acceptedAt?: number;
  takeover?: boolean;
  closed?: boolean;
};

export type TranscriptLine = {
  id: number;
  role: "user" | "bot";
  text: string;
};

type VoiceState = {
  status: VoiceStatus;
  phase: VoicePhase;
  errorMessage: string | null;
  transcript: TranscriptLine[];
  /** Live (non-final) words of the customer's current utterance. */
  userInterim: string;
  /** What the bot is saying in the current turn, as TTS speaks it. */
  botCaption: string;
  suggestions: TryOnSuggestion[];
  activeSku: string | null;
  /** SKUs the customer said they like ("ye pasand hai"). */
  picks: string[];
  /** Bumped on every try_on_frame so the stage can play the "frame drop". */
  dropSeq: number;
  /** Bumped on every like so the stage can play the heart burst. */
  likeSeq: number;
  /** The customer finished (lead saved / goodbye) — show the summary. */
  ended: boolean;
  /** Latest SOP snapshot from the bot (null before the first one). */
  session: KioskSession | null;
  /** The call ended without us hanging up (bot crashed / service failed). */
  dropped: boolean;
  /** Kiosk-side handoff (button pressed while the AI was off, or staff took over). */
  localHandoff: { reason: string } | null;
  /** Staff dashboard state for this customer, from the server. */
  staff: StaffState;
  connect: () => void;
  disconnect: () => void;
  /** Tap = same as saying it (flow.py run_action). */
  sendAction: (name: string, args?: Record<string, unknown>) => void;
  /** "स्टाफ़ को बुलाएँ": the bot speaks one line and steps back. */
  requestStaff: () => void;
};

export const useVoiceStore = create<VoiceState>(() => ({
  status: "idle",
  phase: "off",
  errorMessage: null,
  transcript: [],
  userInterim: "",
  botCaption: "",
  suggestions: [],
  activeSku: null,
  picks: [],
  dropSeq: 0,
  likeSeq: 0,
  ended: false,
  session: null,
  dropped: false,
  localHandoff: null,
  staff: {},
  connect: () => {},
  disconnect: () => {},
  sendAction: () => {},
  requestStaff: () => {},
}));

/**
 * Audio levels (0–1, smoothed RMS) of the customer's mic and the bot's
 * voice. Updated at audio-frame rate by the voice session and read every
 * animation frame by the orb — deliberately outside React/zustand so 60 Hz
 * updates never re-render anything.
 */
export const voiceLevels = { mic: 0, bot: 0 };
