import pg from "pg";
import type { PoolClient } from "pg";
import { SCHEMA_SQL } from "./schema.js";

const { Pool } = pg;

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error(
    "DATABASE_URL is not set. Attach the Railway Postgres plugin or set it locally."
  );
}

// Railway's Postgres is reachable without SSL inside the project network,
// but requires it from outside. Letting `pg` pick up `?sslmode=require`
// from the URL handles both cases without extra config.
export const pool = new Pool({
  connectionString: databaseUrl,
  ssl:
    databaseUrl.includes("sslmode=require") ||
    databaseUrl.includes("railway.app")
      ? { rejectUnauthorized: false }
      : undefined,
  max: 5,
});

export async function runMigrations(): Promise<void> {
  await pool.query(SCHEMA_SQL);
}

export async function withTx<T>(
  fn: (client: PoolClient) => Promise<T>
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}
