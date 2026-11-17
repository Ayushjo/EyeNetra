import { TryOnStage } from "@/components/TryOnStage";
import { VoiceAgentPanel, VoiceSession } from "@/components/VoiceAgentPanel";
import { E2EHarness } from "@/components/dev/E2EHarness";

export default function Home() {
  return (
    <main className="min-h-screen bg-zinc-50 px-4 py-10 sm:px-8">
      <div className="mx-auto flex max-w-4xl flex-col gap-6">
        <header className="flex items-end justify-between gap-4">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.18em] text-zinc-500">EyeNetra</p>
            <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 sm:text-3xl">
              चश्मा पहनकर देखिए
            </h1>
          </div>
          <p className="hidden text-sm text-zinc-500 sm:block">बोलिए, और फ्रेम सीधे आपके चेहरे पर</p>
        </header>

        <E2EHarness />
        <VoiceSession />
        <TryOnStage />

        <VoiceAgentPanel />

      </div>
    </main>
  );
}
