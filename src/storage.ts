import fs from "node:fs/promises";
import path from "node:path";
import type { PageMeta, PageNode, CounterData } from "./types.js";

const PAGES_ROOT = process.env.PAGES_ROOT || "./pages";

function root(): string {
  return path.resolve(PAGES_ROOT);
}

export async function ensureRoot(): Promise<void> {
  await fs.mkdir(root(), { recursive: true });
}

// --- Counter ---

async function counterPath(): Promise<string> {
  return path.join(root(), "_counter.json");
}

export async function getNextId(): Promise<number> {
  const cp = await counterPath();
  let data: CounterData;
  try {
    const raw = await fs.readFile(cp, "utf-8");
    data = JSON.parse(raw) as CounterData;
  } catch {
    data = { next_id: 1 };
  }
  const id = data.next_id;
  data.next_id = id + 1;
  await fs.writeFile(cp, JSON.stringify(data, null, 2));
  return id;
}

// --- Finding pages ---

export async function findPageDir(
  id: number,
  searchDir?: string
): Promise<string | null> {
  const dir = searchDir || root();
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return null;
  }

  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith("_")) continue;
    const entryPath = path.join(dir, entry.name);

    if (entry.name === String(id)) {
      try {
        await fs.access(path.join(entryPath, "meta.json"));
        return entryPath;
      } catch {
        // Not a page dir, continue searching inside
      }
    }

    const found = await findPageDir(id, entryPath);
    if (found) return found;
  }

  return null;
}

// --- Reading ---

export async function readMeta(pageDir: string): Promise<PageMeta> {
  const raw = await fs.readFile(path.join(pageDir, "meta.json"), "utf-8");
  return JSON.parse(raw) as PageMeta;
}

export async function readContent(pageDir: string): Promise<string> {
  try {
    return await fs.readFile(path.join(pageDir, "content.md"), "utf-8");
  } catch {
    return "";
  }
}

// --- Writing ---

export async function writeMeta(
  pageDir: string,
  meta: PageMeta
): Promise<void> {
  await fs.writeFile(
    path.join(pageDir, "meta.json"),
    JSON.stringify(meta, null, 2)
  );
}

export async function writeContent(
  pageDir: string,
  content: string
): Promise<void> {
  await fs.writeFile(path.join(pageDir, "content.md"), content);
}

// --- Creating ---

export async function createPageDir(
  id: number,
  parentId?: number
): Promise<string> {
  let parentDir: string;
  if (parentId !== undefined) {
    const found = await findPageDir(parentId);
    if (!found) throw new Error(`Parent page ${parentId} not found`);
    parentDir = found;
  } else {
    parentDir = root();
  }

  const pageDir = path.join(parentDir, String(id));
  await fs.mkdir(pageDir, { recursive: true });
  return pageDir;
}

// --- Deleting ---

export async function deletePageDir(pageDir: string): Promise<void> {
  await fs.rm(pageDir, { recursive: true, force: true });
}

// --- Getting children ---

export async function getChildPageDirs(
  parentDir: string
): Promise<string[]> {
  const children: string[] = [];
  let entries;
  try {
    entries = await fs.readdir(parentDir, { withFileTypes: true });
  } catch {
    return children;
  }
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith("_")) continue;
    const entryPath = path.join(parentDir, entry.name);
    try {
      await fs.access(path.join(entryPath, "meta.json"));
      children.push(entryPath);
    } catch {
      // Not a page
    }
  }
  return children;
}

// --- Building tree ---

export async function buildTree(dir?: string): Promise<PageNode[]> {
  const searchDir = dir || root();
  const childDirs = await getChildPageDirs(searchDir);
  const nodes: PageNode[] = [];

  for (const childDir of childDirs) {
    const meta = await readMeta(childDir);
    const children = await buildTree(childDir);
    nodes.push({ meta, children, path: childDir });
  }

  nodes.sort((a, b) => a.meta.id - b.meta.id);
  return nodes;
}

// --- Moving ---

export async function movePageDir(
  sourceDir: string,
  targetParentDir: string
): Promise<string> {
  const dirName = path.basename(sourceDir);
  const destDir = path.join(targetParentDir, dirName);
  await fs.rename(sourceDir, destDir);
  return destDir;
}

// --- Ancestry check ---

export async function isDescendantOf(
  pageId: number,
  potentialAncestorDir: string
): Promise<boolean> {
  const children = await getChildPageDirs(potentialAncestorDir);
  for (const childDir of children) {
    const meta = await readMeta(childDir);
    if (meta.id === pageId) return true;
    if (await isDescendantOf(pageId, childDir)) return true;
  }
  return false;
}
