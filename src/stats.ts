import * as dotenv from "dotenv";
import { Client } from "pg";
import { program } from "commander";
import { getDbConfig } from "./config";
import { getSshConfig, createSshTunnel, TunnelResult } from "./tunnel";

dotenv.config();

interface CliOptions {
  env?: string;
  host?: string;
  port?: string;
  database?: string;
  user?: string;
  password?: string;
}

function parseArgs(): CliOptions {
  program
    .name("pg-ddl-stats")
    .description("Show PostgreSQL database statistics and health overview")
    .version("1.0.0")
    .option("--env <environment>", "Environment (dev or prod)", "dev")
    .option("--host <host>", "Database host")
    .option("--port <port>", "Database port")
    .option("--database <database>", "Database name")
    .option("--user <user>", "Database user")
    .option("--password <password>", "Database password")
    .parse(process.argv);

  return program.opts<CliOptions>();
}

async function main(): Promise<void> {
  const options = parseArgs();
  const env = options.env || "dev";

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

  if (sshConfig) {
    try {
      tunnel = await createSshTunnel(sshConfig);
      pgConfig = { ...pgConfig, host: "127.0.0.1", port: tunnel.localPort };
    } catch (err: any) {
      console.error(`❌ SSH tunnel failed: ${err.message}`);
      process.exit(1);
    }
  }

  const client = new Client(pgConfig);

  try {
    await client.connect();

    const { rows: vr } = await client.query("SELECT version();");
    const dbVersion = vr[0].version.split(",")[0];

    console.log("═══════════════════════════════════════════════════════════");
    console.log("  PostgreSQL Database Statistics");
    console.log(`  Environment: ${env.toUpperCase()}`);
    console.log(`  ${dbVersion}`);
    console.log("═══════════════════════════════════════════════════════════");
    console.log("");

    // Database overview
    const { rows: dbInfo } = await client.query(`
      SELECT
        pg_size_pretty(pg_database_size(current_database())) AS db_size,
        current_database() AS db_name
    `);

    console.log("  📊 Database Overview:");
    console.log(`    Name: ${dbInfo[0].db_name}`);
    console.log(`    Size: ${dbInfo[0].db_size}`);

    // Object counts
    const { rows: counts } = await client.query(`
      SELECT
        (SELECT count(*) FROM pg_tables WHERE schemaname NOT IN ('pg_catalog','information_schema')) AS tables,
        (SELECT count(*) FROM pg_views WHERE schemaname NOT IN ('pg_catalog','information_schema')) AS views,
        (SELECT count(*) FROM pg_matviews WHERE schemaname NOT IN ('pg_catalog','information_schema')) AS mat_views,
        (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname NOT IN ('pg_catalog','information_schema')) AS functions,
        (SELECT count(*) FROM pg_indexes WHERE schemaname NOT IN ('pg_catalog','information_schema')) AS indexes,
        (SELECT count(*) FROM information_schema.triggers WHERE trigger_schema NOT IN ('pg_catalog','information_schema')) AS triggers,
        (SELECT count(*) FROM information_schema.sequences WHERE sequence_schema NOT IN ('pg_catalog','information_schema')) AS sequences,
        (SELECT count(*) FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace WHERE n.nspname NOT IN ('pg_catalog','information_schema') AND (t.typtype = 'e' OR (t.typtype = 'c' AND EXISTS(SELECT 1 FROM pg_class c WHERE c.oid = t.typrelid AND c.relkind = 'c')))) AS types
    `);

    const c = counts[0];
    console.log("");
    console.log("  📦 Object Counts:");
    console.log(`    Tables:             ${c.tables}`);
    console.log(`    Views:              ${c.views}`);
    console.log(`    Materialized Views: ${c.mat_views}`);
    console.log(`    Functions:          ${c.functions}`);
    console.log(`    Indexes:            ${c.indexes}`);
    console.log(`    Triggers:           ${c.triggers}`);
    console.log(`    Sequences:          ${c.sequences}`);
    console.log(`    Types:              ${c.types}`);

    // Top tables by size
    const { rows: topTables } = await client.query(`
      SELECT
        schemaname || '.' || relname AS table_name,
        pg_size_pretty(pg_total_relation_size(relid)) AS total_size,
        pg_size_pretty(pg_relation_size(relid)) AS data_size,
        pg_size_pretty(pg_total_relation_size(relid) - pg_relation_size(relid)) AS index_size,
        n_live_tup AS row_estimate
      FROM pg_stat_user_tables
      ORDER BY pg_total_relation_size(relid) DESC
      LIMIT 10;
    `);

    if (topTables.length > 0) {
      console.log("");
      console.log("  📋 Top 10 Tables by Size:");
      console.log("    " + "Table".padEnd(40) + "Total".padStart(10) + "Data".padStart(10) + "Idx".padStart(10) + "Rows".padStart(12));
      console.log("    " + "─".repeat(82));
      for (const t of topTables) {
        console.log(
          "    " +
            t.table_name.padEnd(40) +
            t.total_size.padStart(10) +
            t.data_size.padStart(10) +
            t.index_size.padStart(10) +
            String(t.row_estimate).padStart(12)
        );
      }
    }

    // Unused indexes
    const { rows: unusedIdx } = await client.query(`
      SELECT
        schemaname || '.' || indexrelname AS index_name,
        schemaname || '.' || relname AS table_name,
        pg_size_pretty(pg_relation_size(indexrelid)) AS idx_size
      FROM pg_stat_user_indexes
      WHERE idx_scan = 0
        AND indexrelname NOT IN (
          SELECT constraint_name FROM information_schema.table_constraints
          WHERE constraint_type IN ('PRIMARY KEY','UNIQUE')
        )
      ORDER BY pg_relation_size(indexrelid) DESC
      LIMIT 10;
    `);

    if (unusedIdx.length > 0) {
      console.log("");
      console.log("  ⚠️  Unused Indexes (never scanned):");
      for (const idx of unusedIdx) {
        console.log(`    ${idx.index_name} (${idx.idx_size}) on ${idx.table_name}`);
      }
    }

    // Connection stats
    const { rows: connStats } = await client.query(`
      SELECT
        count(*) FILTER (WHERE state = 'active') AS active,
        count(*) FILTER (WHERE state = 'idle') AS idle,
        count(*) FILTER (WHERE state = 'idle in transaction') AS idle_txn,
        count(*) AS total,
        (SELECT setting::int FROM pg_settings WHERE name = 'max_connections') AS max_conn
      FROM pg_stat_activity;
    `);

    const cs = connStats[0];
    console.log("");
    console.log("  🔌 Connections:");
    console.log(`    Active:              ${cs.active}`);
    console.log(`    Idle:                ${cs.idle}`);
    console.log(`    Idle in Transaction: ${cs.idle_txn}`);
    console.log(`    Total / Max:         ${cs.total} / ${cs.max_conn}`);

    // Cache hit ratio
    const { rows: cacheStats } = await client.query(`
      SELECT
        round(100.0 * sum(heap_blks_hit) / NULLIF(sum(heap_blks_hit) + sum(heap_blks_read), 0), 2) AS cache_hit_ratio
      FROM pg_statio_user_tables;
    `);

    const hitRatio = cacheStats[0].cache_hit_ratio || 0;
    console.log("");
    console.log("  🏎️  Performance:");
    console.log(`    Cache Hit Ratio: ${hitRatio}%${parseFloat(hitRatio) < 90 ? " ⚠️  (should be > 99%)" : " ✅"}`);

    console.log("");
    console.log("═══════════════════════════════════════════════════════════");
  } catch (err: any) {
    console.error(`\n❌ Error: ${err.message}`);
    process.exit(1);
  } finally {
    await client.end();
    if (tunnel) await tunnel.close();
  }
}

main();
