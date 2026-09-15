"use client";

import { useTryOnStore } from "@/store/tryOnStore";

const POSE_IDS = [
  { id: "front", label: "Front", expect: { yawSign: 0, yawAbsDegMax: 12 } },
  {
    id: "yaw_left_30",
    label: "Yaw ~30° left",
    expect: { yawSign: 1, yawAbsDegMin: 12, yawAbsDegMax: 55 },
  },
  {
    id: "yaw_right_30",
    label: "Yaw ~30° right",
    expect: { yawSign: -1, yawAbsDegMin: 12, yawAbsDegMax: 55 },
  },
  {
    id: "pitch_down",
    label: "Pitch down",
    expect: { yawSign: 0, yawAbsDegMax: 20, pitchSign: 1, pitchAbsDegMin: 8 },
  },
  {
    id: "close",
    label: "Close to camera",
    expect: { yawSign: 0, yawAbsDegMax: 15, scaleMin: 0.3, scaleMax: 2.8 },
  },
] as const;

/**
 * Dev-only: download landmark+matrix JSON for fixture tests.
 * Pose, click the matching button once face is locked.
 */
export function PoseSnapshotControl() {
  if (process.env.NODE_ENV !== "development") return null;

  const hasFace = useTryOnStore((s) => s.hasFace);

  const download = (id: (typeof POSE_IDS)[number]["id"]) => {
    const meta = POSE_IDS.find((p) => p.id === id)!;
    const {
      landmarks,
      transformMatrix,
      videoWidth,
      videoHeight,
      hasFace: face,
    } = useTryOnStore.getState();
    if (!face || !landmarks || !transformMatrix) {
      console.warn("[EyeNetra:snapshot] need face + matrix");
      return;
    }
    const payload = {
      id,
      videoWidth,
      videoHeight,
      landmarks,
      transformMatrix: [...transformMatrix],
      expect: {
        ...meta.expect,
        scaleMin: 0.15,
        scaleMax: 2.8,
      },
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: "application/json",
    });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${id}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
    console.info(`[EyeNetra:snapshot] downloaded ${id}.json — move to test-fixtures/pose/`);
  };

  return (
    <div className="flex flex-wrap items-center gap-2 border-t border-zinc-100 pt-3">
      <span className="w-full text-xs font-medium text-zinc-500">
        Dev · snapshot pose fixtures
      </span>
      {POSE_IDS.map((p) => (
        <button
          key={p.id}
          type="button"
          disabled={!hasFace}
          onClick={() => download(p.id)}
          className="rounded border border-zinc-300 px-2 py-1 text-xs hover:border-zinc-500 disabled:opacity-40"
        >
          {p.label}
        </button>
      ))}
    </div>
  );
}
