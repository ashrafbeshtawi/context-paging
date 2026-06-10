import { NextResponse } from "next/server";
import { createSession, listSessions } from "@/lib/sessions";

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json({ sessions: listSessions() });
}

export async function POST(req: Request) {
  let title: string | undefined;
  try {
    const body = (await req.json()) as { title?: string };
    title = body.title;
  } catch {
    // body is optional
  }
  const session = createSession(title);
  return NextResponse.json({ session }, { status: 201 });
}
