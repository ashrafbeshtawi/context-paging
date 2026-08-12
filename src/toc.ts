import type { PageNode } from "./types.js";

export function formatPageTable(nodes: PageNode[], indent: number = 0): string {
  const lines: string[] = [];
  const prefix = "  ".repeat(indent);

  for (const node of nodes) {
    const { row } = node;
    const status = row.is_resident ? "resident" : "swapped";
    const summary = row.summary ? ` — ${row.summary}` : "";
    lines.push(
      `${prefix}Page ${row.page_no}: "${row.title}" [${status}]${summary}`
    );

    if (node.children.length > 0) {
      lines.push(formatPageTable(node.children, indent + 1));
    }
  }

  return lines.join("\n");
}
