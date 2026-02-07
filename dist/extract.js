"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
const path = __importStar(require("path"));
const pkg = require("../package.json");
const commander_1 = require("commander");
const writer_1 = require("./writer");
const extractor_1 = require("./extractor");
const data_extractor_1 = require("./data-extractor");
const json_exporter_1 = require("./json-exporter");
const rc_config_1 = require("./rc-config");
const snapshot_1 = require("./snapshot");
const cli_utils_1 = require("./cli-utils");
function parseArgs() {
    commander_1.program
        .name("pg-ddl-extract")
        .description("Extract PostgreSQL DDL into organized folder structure")
        .version(pkg.version)
        .option("--env <environment>", "Environment name (e.g. dev, stage, prod)", "dev")
        .option("--host <host>", "Database host")
        .option("--port <port>", "Database port")
        .option("--database <database>", "Database name")
        .option("--user <user>", "Database user")
        .option("--password <password>", "Database password")
        .option("--output <path>", "Output directory path")
        // Selective extraction options
        .option("--schema <schemas>", "Include only specific schemas (comma-separated)")
        .option("--tables <tables>", "Include only specific tables (comma-separated, format: schema.table)")
        .option("--exclude-schema <schemas>", "Exclude specific schemas (comma-separated)")
        .option("--exclude-tables <tables>", "Exclude specific tables (comma-separated, format: schema.table)")
        // Data extraction options
        .option("--with-data <tables>", "Extract data from specified tables (comma-separated)")
        .option("--max-rows <number>", "Max rows to extract per table (default: 10000)")
        // Format options
        .option("--format <format>", "Output format: sql (default) or json")
        // Incremental
        .option("--incremental", "Only re-extract objects that changed since last run")
        // Progress
        .option("--progress", "Show progress bar during extraction")
        .parse(process.argv);
    const options = commander_1.program.opts();
    // Validate format if provided
    if (options.format && !["sql", "json"].includes(options.format)) {
        console.error(`❌ Invalid format: "${options.format}". Use --format sql or --format json`);
        process.exit(1);
    }
    return options;
}
// ─── Main ─────────────────────────────────────────────────────────
async function main() {
    const cliOptions = parseArgs();
    // Load config file and merge with CLI options
    const rcConfig = (0, rc_config_1.loadRcConfig)();
    const options = rcConfig
        ? (0, rc_config_1.mergeWithCliOptions)(rcConfig, cliOptions)
        : cliOptions;
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
    let conn;
    try {
        conn = await (0, cli_utils_1.connectToDatabase)(options);
        // Get db version for info
        const { rows } = await conn.client.query("SELECT version();");
        console.log(`  DB: ${rows[0].version.split(",")[0]}\n`);
        // Prepare extraction filters
        const filters = {
            includeSchemas: options.schema ? options.schema.split(",").map((s) => s.trim()) : undefined,
            includeTables: options.tables ? options.tables.split(",").map((t) => t.trim()) : undefined,
            excludeSchemas: options.excludeSchema
                ? options.excludeSchema.split(",").map((s) => s.trim())
                : undefined,
            excludeTables: options.excludeTables
                ? options.excludeTables.split(",").map((t) => t.trim())
                : undefined,
        };
        // Log filters if any are set
        if (filters.includeSchemas || filters.includeTables || filters.excludeSchemas || filters.excludeTables) {
            console.log("\n🔍 Filters:");
            if (filters.includeSchemas)
                console.log(`   Include schemas: ${filters.includeSchemas.join(", ")}`);
            if (filters.includeTables)
                console.log(`   Include tables:  ${filters.includeTables.join(", ")}`);
            if (filters.excludeSchemas)
                console.log(`   Exclude schemas: ${filters.excludeSchemas.join(", ")}`);
            if (filters.excludeTables)
                console.log(`   Exclude tables:  ${filters.excludeTables.join(", ")}`);
        }
        // Incremental snapshot check
        if (options.incremental) {
            const snapshot = new snapshot_1.SnapshotManager(outputDir);
            const lastTs = snapshot.getLastTimestamp();
            if (lastTs) {
                console.log(`\n📸 Incremental mode: last snapshot ${lastTs}`);
            }
            else {
                console.log("\n📸 Incremental mode: no previous snapshot (full extraction)");
            }
            const currentHashes = await (0, snapshot_1.getObjectHashes)(conn.client);
            const changes = snapshot.getChangeSummary(currentHashes);
            if (changes.added.length === 0 && changes.modified.length === 0 && changes.removed.length === 0) {
                console.log("  🎉 No changes detected since last snapshot!\n");
                snapshot.save(conn.config.database || "unknown", currentHashes);
                return;
            }
            console.log(`  🆕 Added:     ${changes.added.length}`);
            console.log(`  🔄 Modified:  ${changes.modified.length}`);
            console.log(`  🗑️  Removed:   ${changes.removed.length}`);
            console.log(`  ✅ Unchanged: ${changes.unchanged.length}`);
            // Do full extraction (writer handles change detection at file level)
            // but save the snapshot after
            const format = options.format || "sql";
            if (format === "json") {
                const jsonExporter = new json_exporter_1.JsonExporter(conn.client, filters);
                const filepath = await jsonExporter.exportToFile(outputDir);
                console.log(`\n  📁 ${filepath}`);
            }
            else {
                const writer = new writer_1.SqlFileWriter(outputDir);
                const extractor = new extractor_1.DdlExtractor(conn.client, writer, filters);
                await extractor.extractAll();
                const summary = writer.getSummary();
                const total = Object.values(summary).reduce((a, b) => a + b, 0);
                const stats = writer.getChangeStats();
                console.log("\n═══════════════════════════════════════════════════");
                console.log(`  ✅ Incremental extraction: ${total} objects`);
                console.log("═══════════════════════════════════════════════════");
                console.log(`    🆕 Created:   ${stats.created}`);
                console.log(`    🔄 Updated:   ${stats.updated}`);
                console.log(`    ✅ Unchanged: ${stats.unchanged}`);
            }
            snapshot.save(conn.config.database || "unknown", currentHashes);
            console.log("  📸 Snapshot saved\n");
            return;
        }
        const format = options.format || "sql";
        if (format === "json") {
            // JSON export mode
            const jsonExporter = new json_exporter_1.JsonExporter(conn.client, filters);
            const filepath = await jsonExporter.exportToFile(outputDir);
            console.log("\n═══════════════════════════════════════════════════");
            console.log(`  ✅ Done! Exported schema as JSON`);
            console.log("═══════════════════════════════════════════════════");
            console.log(`\n  📁 ${filepath}\n`);
        }
        else {
            // SQL export mode (default)
            const writer = new writer_1.SqlFileWriter(outputDir);
            const extractor = new extractor_1.DdlExtractor(conn.client, writer, filters, !!options.progress);
            await extractor.extractAll();
            // Extract data if requested
            if (options.withData) {
                const dataTables = options.withData.split(",").map((t) => t.trim());
                const maxRows = options.maxRows ? parseInt(options.maxRows, 10) : 10000;
                if (isNaN(maxRows) || maxRows < 1 || maxRows > 1000000) {
                    console.error(`❌ Invalid --max-rows: "${options.maxRows}". Must be between 1 and 1,000,000`);
                    process.exit(1);
                }
                const dataExtractor = new data_extractor_1.DataExtractor(conn.client);
                await dataExtractor.extractData({
                    tables: dataTables,
                    maxRows,
                    outputDir,
                });
            }
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
            }
            else {
                console.log(`\n  Ready to commit to Git! 🎉\n`);
            }
        }
    }
    catch (err) {
        (0, cli_utils_1.handleError)(err);
        process.exit(1);
    }
    finally {
        if (conn)
            await (0, cli_utils_1.closeConnection)(conn);
    }
}
main();
