import * as path from "path";
import * as dotenv from "dotenv";
import { Client } from "pg";
import { program } from "commander";
import { getDbConfig } from "./config";
import { SqlFileWriter } from "./writer";
import { DdlExtractor, ExtractionFilters } from "./extractor";
import { getSshConfig, createSshTunnel, TunnelResult } from "./tunnel";

// ─── Load .env ────────────────────────────────────────────────────
dotenv.config();

// ─── Parse CLI args ───────────────────────────────────────────────
interface CliOptions {
  env?: string;
  host?: string;
  port?: string;
  database?: string;
  user?: string;
  password?: string;
  output?: string;
  interval?: string;
}

function parseArgs(): CliOptions {
  program
    .name("pg-ddl-watch")
    .description("Watch PostgreSQL schema for changes and auto-extract DDL")
    .version("1.0.0")
    .option("--env <environment>", "Environment (dev or prod)", "dev")
    .option("--host <host>", "Database host")
    .option("--port <port>", "Database port")
    .option("--database <database>", "Database name")
    .option("--user <user>", "Database user")
    .option("--password <password>", "Database password")
    .option("--output <path>", "Output directory path")
    .option("--interval <seconds>", "Polling interval in seconds", "30")
    .parse(process.argv);

  return program.opts<CliOptions>();
}

// ─── Schema Hash ──────────────────────────────────────────────────

async function getSchemaHash(client: Client): Promise<string> {
  // Get a combined hash of all DDL-relevant objects
  const { rows } = await client.query(`
    SELECT md5(string_agg(obj_def, '|' ORDER BY obj_type, obj_name)) AS schema_hash
    FROM (
      -- Tables
      SELECT 'table' AS obj_type,
             n.nspname || '.' || c.relname AS obj_name,
             md5(
               array_to_string(
                 array_agg(
                   a.attname || ':' || pg_catalog.format_type(a.atttypid, a.atttypmod) || ':' || a.attnotnull::text
                   ORDER BY a.attnum
                 ), ','
               )
             ) AS obj_def
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
      WHERE c.relkind = 'r'
        AND n.nspname NOT IN ('pg_catalog', 'information_schema', 'pg_toast')
      GROUP BY n.nspname, c.relname

      UNION ALL

      -- Functions
      SELECT 'function' AS obj_type,
             n.nspname || '.' || p.proname AS obj_name,
             md5(pg_get_functiondef(p.oid)) AS obj_def
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname NOT IN ('pg_catalog', 'information_schema', 'pg_toast')

      UNION ALL

      -- Views
      SELECT 'view' AS obj_type,
             schemaname || '.' || viewname AS obj_name,
             md5(definition) AS obj_def
      FROM pg_views
      WHERE schemaname NOT IN ('pg_catalog', 'information_schema', 'pg_toast')

      UNION ALL

      -- Indexes
      SELECT 'index' AS obj_type,
             schemaname || '.' || indexname AS obj_name,
             md5(indexdef) AS obj_def
      FROM pg_indexes
      WHERE schemaname NOT IN ('pg_catalog', 'information_schema', 'pg_toast')

      UNION ALL

      -- Triggers
      SELECT 'trigger' AS obj_type,
             trigger_schema || '.' || trigger_name AS obj_name,
             md5(action_statement) AS obj_def
      FROM information_schema.triggers
      WHERE trigger_schema NOT IN ('pg_catalog', 'information_schema', 'pg_toast')
    ) sub;
  `);

  return rows[0]?.schema_hash || "";
}

