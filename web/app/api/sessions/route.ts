import { NextResponse } from "next/server";
import { createSession, listSessions } from "@/lib/sessions";

export const runtime = "nodejs";

export async function GET() {
  const sessions = await listSessions();
  return NextResponse.json({ sessions });
}

export async function POST(req: Request) {
  let title: string | undefined;
  try {
    const body = (await req.json()) as { title?: string };
    title = body.title;
  } catch {
    // body is optional
  }
  const session = await createSession({ title });
  return NextResponse.json({ session }, { status: 201 });
}
