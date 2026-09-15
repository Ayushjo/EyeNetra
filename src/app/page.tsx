import { TryOnStage } from "@/components/TryOnStage";

export default function Home() {
  return (
    <main className="min-h-screen bg-zinc-50 px-4 py-10 sm:px-8">
      <div className="mx-auto flex max-w-4xl flex-col gap-6">
        <header className="space-y-2">
          <p className="text-sm font-medium uppercase tracking-[0.18em] text-zinc-500">
            EyeNetra
          </p>
          <h1 className="text-3xl font-semibold tracking-tight text-zinc-900 sm:text-4xl">
            Virtual eyewear try-on
          </h1>
          <p className="max-w-2xl text-sm leading-relaxed text-zinc-600 sm:text-base">
            Real-time webcam AR with MediaPipe face tracking, metric scale from
            iris diameter, PBR frames, HDRI lighting, and temple occlusion.
          </p>
        </header>

        <TryOnStage />

        <aside className="rounded-xl border border-zinc-200 bg-white px-4 py-3 text-sm text-zinc-600">
          <p className="font-medium text-zinc-800">How to test</p>
          <ol className="mt-2 list-decimal space-y-1 pl-5">
            <li>Enable camera — mirrored feed should appear.</li>
            <li>Wait for the face model to load — glasses should lock to your face.</li>
            <li>Turn your head ¾ — temple arms should tuck behind via occlusion.</li>
            <li>Swap frames/colors in the picker; tune smoothing if needed.</li>
            <li>Use Screenshot to download the composite preview.</li>
          </ol>
        </aside>
      </div>
    </main>
  );
}
