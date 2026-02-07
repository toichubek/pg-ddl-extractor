import * as fs from "fs";
import * as path from "path";
import * as dotenv from "dotenv";
import { program } from "commander";
import { Client } from "pg";
import { getDbConfig } from "./config";
import { getSshConfig, createSshTunnel, TunnelResult } from "./tunnel";
import {
  generateMigration,
  generateRollback,
  saveMigration,
  saveRollback,
  printMigrationSummary,
  printDryRun,
  interactiveReview,
} from "./migration-generator";
import { PreMigrationChecker, printPreCheckReport } from "./pre-check";
import { MigrationTracker } from "./migration-tracker";

// ─── Load .env ────────────────────────────────────────────────────
dotenv.config();

// ─── Parse CLI args ───────────────────────────────────────────────
interface CliOptions {
  sqlDir?: string;
  dev?: string;
  prod?: string;
  output?: string;
  withRollback?: boolean;
  dryRun?: boolean;
  interactive?: boolean;
  preCheck?: boolean;
  history?: boolean;
  track?: boolean;
  // Connection options for pre-check
  env?: string;
  host?: string;
  port?: string;
  database?: string;
  user?: string;
  password?: string;
}

function parseArgs(): CliOptions {
  program
    .name("pg-ddl-migrate")
    .description("Generate migration script from dev to prod schema")
    .version("1.0.0")
    .option("--sql-dir <path>", "Path to SQL directory (default: ../../sql)")
    .option("--dev <path>", "Path to dev schema directory")
    .option("--prod <path>", "Path to prod schema directory")
    .option("--output <path>", "Output directory for migration files")
    .option("--with-rollback", "Generate rollback script alongside migration")
    .option("--dry-run", "Preview migration plan without saving files")
    .option("--interactive", "Review each change interactively before including")
    .option("--pre-check", "Run database health checks before generating migration")
    .option("--history", "Show migration history from the database")
    .option("--track", "Record migration in schema_migrations table after generating")
    .option("--env <environment>", "Environment for pre-check connection", "dev")
    .option("--host <host>", "Database host for pre-check")
    .option("--port <port>", "Database port for pre-check")
    .option("--database <database>", "Database name for pre-check")
    .option("--user <user>", "Database user for pre-check")
    .option("--password <password>", "Database password for pre-check")
    .parse(process.argv);

  return program.opts<CliOptions>();
}

// ─── Main ─────────────────────────────────────────────────────

async function main(): Promise<void> {
  const options = parseArgs();

  // Determine SQL root directory
  const sqlRoot = options.sqlDir
    ? path.resolve(options.sqlDir)
    : process.env.SQL_OUTPUT_DIR
      ? path.resolve(process.env.SQL_OUTPUT_DIR)
      : path.resolve(__dirname, "..", "..", "sql");

  if (!fs.existsSync(sqlRoot)) {
    console.error(`❌ sql/ folder not found at: ${sqlRoot}`);
    console.error("   Run extract:dev and extract:prod first.");
    process.exit(1);
  }

  // Determine dev and prod directories
  const devDir = options.dev ? path.resolve(options.dev) : path.join(sqlRoot, "dev");
  const prodDir = options.prod ? path.resolve(options.prod) : path.join(sqlRoot, "prod");

  if (!fs.existsSync(devDir)) {
    console.error("❌ sql/dev/ not found. Run: npm run extract:dev");
    process.exit(1);
  }
  if (!fs.existsSync(prodDir)) {
    console.error("❌ sql/prod/ not found. Run: npm run extract:prod");
    process.exit(1);
  }

  // Helper to get DB connection config
  function getConnectionConfig() {
    return options.host || options.database || options.user
      ? {
          host: options.host || "localhost",
          port: options.port ? parseInt(options.port, 10) : 5432,
          database: options.database!,
          user: options.user!,
          password: options.password || "",
          connectionTimeoutMillis: 10000,
          query_timeout: 30000,
        }
      : getDbConfig(options.env || "dev");
  }

  try {
    // Show migration history
    if (options.history) {
      const pgConfig = getConnectionConfig();
      const sshConfig = getSshConfig(options.env || "dev");
      let tunnel: TunnelResult | null = null;
      let finalConfig = pgConfig;

      if (sshConfig) {
        tunnel = await createSshTunnel(sshConfig);
        finalConfig = { ...pgConfig, host: "127.0.0.1", port: tunnel.localPort };
      }

      const client = new Client(finalConfig);
      try {
        await client.connect();
        const tracker = new MigrationTracker(client);
        await tracker.printHistory();
      } finally {
        await client.end();
        if (tunnel) await tunnel.close();
      }
      return;
    }

    // Run pre-migration checks if requested
    if (options.preCheck) {
      const pgConfig = getConnectionConfig();
      const sshConfig = getSshConfig(options.env || "dev");
      let tunnel: TunnelResult | null = null;
      let finalConfig = pgConfig;

      if (sshConfig) {
        tunnel = await createSshTunnel(sshConfig);
        finalConfig = { ...pgConfig, host: "127.0.0.1", port: tunnel.localPort };
      }

      const client = new Client(finalConfig);
      try {
        await client.connect();
        const checker = new PreMigrationChecker(client);
        const result = await checker.runChecks();
        printPreCheckReport(result);

        if (!result.passed) {
          console.log("  ⚠️  Pre-checks have warnings. Proceeding with migration generation...\n");
        }
      } catch (err: any) {
        console.error(`  ⚠️  Pre-check connection failed: ${err.message}`);
        console.error("  Continuing with migration generation...\n");
      } finally {
        await client.end();
        if (tunnel) await tunnel.close();
      }
    }

    // Generate migration plan
    let migration = generateMigration(sqlRoot);

    if (options.dryRun) {
      // Dry-run: show what would be done without saving
      printDryRun(migration);
      return;
    }

    // Interactive mode: review each change
    if (options.interactive) {
      migration = await interactiveReview(migration);
    }

    // Save migration to file
    const filepath = saveMigration(sqlRoot, migration);

    // Generate and save rollback if requested
    let rollbackPath: string | undefined;
    if (options.withRollback) {
      const rollback = generateRollback(sqlRoot, migration);
      rollbackPath = saveRollback(sqlRoot, rollback);
    }

    // Track migration in database if requested
    if (options.track && migration.commands.length > 0) {
      const pgConfig = getConnectionConfig();
      const sshConfig = getSshConfig(options.env || "dev");
      let tunnel: TunnelResult | null = null;
      let finalConfig = pgConfig;

      if (sshConfig) {
        tunnel = await createSshTunnel(sshConfig);
        finalConfig = { ...pgConfig, host: "127.0.0.1", port: tunnel.localPort };
      }

      const client = new Client(finalConfig);
      try {
        await client.connect();
        const tracker = new MigrationTracker(client);
        const crypto = await import("crypto");
        const migrationContent = fs.readFileSync(filepath, "utf-8");
        const checksum = crypto.createHash("md5").update(migrationContent).digest("hex");
        const migrationName = path.basename(filepath);
        await tracker.recordApplied(migrationName, checksum, 0);
        console.log(`\n  📋 Recorded in schema_migrations: ${migrationName}`);
      } catch (err: any) {
        console.error(`\n  ⚠️  Could not record migration: ${err.message}`);
      } finally {
        await client.end();
        if (tunnel) await tunnel.close();
      }
    }

    // Print summary
    printMigrationSummary(migration, filepath, rollbackPath);
  } catch (err: any) {
    console.error(`❌ ${err.message}`);
    process.exit(1);
  }
}

main();
