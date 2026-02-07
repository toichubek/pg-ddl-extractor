import { Pool, PoolConfig, PoolClient } from "pg";

export interface PoolOptions {
  min?: number;
  max?: number;
  idleTimeoutMillis?: number;
  connectionTimeoutMillis?: number;
}

const DEFAULT_POOL_OPTIONS: PoolOptions = {
  min: 2,
  max: 10,
  idleTimeoutMillis: 10000,
  connectionTimeoutMillis: 10000,
};

/**
 * Create a connection pool with sensible defaults.
 * The pool automatically manages connections and can be used
 * as a drop-in replacement for Client in most cases.
 */
export function createPool(
  config: PoolConfig,
  options: PoolOptions = {}
): Pool {
  const poolConfig: PoolConfig = {
    ...config,
    min: options.min ?? DEFAULT_POOL_OPTIONS.min,
    max: options.max ?? DEFAULT_POOL_OPTIONS.max,
    idleTimeoutMillis: options.idleTimeoutMillis ?? DEFAULT_POOL_OPTIONS.idleTimeoutMillis,
    connectionTimeoutMillis:
      options.connectionTimeoutMillis ?? DEFAULT_POOL_OPTIONS.connectionTimeoutMillis,
  };

  return new Pool(poolConfig);
}

/**
 * Execute a function with a pooled client, automatically releasing it.
 */
export async function withPoolClient<T>(
  pool: Pool,
  fn: (client: PoolClient) => Promise<T>
): Promise<T> {
  const client = await pool.connect();
  try {
    return await fn(client);
  } finally {
    client.release();
  }
}

/**
 * Execute multiple tasks concurrently using pooled connections.
 * Each task gets its own client from the pool.
 */
export async function parallelQuery<T>(
  pool: Pool,
  tasks: Array<(client: PoolClient) => Promise<T>>,
  concurrency?: number
): Promise<T[]> {
  const limit = concurrency || pool.totalCount || 5;
  const results: T[] = [];
  const executing: Promise<void>[] = [];

  for (const task of tasks) {
    const p = withPoolClient(pool, task).then((result) => {
      results.push(result);
    });

    executing.push(p);

    if (executing.length >= limit) {
      await Promise.race(executing);
      // Remove completed promises
      for (let i = executing.length - 1; i >= 0; i--) {
        const status = await Promise.race([
          executing[i].then(() => "done"),
          Promise.resolve("pending"),
        ]);
        if (status === "done") {
          executing.splice(i, 1);
        }
      }
    }
  }

  await Promise.all(executing);
  return results;
}
