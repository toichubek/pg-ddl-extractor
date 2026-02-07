"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const commander_1 = require("commander");
const pkg = require("../package.json");
const linter_1 = require("./linter");
const cli_utils_1 = require("./cli-utils");
// ─── Parse CLI args ───────────────────────────────────────────────
function parseArgs() {
    commander_1.program
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
    return commander_1.program.opts();
}
// ─── Main ─────────────────────────────────────────────────────────
async function main() {
    const options = parseArgs();
    const env = options.env || "dev";
    console.log("═══════════════════════════════════════════════════════════");
    console.log(`  PostgreSQL Schema Linter`);
    console.log(`  Environment: ${env.toUpperCase()}`);
    console.log("═══════════════════════════════════════════════════════════");
    await (0, cli_utils_1.runWithConnection)(options, async (client) => {
        const linter = new linter_1.SchemaLinter(client);
        const result = await linter.lint();
        (0, linter_1.printLintReport)(result);
        if (result.summary.errors > 0) {
            process.exit(1);
        }
    });
}
main();
