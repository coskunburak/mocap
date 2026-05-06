import { Pool } from "pg";
import { config } from "../../config";

export const pool = new Pool({
  connectionString: config.databaseUrl,
  max: 10,
  idleTimeoutMillis: 30_000,
});

export async function closeDb() {
  await pool.end();
}

export async function ensureUser(userId: string) {
  await pool.query(
    `
      insert into users (id)
      values ($1)
      on conflict (id) do nothing
    `,
    [userId],
  );
}

export function rowToIso<T extends Record<string, unknown>>(row: T): T {
  const next: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row)) {
    next[key] = value instanceof Date ? value.toISOString() : value;
  }
  return next as T;
}

