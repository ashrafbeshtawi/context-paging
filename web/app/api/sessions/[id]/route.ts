import { NextResponse } from "next/server";
import { deleteSession, getSession, pagesRootFor } from "@/lib/sessions";
import { withPagesRoot } from "@agent/storage";
import { getPageTable } from "@/lib/page-table";
import { buildContextView } from "@/lib/context-view";

export const runtime = "nodejs";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const session = getSession(id);
  if (!session) return NextResponse.json({ error: "not found" }, { status: 404 });

  const pageTable = await withPagesRoot(pagesRootFor(id), () => getPageTable());

  return NextResponse.json({
    session: {
      id: session.id,
      title: session.title,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
    },
    context: buildContextView(session.messages),
    pageTable,
  });
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const ok = deleteSession(id);
  if (!ok) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
