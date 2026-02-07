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
const commander_1 = require("commander");
const pkg = require("../package.json");
const writer_1 = require("./writer");
const extractor_1 = require("./extractor");
const cli_utils_1 = require("./cli-utils");
function parseArgs() {
    commander_1.program
        .name("pg-ddl-watch")
        .description("Watch PostgreSQL schema for changes and auto-extract DDL")
        .version(pkg.version)
        .option("--env <environment>", "Environment name (e.g. dev, stage, prod)", "dev")
        .option("--host <host>", "Database host")
        .option("--port <port>", "Database port")
        .option("--database <database>", "Database name")
        .option("--user <user>", "Database user")
        .option("--password <password>", "Database password")
        .option("--output <path>", "Output directory path")
        .option("--interval <seconds>", "Polling interval in seconds", "30")
        .parse(process.argv);
    return commander_1.program.opts();
}
// ─── Schema Hash ──────────────────────────────────────────────────
async function getSchemaHash(client) {
    const { rows } = await client.query(`
    SELECT md5(string_agg(obj_def, '|' ORDER BY obj_type, obj_name)) AS schema_hash
    FROM (
      SELECT 'table' AS obj_type,
             n.nspname || '.' || c.relname AS obj_name,
             md5(
               array_to_string(
                 array_agg(
                   a.attname || ':' || pg_catalog.format_type(a.atttypid, a.atttypmod) || ':' || a.attnotnull::text
                   ORDER BY a.attnum
                 ), ','
               )
             ) AS obj_def
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
      WHERE c.relkind = 'r'
        AND n.nspname NOT IN ('pg_catalog', 'information_schema', 'pg_toast')
      GROUP BY n.nspname, c.relname

      UNION ALL

      SELECT 'function' AS obj_type,
             n.nspname || '.' || p.proname AS obj_name,
             md5(pg_get_functiondef(p.oid)) AS obj_def
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname NOT IN ('pg_catalog', 'information_schema', 'pg_toast')

      UNION ALL

      SELECT 'view' AS obj_type,
             schemaname || '.' || viewname AS obj_name,
             md5(definition) AS obj_def
      FROM pg_views
      WHERE schemaname NOT IN ('pg_catalog', 'information_schema', 'pg_toast')

      UNION ALL

      SELECT 'index' AS obj_type,
             schemaname || '.' || indexname AS obj_name,
             md5(indexdef) AS obj_def
      FROM pg_indexes
      WHERE schemaname NOT IN ('pg_catalog', 'information_schema', 'pg_toast')

      UNION ALL

      SELECT 'trigger' AS obj_type,
             trigger_schema || '.' || trigger_name AS obj_name,
             md5(action_statement) AS obj_def
      FROM information_schema.triggers
      WHERE trigger_schema NOT IN ('pg_catalog', 'information_schema', 'pg_toast')
    ) sub;
  `);
    return rows[0]?.schema_hash || "";
}
// ─── Main ─────────────────────────────────────────────────────────
async function main() {
    const options = parseArgs();
    const env = options.env || "dev";
    const intervalSec = parseInt(options.interval || "30", 10);
    if (isNaN(intervalSec) || intervalSec < 5) {
        console.error("❌ Interval must be at least 5 seconds");
        process.exit(1);
    }
    const outputDir = options.output
        ? path.resolve(options.output)
        : process.env.SQL_OUTPUT_DIR
            ? path.resolve(process.env.SQL_OUTPUT_DIR, env)
            : path.resolve(__dirname, "..", "..", "sql", env);
    console.log("═══════════════════════════════════════════════════════════");
    console.log(`  PostgreSQL DDL Watch Mode`);
    console.log(`  Environment: ${env.toUpperCase()}`);
    console.log(`  Interval:    ${intervalSec}s`);
    console.log(`  Output:      ${outputDir}`);
    console.log("═══════════════════════════════════════════════════════════");
    let conn;
    try {
        conn = await (0, cli_utils_1.connectToDatabase)(options);
    }
    catch (err) {
        console.error(`\n❌ Connection failed: ${err.message}`);
        process.exit(1);
        return;
    }
    try {
        let lastHash = "";
        let checkCount = 0;
        const doExtract = async () => {
            const writer = new writer_1.SqlFileWriter(outputDir);
            const extractor = new extractor_1.DdlExtractor(conn.client, writer);
            await extractor.extractAll();
            const stats = writer.getChangeStats();
            const summary = writer.getSummary();
            const total = Object.values(summary).reduce((a, b) => a + b, 0);
            if (stats.created > 0 || stats.updated > 0) {
                console.log(`\n  📦 Extracted ${total} objects (${stats.created} new, ${stats.updated} updated)`);
            }
        };
        console.log("  📦 Initial extraction...");
        await doExtract();
        lastHash = await getSchemaHash(conn.client);
        console.log(`\n  👀 Watching for changes (every ${intervalSec}s)... Press Ctrl+C to stop\n`);
        // Polling loop
        const poll = async () => {
            try {
                checkCount++;
                const currentHash = await getSchemaHash(conn.client);
                if (currentHash !== lastHash) {
                    const time = new Date().toISOString().slice(11, 19);
                    console.log(`  🔄 [${time}] Schema change detected! Re-extracting...`);
                    await doExtract();
                    lastHash = currentHash;
                }
                else if (checkCount % 10 === 0) {
                    const time = new Date().toISOString().slice(11, 19);
                    console.log(`  💤 [${time}] No changes (${checkCount} checks)`);
                }
            }
            catch (err) {
                console.error(`  ❌ Poll error: ${err.message}`);
            }
        };
        const intervalId = setInterval(poll, intervalSec * 1000);
        // Graceful shutdown
        const cleanup = async () => {
            console.log("\n\n  🛑 Stopping watch mode...");
            clearInterval(intervalId);
            await (0, cli_utils_1.closeConnection)(conn);
            console.log("  👋 Done!\n");
            process.exit(0);
        };
        process.on("SIGINT", cleanup);
        process.on("SIGTERM", cleanup);
    }
    catch (err) {
        console.error(`\n❌ Error: ${err.message}`);
        await (0, cli_utils_1.closeConnection)(conn);
        process.exit(1);
    }
}
main();
