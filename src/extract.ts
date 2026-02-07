import * as path from "path";
import * as dotenv from "dotenv";
import { Client } from "pg";
import { program } from "commander";
import { getDbConfig } from "./config";
import { SqlFileWriter } from "./writer";
import { DdlExtractor } from "./extractor";
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
}

function parseArgs(): CliOptions {
  program
    .name("pg-ddl-extract")
    .description("Extract PostgreSQL DDL into organized folder structure")
    .version("1.0.0")
    .option("--env <environment>", "Environment (dev or prod)", "dev")
    .option("--host <host>", "Database host")
    .option("--port <port>", "Database port")
    .option("--database <database>", "Database name")
    .option("--user <user>", "Database user")
    .option("--password <password>", "Database password")
    .option("--output <path>", "Output directory path")
    .parse(process.argv);

  const options = program.opts<CliOptions>();

  // Validate env if provided
  if (options.env && !["dev", "prod"].includes(options.env)) {
    console.error(`❌ Invalid env: "${options.env}". Use --env dev or --env prod`);
    process.exit(1);
  }

  return options;
}

// ─── Main ─────────────────────────────────────────────────────────
async function main(): Promise<void> {
  const options = parseArgs();
  const env = options.env || "dev";

  // Determine output directory
  const outputDir = options.output
    ? path.resolve(options.output)
    : process.env.SQL_OUTPUT_DIR
    ? path.resolve(process.env.SQL_OUTPUT_DIR, env)
    : path.resolve(__dirname, "..", "..", "sql", env);

  console.log("═══════════════════════════════════════════════════");
  console.log(`  PostgreSQL DDL Extractor`);
  console.log(`  Environment: ${env.toUpperCase()}`);
  console.log(`  Output:      ${outputDir}`);
  console.log("═══════════════════════════════════════════════════");

  // Check if SSH tunnel is needed
  const sshConfig = getSshConfig(env);
  let tunnel: TunnelResult | null = null;

  // Get DB config - use CLI options if provided, otherwise use env-based config
  let pgConfig = options.host || options.database || options.user
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

  // Validate required fields if using CLI options
  if (options.host || options.database || options.user) {
    if (!options.database || !options.user) {
      console.error("❌ When using CLI flags, --database and --user are required");
      process.exit(1);
    }

    // Validate port number
    if (options.port) {
      const port = parseInt(options.port, 10);
      if (isNaN(port) || port < 1 || port > 65535) {
        console.error(`❌ Invalid port number: "${options.port}". Port must be between 1 and 65535`);
        process.exit(1);
      }
    }
  }

  if (sshConfig) {
    console.log(`\n🔒 SSH tunnel: ${sshConfig.sshUser}@${sshConfig.sshHost}:${sshConfig.sshPort}`);
    console.log(`   Remote DB:  ${sshConfig.remoteHost}:${sshConfig.remotePort}`);

    try {
      tunnel = await createSshTunnel(sshConfig);
      console.log(`   Local port: 127.0.0.1:${tunnel.localPort}`);

      // Override pg config to connect through tunnel
      pgConfig = {
        ...pgConfig,
        host: "127.0.0.1",
        port: tunnel.localPort,
      };
    } catch (err: any) {
      console.error(`\n❌ SSH tunnel failed: ${err.message}`);
      if (err.message.includes("Authentication")) {
        console.error("   → Check SSH_USER, SSH_PASSWORD or SSH_KEY_PATH in .env");
      }
      if (err.message.includes("ECONNREFUSED")) {
        console.error("   → SSH server not reachable");
      }
      process.exit(1);
    }
  }

  console.log(`\n🔌 Connecting to ${pgConfig.host}:${pgConfig.port}/${pgConfig.database}...`);

  const client = new Client(pgConfig);

  try {
    await client.connect();
    console.log("✅ Connected\n");

    // Get db version for info
    const { rows } = await client.query("SELECT version();");
    console.log(`  DB: ${rows[0].version.split(",")[0]}\n`);

    // Extract
    const writer = new SqlFileWriter(outputDir);
    const extractor = new DdlExtractor(client, writer);
    await extractor.extractAll();

    // Summary
    const summary = writer.getSummary();
    const total = Object.values(summary).reduce((a, b) => a + b, 0);
    const stats = writer.getChangeStats();

    console.log("\n═══════════════════════════════════════════════════");
    console.log(`  ✅ Done! Extracted ${total} objects into sql/${env}/`);
    console.log("═══════════════════════════════════════════════════");
    console.log(`\n  📁 ${outputDir}`);
    console.log(`  📄 Full dump: sql/${env}/_full_dump.sql`);
    console.log("\n  Change Summary:");
    console.log(`    🆕 Created:   ${stats.created}`);
    console.log(`    🔄 Updated:   ${stats.updated}`);
    console.log(`    ✅ Unchanged: ${stats.unchanged}`);

    if (stats.created === 0 && stats.updated === 0) {
      console.log(`\n  🎉 No changes - database structure is unchanged!\n`);
    } else {
      console.log(`\n  Ready to commit to Git! 🎉\n`);
    }
  } catch (err: any) {
    console.error(`\n❌ Error: ${err.message}`);
    if (err.code === "ECONNREFUSED") {
      console.error("   → Check that the database server is running");
    }
    if (err.code === "28P01") {
      console.error("   → Invalid username or password");
    }
    if (err.code === "3D000") {
      console.error("   → Database does not exist");
    }
    process.exit(1);
  } finally {
    await client.end();
    // Close SSH tunnel if it was opened
    if (tunnel) {
      await tunnel.close();
      console.log("🔒 SSH tunnel closed");
    }
  }
}

main();