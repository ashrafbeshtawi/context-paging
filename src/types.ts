import type { ModelMessage } from "ai";

export interface PageRow {
  id: number;
  session_id: string;
  page_no: number;
  parent_id: number | null;
  title: string;
  summary: string;
  content: string;
  is_resident: boolean;
  created_at: Date;
  updated_at: Date;
}

/** Page fields needed for the page table — everything except content and timestamps. */
export type PageMeta = Pick<PageRow, "id" | "page_no" | "parent_id" | "title" | "summary" | "is_resident">;

export interface PageNode {
  row: PageMeta;
  children: PageNode[];
}

export interface SessionRow {
  id: string;
  title: string;
  provider: string | null;
  model: string | null;
  created_at: Date;
  updated_at: Date;
}

export interface SessionWithMessages extends SessionRow {
  messages: ModelMessage[];
}

export interface ConversationState {
  messages: ModelMessage[];
  pagesPendingSwap: number[];
}
