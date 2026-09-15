"use client";

import { FRAMES } from "@/data/frames";
import { useTryOnStore } from "@/store/tryOnStore";

export function FramePicker() {
  const selectedFrameId = useTryOnStore((s) => s.selectedFrameId);
  const selectedVariantId = useTryOnStore((s) => s.selectedVariantId);
  const setFrame = useTryOnStore((s) => s.setFrame);
  const setVariant = useTryOnStore((s) => s.setVariant);
  const frame = useTryOnStore((s) => s.selectedFrame());

  return (
    <div className="space-y-4">
      <div>
        <p className="mb-2 text-xs font-medium uppercase tracking-[0.16em] text-zinc-500">
          Frames
        </p>
        <div className="flex gap-3 overflow-x-auto pb-2 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {FRAMES.map((f) => {
            const active = f.id === selectedFrameId;
            return (
              <button
                key={f.id}
                type="button"
                onClick={() => setFrame(f.id)}
                className={`flex min-w-[7.5rem] shrink-0 flex-col items-start gap-2 rounded-xl border px-3 py-3 text-left transition ${
                  active
                    ? "border-zinc-900 bg-zinc-900 text-white"
                    : "border-zinc-200 bg-white text-zinc-800 hover:border-zinc-400"
                }`}
              >
                <span
                  className="h-8 w-full rounded-md"
                  style={{ backgroundColor: f.thumbnailColor }}
                  aria-hidden
                />
                <span className="text-sm font-medium">{f.name}</span>
                <span
                  className={`text-[11px] ${active ? "text-zinc-300" : "text-zinc-500"}`}
                >
                  {f.fit.frameWidthMm}mm
                </span>
              </button>
            );
          })}
        </div>
      </div>

      <div>
        <p className="mb-2 text-xs font-medium uppercase tracking-[0.16em] text-zinc-500">
          Color
        </p>
        <div className="flex flex-wrap gap-2">
          {frame.variants.map((v) => {
            const active = v.id === selectedVariantId;
            return (
              <button
                key={v.id}
                type="button"
                onClick={() => setVariant(v.id)}
                className={`inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-sm transition ${
                  active
                    ? "border-zinc-900 bg-zinc-100"
                    : "border-zinc-200 bg-white hover:border-zinc-400"
                }`}
              >
                <span
                  className="h-4 w-4 rounded-full ring-1 ring-black/10"
                  style={{ backgroundColor: v.frameColor }}
                  aria-hidden
                />
                {v.name}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
