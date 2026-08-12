import { NextResponse } from "next/server";
import { deleteSession, getSessionWithMessages } from "@/lib/sessions";
import { withSession } from "@agent/storage";
import { getPageTable } from "@/lib/page-table";
import { buildContextView } from "@/lib/context-view";

export const runtime = "nodejs";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const session = await getSessionWithMessages(id);
  if (!session) return NextResponse.json({ error: "not found" }, { status: 404 });

  const pageTable = await withSession(id, () => getPageTable());

  return NextResponse.json({
    session: {
      id: session.id,
      title: session.title,
      createdAt: session.created_at,
      updatedAt: session.updated_at,
      provider: session.provider,
      model: session.model,
    },
    context: buildContextView(session.messages),
    pageTable,
  });
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const ok = await deleteSession(id);
  if (!ok) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
