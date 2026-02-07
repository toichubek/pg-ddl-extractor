import * as dotenv from "dotenv";
import { Client } from "pg";
import { program } from "commander";
import { getDbConfig } from "./config";
import { SchemaLinter, printLintReport } from "./linter";
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
}

function parseArgs(): CliOptions {
  program
    .name("pg-ddl-lint")
    .description("Check PostgreSQL schema for common issues and best practices")
    .version("1.0.0")
    .option("--env <environment>", "Environment (dev or prod)", "dev")
    .option("--host <host>", "Database host")
    .option("--port <port>", "Database port")
    .option("--database <database>", "Database name")
    .option("--user <user>", "Database user")
    .option("--password <password>", "Database password")
    .parse(process.argv);

  const options = program.opts<CliOptions>();

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

  console.log("═══════════════════════════════════════════════════════════");
  console.log(`  PostgreSQL Schema Linter`);
  console.log(`  Environment: ${env.toUpperCase()}`);
  console.log("═══════════════════════════════════════════════════════════");

  // Check if SSH tunnel is needed
  const sshConfig = getSshConfig(env);
  let tunnel: TunnelResult | null = null;

  // Get DB config
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

    try {
      tunnel = await createSshTunnel(sshConfig);
      pgConfig = {
        ...pgConfig,
        host: "127.0.0.1",
        port: tunnel.localPort,
      };
    } catch (err: any) {
      console.error(`\n❌ SSH tunnel failed: ${err.message}`);
      process.exit(1);
    }
  }

  console.log(`\n🔌 Connecting to ${pgConfig.host}:${pgConfig.port}/${pgConfig.database}...`);

  const client = new Client(pgConfig);

  try {
    await client.connect();
    console.log("✅ Connected");

    const linter = new SchemaLinter(client);
    const result = await linter.lint();

    printLintReport(result);

    // Exit with error code if there are errors
    if (result.summary.errors > 0) {
      process.exit(1);
    }
  } catch (err: any) {
    console.error(`\n❌ Error: ${err.message}`);
    if (err.code === "ECONNREFUSED") {
      console.error("   → Check that the database server is running");
    }
    if (err.code === "28P01") {
      console.error("   → Invalid username or password");
    }
    process.exit(1);
  } finally {
    await client.end();
    if (tunnel) {
      await tunnel.close();
      console.log("🔒 SSH tunnel closed");
    }
  }
}

main();
