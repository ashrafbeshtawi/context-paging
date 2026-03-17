import type { CoreMessage } from "ai";
import {
  ensureRoot,
  getNextId,
  createPageDir,
  writeMeta,
  writeContent,
  readMeta,
  readContent,
  findPageDir,
  deletePageDir,
  getChildPageDirs,
  buildTree,
  movePageDir,
  isDescendantOf,
} from "./storage.js";
import { formatPageTable } from "./toc.js";
import type { PageMeta } from "./types.js";
import path from "node:path";

// --- Page operations (called by tool handlers) ---

export async function handlePageOut(args: {
  title: string;
  content?: string;
  summary?: string;
  parent_id?: number;
}): Promise<string> {
  await ensureRoot();
  const id = await getNextId();
  const pageDir = await createPageDir(id, args.parent_id);

  const now = new Date().toISOString();
  const meta: PageMeta = {
    id,
    title: args.title,
    summary: args.summary || "",
    created_at: now,
    updated_at: now,
    is_resident: false,
  };

  await writeMeta(pageDir, meta);
  await writeContent(pageDir, args.content || "");

  return `Paged out → Page ${id}: "${args.title}"${args.parent_id ? ` (under page ${args.parent_id})` : ""}`;
}

export async function handlePageTable(args: {
  parent_id?: number;
}): Promise<string> {
  await ensureRoot();

  let startDir: string | undefined;
  if (args.parent_id !== undefined) {
    const dir = await findPageDir(args.parent_id);
    if (!dir) return `Page ${args.parent_id} not found.`;
    startDir = dir;
  }

  const tree = await buildTree(startDir);
  if (tree.length === 0) return "Page table empty — no pages stored.";
  return formatPageTable(tree);
}

export async function handlePageIn(args: { id: number }): Promise<string> {
  await ensureRoot();
  const dir = await findPageDir(args.id);
  if (!dir) return `Page ${args.id} not found.`;

  const meta = await readMeta(dir);
  const content = await readContent(dir);

  if (!meta.is_resident) {
    meta.is_resident = true;
    meta.updated_at = new Date().toISOString();
    await writeMeta(dir, meta);
  }

  return `# Page ${meta.id}: ${meta.title}\n*Summary: ${meta.summary || "(none)"}*\n\n---\n\n${content}`;
}

export async function handlePageUpdate(args: {
  id: number;
  title?: string;
  summary?: string;
  content?: string;
  is_resident?: boolean;
}): Promise<string> {
  await ensureRoot();
  const dir = await findPageDir(args.id);
  if (!dir) return `Page ${args.id} not found.`;

  const meta = await readMeta(dir);
  const changes: string[] = [];

  if (args.title !== undefined) { meta.title = args.title; changes.push("title"); }
  if (args.summary !== undefined) { meta.summary = args.summary; changes.push("summary"); }
  if (args.is_resident !== undefined) { meta.is_resident = args.is_resident; changes.push(args.is_resident ? "paged in" : "paged out"); }
  if (args.content !== undefined) { await writeContent(dir, args.content); changes.push("content"); }

  meta.updated_at = new Date().toISOString();
  await writeMeta(dir, meta);

  return `Updated page ${args.id}: ${changes.join(", ")}`;
}

export async function handlePageFree(args: {
  id: number;
  recursive?: boolean;
}): Promise<string> {
  await ensureRoot();
  const dir = await findPageDir(args.id);
  if (!dir) return `Page ${args.id} not found.`;

  const children = await getChildPageDirs(dir);
  const recursive = args.recursive !== false;

  if (children.length > 0 && !recursive) {
    const childMetas = await Promise.all(children.map((c) => readMeta(c)));
    const childList = childMetas.map((m) => `  - Page ${m.id}: "${m.title}"`).join("\n");
    return `Page ${args.id} has children. Use recursive=true or free children first:\n${childList}`;
  }

  const meta = await readMeta(dir);
  await deletePageDir(dir);
  return `Freed page ${args.id}: "${meta.title}"${children.length > 0 ? ` (and ${children.length} children)` : ""}`;
}

