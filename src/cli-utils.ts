import * as dotenv from "dotenv";
import { Client, ClientConfig } from "pg";
import { getDbConfig } from "./config";
import { getSshConfig, createSshTunnel, TunnelResult } from "./tunnel";

// Load .env once
dotenv.config();

// ─── Shared CLI options for DB-connected commands ────────────────
export interface DbCliOptions {
  env?: string;
  host?: string;
  port?: string;
  database?: string;
  user?: string;
  password?: string;
}

// ─── Connection result ───────────────────────────────────────────
export interface DbConnection {
  client: Client;
  config: ClientConfig;
  tunnel: TunnelResult | null;
}

// ─── Validate DB CLI flags ───────────────────────────────────────
function validateDbOptions(options: DbCliOptions): void {
  if (options.host || options.database || options.user) {
    if (!options.database || !options.user) {
      console.error("❌ When using CLI flags, --database and --user are required");
      process.exit(1);
    }

    if (options.port) {
      const port = parseInt(options.port, 10);
      if (isNaN(port) || port < 1 || port > 65535) {
        console.error(`❌ Invalid port number: "${options.port}". Port must be between 1 and 65535`);
        process.exit(1);
      }
    }
  }
}

// ─── Build pg config from CLI flags or .env ──────────────────────
function buildPgConfig(options: DbCliOptions, env: string): ClientConfig {
  if (options.host || options.database || options.user) {
    return {
      host: options.host || "localhost",
      port: options.port ? parseInt(options.port, 10) : 5432,
      database: options.database!,
      user: options.user!,
      password: options.password || "",
      connectionTimeoutMillis: 10000,
      query_timeout: 30000,
    };
  }
  return getDbConfig(env);
}

// ─── Connect to database (with SSH tunnel if needed) ─────────────
export async function connectToDatabase(options: DbCliOptions): Promise<DbConnection> {
  const env = options.env || "dev";

  validateDbOptions(options);

  let pgConfig = buildPgConfig(options, env);

  // SSH tunnel
  const sshConfig = getSshConfig(env);
  let tunnel: TunnelResult | null = null;

  if (sshConfig) {
    console.log(`\n🔒 SSH tunnel: ${sshConfig.sshUser}@${sshConfig.sshHost}:${sshConfig.sshPort}`);
    tunnel = await createSshTunnel(sshConfig);
    pgConfig = { ...pgConfig, host: "127.0.0.1", port: tunnel.localPort };
  }

  console.log(`\n🔌 Connecting to ${pgConfig.host}:${pgConfig.port}/${pgConfig.database}...`);

  const client = new Client(pgConfig);

  try {
    await client.connect();
    console.log("✅ Connected\n");
  } catch (err: any) {
    if (tunnel) await tunnel.close();
    throw err;
  }

  return { client, config: pgConfig, tunnel };
}

// ─── Cleanup connection ──────────────────────────────────────────
export async function closeConnection(conn: DbConnection): Promise<void> {
  await conn.client.end();
  if (conn.tunnel) {
    await conn.tunnel.close();
    console.log("🔒 SSH tunnel closed");
  }
}

// ─── Handle common connection errors ─────────────────────────────
function handleConnectionError(err: any): void {
  console.error(`\n❌ Connection failed: ${err.message}`);
  if (err.message?.includes("Authentication") || err.code === "28P01") {
    console.error("   → Invalid username or password");
  }
  if (err.message?.includes("ECONNREFUSED") || err.code === "ECONNREFUSED") {
    console.error("   → Check that the database server is running");
  }
  if (err.message?.includes("timeout") || err.code === "ETIMEDOUT") {
    console.error("   → Connection timed out. Check host and port");
  }
  if (err.code === "3D000") {
    console.error("   → Database does not exist");
  }
}

// ─── Handle errors in main function ──────────────────────────────
export function handleError(err: any): void {
  console.error(`\n❌ Error: ${err.message}`);
  handleConnectionError(err);
}

// ─── Run main with cleanup ───────────────────────────────────────
export async function runWithConnection(
  options: DbCliOptions,
  fn: (client: Client, config: ClientConfig) => Promise<void>
): Promise<void> {
  let conn: DbConnection | undefined;
  try {
    conn = await connectToDatabase(options);
    await fn(conn.client, conn.config);
  } catch (err: any) {
    handleError(err);
    process.exit(1);
  } finally {
    if (conn) await closeConnection(conn);
  }
}
