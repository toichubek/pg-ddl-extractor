import * as fs from "fs";
import * as path from "path";
import { program } from "commander";
const pkg = require("../package.json");
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
import { DbCliOptions, connectToDatabase, closeConnection, runWithConnection } from "./cli-utils";

// ─── Parse CLI args ───────────────────────────────────────────────
interface CliOptions extends DbCliOptions {
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
}

function parseArgs(): CliOptions {
  program
    .name("pg-ddl-migrate")
    .description("Generate migration script from dev to prod schema")
    .version(pkg.version)
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
    .option("--env <environment>", "Environment for pre-check connection (e.g. dev, stage, prod)", "dev")
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

  try {
    // Show migration history
    if (options.history) {
      await runWithConnection(options, async (client) => {
        const tracker = new MigrationTracker(client);
        await tracker.printHistory();
      });
      return;
    }

    // Run pre-migration checks if requested
    if (options.preCheck) {
      try {
        const conn = await connectToDatabase(options);
        try {
          const checker = new PreMigrationChecker(conn.client);
          const result = await checker.runChecks();
          printPreCheckReport(result);

          if (!result.passed) {
            console.log("  ⚠️  Pre-checks have warnings. Proceeding with migration generation...\n");
          }
        } finally {
          await closeConnection(conn);
        }
      } catch (err: any) {
        console.error(`  ⚠️  Pre-check connection failed: ${err.message}`);
        console.error("  Continuing with migration generation...\n");
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
      try {
        const conn = await connectToDatabase(options);
        try {
          const tracker = new MigrationTracker(conn.client);
          const crypto = await import("crypto");
          const migrationContent = fs.readFileSync(filepath, "utf-8");
          const checksum = crypto.createHash("md5").update(migrationContent).digest("hex");
          const migrationName = path.basename(filepath);
          await tracker.recordApplied(migrationName, checksum, 0);
          console.log(`\n  📋 Recorded in schema_migrations: ${migrationName}`);
        } finally {
          await closeConnection(conn);
        }
      } catch (err: any) {
        console.error(`\n  ⚠️  Could not record migration: ${err.message}`);
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
