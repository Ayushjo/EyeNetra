import { TryOnStage } from "@/components/TryOnStage";
import { VoiceAgentPanel, VoiceSession } from "@/components/VoiceAgentPanel";
import { E2EHarness } from "@/components/dev/E2EHarness";

export default function Studio() {
  return (
    <main className="min-h-screen bg-white text-zinc-900">
      <div className="mx-auto flex max-w-4xl flex-col gap-6 px-4 py-8 sm:px-6">
        <header className="flex items-end justify-between gap-4">
          <div>
            <p className="text-xs font-medium uppercase tracking-[0.2em] text-zinc-400">
              EyeNetra
            </p>
            <h1 className="mt-1 text-2xl font-semibold tracking-tight sm:text-3xl">
              चश्मा पहनकर देखिए
            </h1>
          </div>
          <p className="hidden text-sm text-zinc-400 sm:block">
            बोलिए — फ्रेम सीधे आपके चेहरे पर
          </p>
        </header>

        <E2EHarness />
        <VoiceSession />
        <TryOnStage />

        <VoiceAgentPanel />

      </div>
    </main>
  );
}
