import { program } from "commander";
const pkg = require("../package.json");
import { SchemaLinter, printLintReport } from "./linter";
import { DbCliOptions, runWithConnection } from "./cli-utils";

// ─── Parse CLI args ───────────────────────────────────────────────
function parseArgs(): DbCliOptions {
  program
    .name("pg-ddl-lint")
    .description("Check PostgreSQL schema for common issues and best practices")
    .version(pkg.version)
    .option("--env <environment>", "Environment name (e.g. dev, stage, prod)", "dev")
    .option("--host <host>", "Database host")
    .option("--port <port>", "Database port")
    .option("--database <database>", "Database name")
    .option("--user <user>", "Database user")
    .option("--password <password>", "Database password")
    .parse(process.argv);

  return program.opts<DbCliOptions>();
}

// ─── Main ─────────────────────────────────────────────────────────
async function main(): Promise<void> {
  const options = parseArgs();
  const env = options.env || "dev";

  console.log("═══════════════════════════════════════════════════════════");
  console.log(`  PostgreSQL Schema Linter`);
  console.log(`  Environment: ${env.toUpperCase()}`);
  console.log("═══════════════════════════════════════════════════════════");

  await runWithConnection(options, async (client) => {
    const linter = new SchemaLinter(client);
    const result = await linter.lint();
    printLintReport(result);

    if (result.summary.errors > 0) {
      process.exit(1);
    }
  });
}

main();
