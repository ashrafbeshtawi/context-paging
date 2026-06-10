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

export interface PageNode {
  row: PageRow;
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
