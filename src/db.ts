import { AsyncLocalStorage } from "node:async_hooks";
import pg from "pg";

let pool: pg.Pool | null = null;

export function getPool(): pg.Pool {
  if (pool) return pool;
  pool = new pg.Pool({
    host: process.env.PG_HOST || "localhost",
    port: parseInt(process.env.PG_PORT || "5433", 10),
    user: process.env.PG_USER || "context_paging",
    password: process.env.PG_PASSWORD || "context_paging",
    database: process.env.PG_DATABASE || "context_paging",
    max: parseInt(process.env.PG_POOL_MAX || "10", 10),
  });
  return pool;
}

export async function closePool(): Promise<void> {
  if (!pool) return;
  await pool.end();
  pool = null;
}

// The client of the transaction opened by withTransaction, if any. query()
// sends statements through it so code that already uses query() (all of
// storage.ts) joins the transaction without passing a client around.
const txClient = new AsyncLocalStorage<pg.PoolClient>();

export async function query<T extends pg.QueryResultRow = pg.QueryResultRow>(
  text: string,
  params?: unknown[]
): Promise<pg.QueryResult<T>> {
  const client = txClient.getStore();
  if (client) return client.query<T>(text, params);
  return getPool().query<T>(text, params);
}

// Run fn inside one transaction on a pooled client. Every query() made by fn
// (directly or through storage helpers) uses that client. Commits when fn
// resolves, rolls back and rethrows when it throws. Nested calls reuse the
// outer transaction.
export async function withTransaction<T>(fn: () => Promise<T>): Promise<T> {
  if (txClient.getStore()) return fn();

  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const result = await txClient.run(client, fn);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}
