import { NextResponse } from "next/server";
import { listSessions, reportFromKiosk, type KioskReport } from "@/lib/server/sessionStore";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Staff dashboard: every customer session, newest first. */
export async function GET() {
  return NextResponse.json({ sessions: await listSessions(), now: Date.now() });
}

/** Kiosk: report the current customer (on change + heartbeat). */
export async function POST(req: Request) {
  let body: KioskReport;
  try {
    body = (await req.json()) as KioskReport;
  } catch {
    return NextResponse.json({ error: "bad json" }, { status: 400 });
  }
  if (!body || typeof body.id !== "string" || !/^[\w-]{6,64}$/.test(body.id)) {
    return NextResponse.json({ error: "bad id" }, { status: 400 });
  }
  const s = await reportFromKiosk(body);
  return NextResponse.json({ status: s.status, staff: s.staff });
}
