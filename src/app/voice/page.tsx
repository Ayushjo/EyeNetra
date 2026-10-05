import { redirect } from "next/navigation";

/**
 * The voice assistant now lives on the try-on page so the conversation,
 * mic, and bot audio survive while frames change on the live face.
 */
export default function VoicePage() {
  redirect("/#voice");
}
