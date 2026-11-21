import type { ModelMessage } from "ai";
import {
  insertPage,
  getPageByNo,
  buildTree,
  updatePage,
  deletePage,
  setParent,
  isDescendantOf,
  getChildren,
  getPageById,
  reparentChildren,
} from "./storage.js";
import { withTransaction } from "./db.js";
import type { PageRow } from "./types.js";
import { formatPageTable } from "./toc.js";

// In the agent's mental model and tool calls, "page id" means the per-session
// page_no (1, 2, 3, …). The DB surrogate id is internal — we never expose it
// to the model. All handler args.id values below are page_no.

export async function handlePageOut(args: {
  title: string;
  content?: string;
  summary?: string;
  parent_id?: number;
}): Promise<string> {
  const row = await insertPage({
    title: args.title,
    summary: args.summary || "",
    content: args.content || "",
    parentPageNo: args.parent_id,
    isResident: false,
  });
  return `Paged out → Page ${row.page_no}: "${args.title}"${args.parent_id ? ` (under page ${args.parent_id})` : ""}`;
}

export async function handlePageTable(args: { parent_id?: number }): Promise<string> {
  let rootParentId: number | null = null;
  if (args.parent_id !== undefined) {
    const parent = await getPageByNo(args.parent_id);
    if (!parent) return `Page ${args.parent_id} not found.`;
    rootParentId = parent.id;
  }
  const tree = await buildTree(rootParentId);
  if (tree.length === 0) return "Page table empty — no pages stored.";
  return formatPageTable(tree);
}

export async function handlePageIn(args: { id: number }): Promise<string> {
  const row = await getPageByNo(args.id);
  if (!row) return `Page ${args.id} not found.`;

  if (!row.is_resident) {
    await updatePage(row.id, { isResident: true });
  }

  return `# Page ${row.page_no}: ${row.title}\n*Summary: ${row.summary || "(none)"}*\n\n---\n\n${row.content}`;
}

export async function handlePageUpdate(args: {
  id: number;
  title?: string;
  summary?: string;
  content?: string;
  is_resident?: boolean;
}): Promise<string> {
  const row = await getPageByNo(args.id);
  if (!row) return `Page ${args.id} not found.`;

  const changes: string[] = [];
  if (args.title !== undefined) changes.push("title");
  if (args.summary !== undefined) changes.push("summary");
  if (args.content !== undefined) changes.push("content");
  if (args.is_resident !== undefined) changes.push(args.is_resident ? "paged in" : "paged out");

  await updatePage(row.id, {
    title: args.title,
    summary: args.summary,
    content: args.content,
    isResident: args.is_resident,
  });

  return `Updated page ${args.id}: ${changes.join(", ") || "no changes"}`;
}

export async function handlePageFree(args: {
  id: number;
  recursive?: boolean;
}): Promise<string> {
  const row = await getPageByNo(args.id);
  if (!row) return `Page ${args.id} not found.`;

  const children = await getChildren(row.id);
  const recursive = args.recursive !== false;

  if (children.length > 0 && !recursive) {
    const childList = children.map((c) => `  - Page ${c.page_no}: "${c.title}"`).join("\n");
    return `Page ${args.id} has children. Use recursive=true or free children first:\n${childList}`;
  }

  // ON DELETE CASCADE handles descendants when recursive.
  await deletePage(row.id);
  return `Freed page ${args.id}: "${row.title}"${children.length > 0 ? ` (and ${children.length} children)` : ""}`;
}

export async function handlePageMove(args: {
  id: number;
  new_parent_id?: number;
}): Promise<string> {
  const source = await getPageByNo(args.id);
  if (!source) return `Page ${args.id} not found.`;

  let newParentDbId: number | null = null;
  if (args.new_parent_id !== undefined) {
    if (args.new_parent_id === args.id) return "Cannot move a page under itself.";
    const parent = await getPageByNo(args.new_parent_id);
    if (!parent) return `Parent page ${args.new_parent_id} not found.`;
    if (await isDescendantOf(source.id, parent.id)) {
      return `Cannot move page ${args.id} under page ${args.new_parent_id} — circular nesting.`;
    }
    newParentDbId = parent.id;
  }

  await setParent(source.id, newParentDbId);
  return `Moved page ${args.id} ${args.new_parent_id ? `under page ${args.new_parent_id}` : "to root"}.`;
}

