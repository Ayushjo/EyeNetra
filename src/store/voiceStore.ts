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
  /**
   * Which step the conversation is on (bot.py → flow.py "stage" event):
   * greet · info · prefs · show · end_of_list · liked · lead · goodbye.
   * Picks the quick replies offered in text mode.
   */
  stage: ConversationStage | null;
  connect: () => void;
  disconnect: () => void;
  /** Send a typed message / quick reply (connects first if needed). */
  send: (text: string) => void;
};

export type ConversationStage =
  | "greet"
  | "info"
  | "prefs"
  | "show"
  | "end_of_list"
  | "liked"
  | "lead"
  | "goodbye";

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
  stage: null,
  connect: () => {},
  disconnect: () => {},
  send: () => {},
}));

/**
 * Audio levels (0–1, smoothed RMS) of the customer's mic and the bot's
 * voice. Updated at audio-frame rate by the voice session and read every
 * animation frame by the orb — deliberately outside React/zustand so 60 Hz
 * updates never re-render anything.
 */
export const voiceLevels = { mic: 0, bot: 0 };
