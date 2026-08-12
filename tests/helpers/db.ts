import { query } from "../../src/db.js";

// Truncate everything between tests. Cascades take care of messages + pages.
export async function resetDb(): Promise<void> {
  await query("TRUNCATE sessions RESTART IDENTITY CASCADE");
}

// Create a test session and yield its id.
export async function makeTestSession(id = `test-${Math.random().toString(36).slice(2, 10)}`): Promise<string> {
  await query(
    "INSERT INTO sessions (id, title) VALUES ($1, 'test') ON CONFLICT (id) DO NOTHING",
    [id]
  );
  return id;
}
