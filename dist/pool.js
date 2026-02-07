"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createPool = createPool;
exports.withPoolClient = withPoolClient;
exports.parallelQuery = parallelQuery;
const pg_1 = require("pg");
const DEFAULT_POOL_OPTIONS = {
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
function createPool(config, options = {}) {
    const poolConfig = {
        ...config,
        min: options.min ?? DEFAULT_POOL_OPTIONS.min,
        max: options.max ?? DEFAULT_POOL_OPTIONS.max,
        idleTimeoutMillis: options.idleTimeoutMillis ?? DEFAULT_POOL_OPTIONS.idleTimeoutMillis,
        connectionTimeoutMillis: options.connectionTimeoutMillis ?? DEFAULT_POOL_OPTIONS.connectionTimeoutMillis,
    };
    return new pg_1.Pool(poolConfig);
}
/**
 * Execute a function with a pooled client, automatically releasing it.
 */
async function withPoolClient(pool, fn) {
    const client = await pool.connect();
    try {
        return await fn(client);
    }
    finally {
        client.release();
    }
}
/**
 * Execute multiple tasks concurrently using pooled connections.
 * Each task gets its own client from the pool.
 */
async function parallelQuery(pool, tasks, concurrency) {
    const limit = concurrency || pool.totalCount || 5;
    const results = [];
    const executing = [];
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
