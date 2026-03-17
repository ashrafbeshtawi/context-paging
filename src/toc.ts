import type { PageNode } from "./types.js";

export function formatPageTable(nodes: PageNode[], indent: number = 0): string {
  const lines: string[] = [];
  const prefix = "  ".repeat(indent);

  for (const node of nodes) {
    const status = node.meta.is_resident ? "resident" : "swapped";
    const summary = node.meta.summary ? ` — ${node.meta.summary}` : "";
    lines.push(
      `${prefix}Page ${node.meta.id}: "${node.meta.title}" [${status}]${summary}`
    );

    if (node.children.length > 0) {
      lines.push(formatPageTable(node.children, indent + 1));
    }
  }

  return lines.join("\n");
}
