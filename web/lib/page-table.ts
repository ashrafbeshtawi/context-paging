import { buildTree } from "@agent/storage";
import type { PageNode } from "@agent/types";

export interface PageTableEntry {
  id: number;
  title: string;
  summary: string;
  isResident: boolean;
  depth: number;
  children: PageTableEntry[];
}

export async function getPageTable(): Promise<PageTableEntry[]> {
  const tree = await buildTree();
  return flatten(tree, 0);
}

function flatten(nodes: PageNode[], depth: number): PageTableEntry[] {
  return nodes.map((node) => ({
    id: node.meta.id,
    title: node.meta.title,
    summary: node.meta.summary,
    isResident: node.meta.is_resident,
    depth,
    children: flatten(node.children, depth + 1),
  }));
}
