import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

// Tests reset the database between cases, so they get their own database and
// never touch the one the app and the CLI use. Recreated on every run, then the
// migrations are applied in order; the name comes from the vitest configs.
export const TEST_DATABASE = process.env.PG_TEST_DATABASE || "context_paging_test";

const migrationsDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../migrations");

function createClient(database: string): pg.Client {
  return new pg.Client({
    host: process.env.PG_HOST || "localhost",
    port: parseInt(process.env.PG_PORT || "5433", 10),
    user: process.env.PG_USER || "context_paging",
    password: process.env.PG_PASSWORD || "context_paging",
    database,
  });
}

export default async function setup(): Promise<void> {
  const admin = createClient("postgres");
  await admin.connect();
  try {
    await admin.query(`DROP DATABASE IF EXISTS "${TEST_DATABASE}" WITH (FORCE)`);
    await admin.query(`CREATE DATABASE "${TEST_DATABASE}"`);
  } finally {
    await admin.end();
  }

  const db = createClient(TEST_DATABASE);
  await db.connect();
  try {
    const migrations = readdirSync(migrationsDir).filter((file) => /^V\d+__.*\.sql$/.test(file)).sort();
    for (const file of migrations) {
      await db.query(readFileSync(path.join(migrationsDir, file), "utf8"));
    }
  } finally {
    await db.end();
  }
}
