"use client";

import { Avatar } from "@/components/kiosk/Avatar";

/** Dev preview of the kiosk avatar in each mood. */
export default function DevAvatar() {
  return (
    <main className="grid min-h-screen grid-cols-5 gap-4 bg-[#F6F2EB] p-6">
      {(["idle", "listening", "user", "thinking", "speaking"] as const).map((m) => (
        <div key={m} className="rounded-3xl bg-gradient-to-b from-[#EFE6D8] to-[#E3D5BF] p-4 text-center">
          <Avatar mood={m} className="w-full" />
          <p className="mt-2 text-sm text-zinc-600">{m}</p>
        </div>
      ))}
    </main>
  );
}
