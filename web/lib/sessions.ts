// Thin web-side wrapper. The DB-backed implementation lives in src/sessions.ts
// so the CLI can share it. The web layer used to keep an in-memory Map here;
// now everything is persisted in Postgres.
export {
  createSession,
  getSession,
  getOrCreateSession,
  listSessions,
  deleteSession,
  getMessages,
  getSessionWithMessages,
  replaceMessages,
  type SessionSummary,
} from "@agent/sessions";
