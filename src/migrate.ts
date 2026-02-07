import * as fs from "fs";
import * as path from "path";
import { generateMigration, saveMigration, printMigrationSummary } from "./migration-generator";

// ─── Main ─────────────────────────────────────────────────────

function main(): void {
  // sql/ lives at ../../sql relative to this script (extract-db/src/)
  const sqlRoot = path.resolve(__dirname, "..", "..", "sql");

  if (!fs.existsSync(sqlRoot)) {
    console.error(`❌ sql/ folder not found at: ${sqlRoot}`);
    console.error("   Run extract:dev and extract:prod first.");
    process.exit(1);
  }

  const devDir = path.join(sqlRoot, "dev");
  const prodDir = path.join(sqlRoot, "prod");

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