export async function handlePageMerge(args: {
  source_ids: number[];
  target_id: number;
  strategy?: "concatenate" | "provided";
  merged_content?: string;
  merged_summary?: string;
}): Promise<string> {
  const strategy = args.strategy || "concatenate";
  if (strategy === "provided" && !args.merged_content) {
    return "Strategy 'provided' requires merged_content.";
  }

  // All reads and writes run in one transaction: a failure halfway must not
  // leave the content duplicated in the target while some sources still exist.
  return withTransaction(async () => {
    const target = await getPageByNo(args.target_id);
    if (!target) return `Target page ${args.target_id} not found.`;

    const sources: PageRow[] = [];
    for (const srcNo of new Set(args.source_ids)) {
      if (srcNo === args.target_id) continue;
      const row = await getPageByNo(srcNo);
      if (!row) return `Source page ${srcNo} not found.`;
      sources.push(row);
    }
    if (sources.length === 0) return "No source pages to merge.";

    let finalContent: string;
    if (strategy === "provided") {
      finalContent = args.merged_content!;
    } else {
      const parts = [target.content];
      for (const src of sources) {
        parts.push(`\n\n---\n\n## Merged from Page ${src.page_no}: ${src.title}\n\n${src.content}`);
      }
      finalContent = parts.join("");
    }

    // pages.parent_id is ON DELETE CASCADE, so deleting a source would also
    // delete everything below it. First lift the target out of any source's
    // subtree, then hand the sources' children to the target, and only then
    // delete the (by now childless) sources.
    const sourceIds = new Set(sources.map((s) => String(s.id)));
    const notes: string[] = [];

    // Walk up from the target; remember the highest ancestor that is a source.
    let topSource: PageRow | null = null;
    let ancestorId = target.parent_id;
    while (ancestorId !== null) {
      const ancestor = await getPageById(ancestorId);
      if (!ancestor) break;
      if (sourceIds.has(String(ancestor.id))) topSource = ancestor;
      ancestorId = ancestor.parent_id;
    }
    if (topSource) {
      await setParent(target.id, topSource.parent_id);
      const newParent = topSource.parent_id === null ? null : await getPageById(topSource.parent_id);
      notes.push(
        `Page ${target.page_no} moved ${newParent ? `under page ${newParent.page_no}` : "to root"} (it was nested in source page ${topSource.page_no}).`
      );
    }

    const moved: PageRow[] = [];
    for (const src of sources) {
      moved.push(...(await reparentChildren(src.id, target.id, target.id)));
    }
    // Sources nested in other sources were moved too, but they are deleted below.
    const movedKept = moved.filter((m) => !sourceIds.has(String(m.id)));
    if (movedKept.length > 0) {
      const list = movedKept
        .sort((a, b) => a.page_no - b.page_no)
        .map((m) => m.page_no)
        .join(", ");
      notes.push(`Moved child pages [${list}] under page ${target.page_no}.`);
    }

    await updatePage(target.id, {
      content: finalContent,
      summary: args.merged_summary,
    });

    for (const src of sources) await deletePage(src.id);

    return [
      `Merged pages [${sources.map((s) => s.page_no).join(", ")}] into page ${args.target_id} (${strategy}). Sources freed.`,
      ...notes,
    ].join(" ");
  });
}

// --- Context (message array) paging ---

export function swapOut(
  messages: ModelMessage[],
  pageNo: number,
  title: string,
  summary: string,
  swapCount?: number
): ModelMessage[] {
  if (!swapCount || swapCount <= 0) return messages;

  const keepCount = Math.max(0, messages.length - swapCount);
  const result = messages.slice(0, keepCount);

  result.push({
    role: "assistant",
    content: `[Paged out → Page ${pageNo}: "${title}" — ${summary}]`,
  });

  return result;
}

export function swapIn(
  messages: ModelMessage[],
  pageNo: number,
  title: string,
  content: string
): ModelMessage[] {
  return [
    ...messages,
    {
      role: "assistant",
      content: `[Paged in ← Page ${pageNo}: "${title}"]\n\n${content}\n\n[End of Page ${pageNo}]`,
    },
  ];
}
