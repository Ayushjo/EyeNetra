import { NextResponse } from "next/server";
import { getSession, staffAction, type StaffAction } from "@/lib/server/sessionStore";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const s = await getSession((await params).id);
  return s ? NextResponse.json(s) : NextResponse.json({ error: "not found" }, { status: 404 });
}

/** Staff: accept / take over / close a customer. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  let body: StaffAction;
  try {
    body = (await req.json()) as StaffAction;
  } catch {
    return NextResponse.json({ error: "bad json" }, { status: 400 });
  }
  if (!["accept", "takeover", "close"].includes(body?.action)) {
    return NextResponse.json({ error: "bad action" }, { status: 400 });
  }
  const s = await staffAction((await params).id, body);
  return s ? NextResponse.json(s) : NextResponse.json({ error: "not found" }, { status: 404 });
}
