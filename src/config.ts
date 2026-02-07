import { PoolConfig } from "pg";
import * as dotenv from "dotenv";

// ─── Load .env ────────────────────────────────────────────────────
dotenv.config();

export interface DbConfig {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
}

export function getDbConfig(env: string): PoolConfig {
  const prefix = env.toUpperCase(); // DEV or PROD

  console.log({env:process.env})
  const host = process.env[`${prefix}_DB_HOST`];
  const port = process.env[`${prefix}_DB_PORT`];
  const database = process.env[`${prefix}_DB_NAME`];
  const user = process.env[`${prefix}_DB_USER`];
  const password = process.env[`${prefix}_DB_PASSWORD`];

  if (!host || !database || !user) {
    throw new Error(
      `Missing DB config for env "${env}". ` +
        `Expected ${prefix}_DB_HOST, ${prefix}_DB_NAME, ${prefix}_DB_USER in .env`
    );
  }

  return {
    host,
    port: port ? parseInt(port, 10) : 5432,
    database,
    user,
    password: password || "",
    // safe defaults
    connectionTimeoutMillis: 10000,
    query_timeout: 30000,
  };
}
