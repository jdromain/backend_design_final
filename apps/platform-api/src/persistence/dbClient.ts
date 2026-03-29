/**
 * dbClient.ts — Direct PostgreSQL connection pool
 *
 * Replaces the Supabase REST client. Works with:
 * - Local Postgres + pgvector (docker-compose)
 * - AWS Aurora PostgreSQL + pgvector (production)
 *
 * Connection is lazy-initialized on first query.
 * Uses a single shared Pool with sensible defaults for cost.
 */

import { Pool, PoolClient, QueryResult } from "pg";
import { createLogger } from "@rezovo/logging";
import { env } from "../env";

const logger = createLogger({ service: "platform-api", module: "db" });

let pool: Pool | null = null;

/**
 * Get or create the singleton connection pool.
 */
export function getPool(): Pool {
  if (pool) return pool;

  const databaseUrl = env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("[db] DATABASE_URL is not set — cannot connect to Postgres");
  }

  pool = new Pool({
    connectionString: databaseUrl,
    max: env.DB_POOL_MAX,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
    ssl: env.DB_SSL ? { rejectUnauthorized: false } : undefined,
  });

  pool.on("error", (err) => {
    logger.error("unexpected pool error", { error: err.message });
  });

  pool.on("connect", () => {
    logger.debug("new pg connection established");
  });

  logger.info("pg pool created", {
    max: pool.options.max,
    ssl: !!pool.options.ssl,
    host: new URL(databaseUrl.replace(/^postgres:/, "http:")).hostname,
  });

  return pool;
}

/**
 * Convenience: run a parameterized query.
 */
export async function query<T extends Record<string, any> = any>(
  text: string,
  values?: any[]
): Promise<QueryResult<T>> {
  const p = getPool();
  const start = Date.now();
  try {
    const result = await p.query<T>(text, values);
    const duration = Date.now() - start;
    if (duration > 500) {
      logger.warn("slow query", { duration, text: text.slice(0, 120) });
    }
    return result;
  } catch (err) {
    logger.error("query error", {
      error: (err as Error).message,
      text: text.slice(0, 120),
    });
    throw err;
  }
}

/**
 * Get a client from the pool (for transactions).
 * ALWAYS release the client in a finally block.
 */
export async function getClient(): Promise<PoolClient> {
  return getPool().connect();
}

/**
 * Run a function inside a transaction.
 */
export async function withTransaction<T>(
  fn: (client: PoolClient) => Promise<T>
): Promise<T> {
  const client = await getClient();
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

/**
 * Check if the database is reachable (for health checks).
 */
export async function ping(): Promise<boolean> {
  try {
    const result = await query("SELECT 1 AS ok");
    return result.rows[0]?.ok === 1;
  } catch (err) {
    const e = err as Error & { code?: string };
    logger.warn("database ping failed", {
      error: e.message || String(err),
      code: e.code,
    });
    return false;
  }
}

/**
 * Gracefully shut down the pool.
 */
export async function closePool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
    logger.info("pg pool closed");
  }
}
