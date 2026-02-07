import * as fs from "fs";
import * as path from "path";
import { program } from "commander";
import { generateMigration, saveMigration, printMigrationSummary } from "./migration-generator";

// ─── Parse CLI args ───────────────────────────────────────────────
interface CliOptions {
  sqlDir?: string;
  dev?: string;
  prod?: string;
  output?: string;
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

    // Save to file
    const filepath = saveMigration(sqlRoot, migration);

    // Print summary
    printMigrationSummary(migration, filepath);
  } catch (err: any) {
    console.error(`❌ ${err.message}`);
    process.exit(1);
  }
}

main();
