import { TryOnStage } from "@/components/TryOnStage";
import { VoiceAgentPanel, VoiceSession } from "@/components/VoiceAgentPanel";
import { StaffPanel, UiBootstrap } from "@/components/StaffPanel";
import { E2EHarness } from "@/components/dev/E2EHarness";

/**
 * Kiosk layout: the mirror fills the first screen — the welcome, the camera,
 * the assistant and the frame/colour controls (right edge) all live on it.
 * Below the fold, for now (not part of the kiosk): the conversation panel
 * and, in staff mode, staff tools.
 */
export default function Home() {
  return (
    <main className="min-h-screen bg-zinc-950 text-zinc-100">
      <UiBootstrap />
      <E2EHarness />
      <VoiceSession />

      <section className="flex min-h-[100svh] items-center justify-center sm:p-4">
        <TryOnStage />
      </section>

      <div className="mx-auto flex max-w-4xl flex-col gap-4 px-4 pb-12 pt-4 sm:px-6">
        <VoiceAgentPanel />
        <StaffPanel />
      </div>
    </main>
  );
}