// ─── Main ─────────────────────────────────────────────────────────
async function main(): Promise<void> {
  const options = parseArgs();
  const env = options.env || "dev";
  const intervalSec = parseInt(options.interval || "30", 10);

  if (isNaN(intervalSec) || intervalSec < 5) {
    console.error("❌ Interval must be at least 5 seconds");
    process.exit(1);
  }

  const outputDir = options.output
    ? path.resolve(options.output)
    : process.env.SQL_OUTPUT_DIR
      ? path.resolve(process.env.SQL_OUTPUT_DIR, env)
      : path.resolve(__dirname, "..", "..", "sql", env);

  console.log("═══════════════════════════════════════════════════════════");
  console.log(`  PostgreSQL DDL Watch Mode`);
  console.log(`  Environment: ${env.toUpperCase()}`);
  console.log(`  Interval:    ${intervalSec}s`);
  console.log(`  Output:      ${outputDir}`);
  console.log("═══════════════════════════════════════════════════════════");

  // Check SSH tunnel
  const sshConfig = getSshConfig(env);
  let tunnel: TunnelResult | null = null;

  let pgConfig =
    options.host || options.database || options.user
      ? {
          host: options.host || "localhost",
          port: options.port ? parseInt(options.port, 10) : 5432,
          database: options.database!,
          user: options.user!,
          password: options.password || "",
          connectionTimeoutMillis: 10000,
          query_timeout: 30000,
        }
      : getDbConfig(env);

  if (options.host || options.database || options.user) {
    if (!options.database || !options.user) {
      console.error("❌ When using CLI flags, --database and --user are required");
      process.exit(1);
    }
  }

  if (sshConfig) {
    try {
      tunnel = await createSshTunnel(sshConfig);
      pgConfig = { ...pgConfig, host: "127.0.0.1", port: tunnel.localPort };
    } catch (err: any) {
      console.error(`\n❌ SSH tunnel failed: ${err.message}`);
      process.exit(1);
    }
  }

  console.log(`\n🔌 Connecting to ${pgConfig.host}:${pgConfig.port}/${pgConfig.database}...`);

  const client = new Client(pgConfig);

  try {
    await client.connect();
    console.log("✅ Connected\n");

    // Initial extraction
    let lastHash = "";
    let checkCount = 0;

    const doExtract = async (): Promise<void> => {
      const writer = new SqlFileWriter(outputDir);
      const extractor = new DdlExtractor(client, writer);
      await extractor.extractAll();

      const stats = writer.getChangeStats();
      const summary = writer.getSummary();
      const total = Object.values(summary).reduce((a, b) => a + b, 0);

      if (stats.created > 0 || stats.updated > 0) {
        console.log(`\n  📦 Extracted ${total} objects (${stats.created} new, ${stats.updated} updated)`);
      }
    };

    console.log("  📦 Initial extraction...");
    await doExtract();
    lastHash = await getSchemaHash(client);
    console.log(`\n  👀 Watching for changes (every ${intervalSec}s)... Press Ctrl+C to stop\n`);

    // Polling loop
    const poll = async (): Promise<void> => {
      try {
        checkCount++;
        const currentHash = await getSchemaHash(client);

        if (currentHash !== lastHash) {
          const time = new Date().toISOString().slice(11, 19);
          console.log(`  🔄 [${time}] Schema change detected! Re-extracting...`);
          await doExtract();
          lastHash = currentHash;
        } else if (checkCount % 10 === 0) {
          // Periodic heartbeat
          const time = new Date().toISOString().slice(11, 19);
          console.log(`  💤 [${time}] No changes (${checkCount} checks)`);
        }
      } catch (err: any) {
        console.error(`  ❌ Poll error: ${err.message}`);
      }
    };

    const intervalId = setInterval(poll, intervalSec * 1000);

    // Handle graceful shutdown
    const cleanup = async (): Promise<void> => {
      console.log("\n\n  🛑 Stopping watch mode...");
      clearInterval(intervalId);
      await client.end();
      if (tunnel) {
        await tunnel.close();
        console.log("  🔒 SSH tunnel closed");
      }
      console.log("  👋 Done!\n");
      process.exit(0);
    };

    process.on("SIGINT", cleanup);
    process.on("SIGTERM", cleanup);
  } catch (err: any) {
    console.error(`\n❌ Error: ${err.message}`);
    await client.end();
    if (tunnel) await tunnel.close();
    process.exit(1);
  }
}

main();