export async function handlePageMove(args: {
  id: number;
  new_parent_id?: number;
}): Promise<string> {
  await ensureRoot();
  const sourceDir = await findPageDir(args.id);
  if (!sourceDir) return `Page ${args.id} not found.`;

  let targetParentDir: string;
  if (args.new_parent_id !== undefined) {
    if (args.new_parent_id === args.id) return "Cannot move a page under itself.";
    const parentDir = await findPageDir(args.new_parent_id);
    if (!parentDir) return `Parent page ${args.new_parent_id} not found.`;
    if (await isDescendantOf(args.new_parent_id, sourceDir)) {
      return `Cannot move page ${args.id} under page ${args.new_parent_id} — circular nesting.`;
    }
    targetParentDir = parentDir;
  } else {
    targetParentDir = path.resolve(process.env.PAGES_ROOT || "./pages");

  }

  await movePageDir(sourceDir, targetParentDir);
  return `Moved page ${args.id} ${args.new_parent_id ? `under page ${args.new_parent_id}` : "to root"}.`;
}

export async function handlePageMerge(args: {
  source_ids: number[];
  target_id: number;
  strategy?: "concatenate" | "provided";
  merged_content?: string;
  merged_summary?: string;
}): Promise<string> {
  await ensureRoot();
  const targetDir = await findPageDir(args.target_id);
  if (!targetDir) return `Target page ${args.target_id} not found.`;

  const sourceDirs: Array<{ id: number; dir: string }> = [];
  for (const srcId of args.source_ids) {
    if (srcId === args.target_id) continue;
    const dir = await findPageDir(srcId);
    if (!dir) return `Source page ${srcId} not found.`;
    sourceDirs.push({ id: srcId, dir });
  }

  if (sourceDirs.length === 0) return "No source pages to merge.";

  const strategy = args.strategy || "concatenate";
  const targetMeta = await readMeta(targetDir);
  let finalContent: string;

  if (strategy === "provided") {
    if (!args.merged_content) return "Strategy 'provided' requires merged_content.";
    finalContent = args.merged_content;
  } else {
    const targetContent = await readContent(targetDir);
    const parts = [targetContent];
    for (const src of sourceDirs) {
      const meta = await readMeta(src.dir);
      const content = await readContent(src.dir);
      parts.push(`\n\n---\n\n## Merged from Page ${meta.id}: ${meta.title}\n\n${content}`);
    }
    finalContent = parts.join("");
  }

  await writeContent(targetDir, finalContent);
  if (args.merged_summary !== undefined) targetMeta.summary = args.merged_summary;
  targetMeta.updated_at = new Date().toISOString();
  await writeMeta(targetDir, targetMeta);

  for (const src of sourceDirs) await deletePageDir(src.dir);

  return `Merged pages [${sourceDirs.map((s) => s.id).join(", ")}] into page ${args.target_id} (${strategy}). Sources freed.`;
}

// --- Context paging operations ---

export function swapOut(
  messages: CoreMessage[],
  pageId: number,
  title: string,
  summary: string,
  swapCount?: number
): CoreMessage[] {
  if (!swapCount || swapCount <= 0) return messages;

  const keepCount = Math.max(0, messages.length - swapCount);
  const result = messages.slice(0, keepCount);

  result.push({
    role: "assistant",
    content: `[Paged out → Page ${pageId}: "${title}" — ${summary}]`,
  });

  return result;
}

export function swapIn(
  messages: CoreMessage[],
  pageId: number,
  title: string,
  content: string
): CoreMessage[] {
  return [
    ...messages,
    {
      role: "assistant",
      content: `[Paged in ← Page ${pageId}: "${title}"]\n\n${content}\n\n[End of Page ${pageId}]`,
    },
  ];
}
