import { Pool, PoolConfig, PoolClient } from "pg";
export interface PoolOptions {
    min?: number;
    max?: number;
    idleTimeoutMillis?: number;
    connectionTimeoutMillis?: number;
}
/**
 * Create a connection pool with sensible defaults.
 * The pool automatically manages connections and can be used
 * as a drop-in replacement for Client in most cases.
 */
export declare function createPool(config: PoolConfig, options?: PoolOptions): Pool;
/**
 * Execute a function with a pooled client, automatically releasing it.
 */
export declare function withPoolClient<T>(pool: Pool, fn: (client: PoolClient) => Promise<T>): Promise<T>;
/**
 * Execute multiple tasks concurrently using pooled connections.
 * Each task gets its own client from the pool.
 */
export declare function parallelQuery<T>(pool: Pool, tasks: Array<(client: PoolClient) => Promise<T>>, concurrency?: number): Promise<T[]>;
