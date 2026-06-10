import type { ModelMessage } from "ai";
import path from "node:path";

export interface Session {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messages: ModelMessage[];
}

export interface SessionSummary {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messageCount: number;
}

const sessions = new Map<string, Session>();

export function listSessions(): SessionSummary[] {
  return Array.from(sessions.values())
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .map((s) => ({
      id: s.id,
      title: s.title,
      createdAt: s.createdAt,
      updatedAt: s.updatedAt,
      messageCount: s.messages.length,
    }));
}

export function getSession(id: string): Session | undefined {
  return sessions.get(id);
}

export function createSession(title?: string): Session {
  const id = newSessionId();
  const now = Date.now();
  const session: Session = {
    id,
    title: title?.trim() || "New chat",
    createdAt: now,
    updatedAt: now,
    messages: [],
  };
  sessions.set(id, session);
  return session;
}

export function updateMessages(id: string, messages: ModelMessage[]): Session | undefined {
  const session = sessions.get(id);
  if (!session) return undefined;
  session.messages = messages;
  session.updatedAt = Date.now();
  if (session.title === "New chat") {
    const firstUser = messages.find((m) => m.role === "user");
    if (firstUser && typeof firstUser.content === "string") {
      session.title = firstUser.content.slice(0, 60);
    }
  }
  return session;
}

export function deleteSession(id: string): boolean {
  return sessions.delete(id);
}

export function pagesRootFor(sessionId: string, baseDir = process.env.WEB_PAGES_ROOT || "./pages-web"): string {
  return path.resolve(baseDir, sessionId);
}

export function resetForTests(): void {
  sessions.clear();
}

let counter = 0;
function newSessionId(): string {
  counter += 1;
  const rand = Math.random().toString(36).slice(2, 8);
  return `s-${Date.now().toString(36)}-${counter}-${rand}`;
}
