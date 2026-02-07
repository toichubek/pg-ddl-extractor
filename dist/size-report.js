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
const fs = __importStar(require("fs"));
const dotenv = __importStar(require("dotenv"));
const pg_1 = require("pg");
const commander_1 = require("commander");
const config_1 = require("./config");
const tunnel_1 = require("./tunnel");
dotenv.config();
async function generateSizeReport(client, top) {
    // Database total size
    const { rows: dbInfo } = await client.query(`
    SELECT
      current_database() AS db_name,
      pg_size_pretty(pg_database_size(current_database())) AS db_size
  `);
    // Per-table sizes
    const { rows: tables } = await client.query(`
    SELECT
      schemaname AS schema,
      relname AS table_name,
      pg_size_pretty(pg_total_relation_size(relid)) AS total_size,
      pg_total_relation_size(relid) AS total_bytes,
      pg_size_pretty(pg_relation_size(relid)) AS data_size,
      pg_size_pretty(pg_total_relation_size(relid) - pg_relation_size(relid) - COALESCE(pg_relation_size(reltoastrelid), 0)) AS index_size,
      pg_size_pretty(COALESCE(pg_relation_size(reltoastrelid), 0)) AS toast_size,
      n_live_tup AS row_estimate
    FROM pg_stat_user_tables
    ORDER BY pg_total_relation_size(relid) DESC
    LIMIT $1;
  `, [top]);
    // Per-schema sizes
    const { rows: schemas } = await client.query(`
    SELECT
      schemaname AS schema,
      pg_size_pretty(sum(pg_total_relation_size(relid))) AS total_size,
      sum(pg_total_relation_size(relid)) AS total_bytes,
      count(*) AS table_count
    FROM pg_stat_user_tables
    GROUP BY schemaname
    ORDER BY sum(pg_total_relation_size(relid)) DESC;
  `);
    // Largest indexes
    const { rows: indexes } = await client.query(`
    SELECT
      schemaname || '.' || indexrelname AS index_name,
      schemaname || '.' || relname AS table_name,
      pg_size_pretty(pg_relation_size(indexrelid)) AS idx_size,
      pg_relation_size(indexrelid) AS idx_bytes
    FROM pg_stat_user_indexes
    ORDER BY pg_relation_size(indexrelid) DESC
    LIMIT $1;
  `, [top]);
    return {
        database: dbInfo[0].db_name,
        totalSize: dbInfo[0].db_size,
        tables: tables.map((t) => ({
            schema: t.schema,
            table: t.table_name,
            totalSize: t.total_size,
            totalBytes: parseInt(t.total_bytes, 10),
            dataSize: t.data_size,
            indexSize: t.index_size,
            toastSize: t.toast_size,
            rowEstimate: parseInt(t.row_estimate, 10),
        })),
        schemas: schemas.map((s) => ({
            schema: s.schema,
            totalSize: s.total_size,
            totalBytes: parseInt(s.total_bytes, 10),
            tableCount: parseInt(s.table_count, 10),
        })),
        largestIndexes: indexes.map((i) => ({
            name: i.index_name,
            table: i.table_name,
            size: i.idx_size,
            bytes: parseInt(i.idx_bytes, 10),
        })),
    };
}
function printSizeReport(report) {
    console.log("═══════════════════════════════════════════════════════════");
    console.log("  Schema Size Report");
    console.log(`  Database: ${report.database}`);
    console.log(`  Total Size: ${report.totalSize}`);
    console.log("═══════════════════════════════════════════════════════════");
    console.log("");
    // Schema sizes
    console.log("  📊 Size by Schema:");
    console.log("  " + "Schema".padEnd(30) + "Size".padStart(12) + "Tables".padStart(10));
    console.log("  " + "─".repeat(52));
    for (const s of report.schemas) {
        console.log("  " + s.schema.padEnd(30) + s.totalSize.padStart(12) + String(s.tableCount).padStart(10));
    }
    console.log("");
    // Top tables
    console.log("  📋 Largest Tables:");
    console.log("  " +
        "Table".padEnd(40) +
        "Total".padStart(10) +
        "Data".padStart(10) +
        "Index".padStart(10) +
        "TOAST".padStart(10) +
        "Rows".padStart(12));
    console.log("  " + "─".repeat(92));
    for (const t of report.tables) {
        console.log("  " +
            `${t.schema}.${t.table}`.padEnd(40) +
            t.totalSize.padStart(10) +
            t.dataSize.padStart(10) +
            t.indexSize.padStart(10) +
            t.toastSize.padStart(10) +
            String(t.rowEstimate).padStart(12));
    }
    console.log("");
    // Largest indexes
    console.log("  🔍 Largest Indexes:");
    console.log("  " + "Index".padEnd(45) + "Table".padEnd(30) + "Size".padStart(10));
    console.log("  " + "─".repeat(85));
    for (const idx of report.largestIndexes) {
        console.log("  " + idx.name.padEnd(45) + idx.table.padEnd(30) + idx.size.padStart(10));
    }
    console.log("");
    console.log("═══════════════════════════════════════════════════════════");
}
function parseArgs() {
    commander_1.program
        .name("pg-ddl-size")
        .description("Generate detailed schema size report")
        .version("1.0.0")
        .option("--env <environment>", "Environment (dev or prod)", "dev")
        .option("--host <host>", "Database host")
        .option("--port <port>", "Database port")
        .option("--database <database>", "Database name")
        .option("--user <user>", "Database user")
        .option("--password <password>", "Database password")
        .option("--output <path>", "Save report to file")
        .option("--json", "Output as JSON")
        .option("--top <number>", "Number of items to show per section", "20")
        .parse(process.argv);
    return commander_1.program.opts();
}
async function main() {
    const options = parseArgs();
    const env = options.env || "dev";
    const sshConfig = (0, tunnel_1.getSshConfig)(env);
    let tunnel = null;
    let pgConfig = options.host || options.database || options.user
        ? {
            host: options.host || "localhost",
            port: options.port ? parseInt(options.port, 10) : 5432,
            database: options.database,
            user: options.user,
            password: options.password || "",
            connectionTimeoutMillis: 10000,
            query_timeout: 30000,
        }
        : (0, config_1.getDbConfig)(env);
    if (sshConfig) {
        try {
            tunnel = await (0, tunnel_1.createSshTunnel)(sshConfig);
            pgConfig = { ...pgConfig, host: "127.0.0.1", port: tunnel.localPort };
        }
        catch (err) {
            console.error(`❌ SSH tunnel failed: ${err.message}`);
            process.exit(1);
        }
    }
    const client = new pg_1.Client(pgConfig);
    try {
        await client.connect();
        const top = parseInt(options.top || "20", 10);
        const report = await generateSizeReport(client, top);
        if (options.json) {
            const jsonOutput = JSON.stringify(report, null, 2);
            if (options.output) {
                fs.writeFileSync(options.output, jsonOutput, "utf-8");
                console.log(`📊 JSON report saved to: ${options.output}`);
            }
            else {
                console.log(jsonOutput);
            }
        }
        else {
            printSizeReport(report);
        }
    }
    catch (err) {
        console.error(`\n❌ Error: ${err.message}`);
        process.exit(1);
    }
    finally {
        await client.end();
        if (tunnel)
            await tunnel.close();
    }
}
main();
