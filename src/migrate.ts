import * as fs from "fs";
import * as path from "path";
import * as dotenv from "dotenv";
import { program } from "commander";
import {
  generateMigration,
  generateRollback,
  saveMigration,
  saveRollback,
  printMigrationSummary,
  printDryRun,
} from "./migration-generator";

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
    .parse(process.argv);

  return program.opts<CliOptions>();
}

// ─── Main ─────────────────────────────────────────────────────

function main(): void {
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
    // Generate migration plan
    const migration = generateMigration(sqlRoot);

    if (options.dryRun) {
      // Dry-run: show what would be done without saving
      printDryRun(migration);
      return;
    }

    // Save migration to file
    const filepath = saveMigration(sqlRoot, migration);

    // Generate and save rollback if requested
    let rollbackPath: string | undefined;
    if (options.withRollback) {
      const rollback = generateRollback(sqlRoot, migration);
      rollbackPath = saveRollback(sqlRoot, rollback);
    }

    // Print summary
    printMigrationSummary(migration, filepath, rollbackPath);
  } catch (err: any) {
    console.error(`❌ ${err.message}`);
    process.exit(1);
  }
}

main();
