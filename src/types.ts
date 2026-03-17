import type { CoreMessage } from "ai";

export interface PageMeta {
  id: number;
  title: string;
  summary: string;
  created_at: string;
  updated_at: string;
  is_resident: boolean;
}

export interface PageNode {
  meta: PageMeta;
  children: PageNode[];
  path: string;
}

export interface CounterData {
  next_id: number;
}

export interface ConversationState {
  messages: CoreMessage[];
  pagesPendingSwap: number[];
}
