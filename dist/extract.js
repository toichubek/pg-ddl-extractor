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
const dotenv = __importStar(require("dotenv"));
const pg_1 = require("pg");
const commander_1 = require("commander");
const config_1 = require("./config");
const writer_1 = require("./writer");
const extractor_1 = require("./extractor");
const tunnel_1 = require("./tunnel");
// ─── Load .env ────────────────────────────────────────────────────
dotenv.config();
function parseArgs() {
    commander_1.program
        .name("pg-ddl-extract")
        .description("Extract PostgreSQL DDL into organized folder structure")
        .version("1.0.0")
        .option("--env <environment>", "Environment (dev or prod)", "dev")
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
        .parse(process.argv);
    const options = commander_1.program.opts();
    // Validate env if provided
    if (options.env && !["dev", "prod"].includes(options.env)) {
        console.error(`❌ Invalid env: "${options.env}". Use --env dev or --env prod`);
        process.exit(1);
    }
    return options;
}
// ─── Main ─────────────────────────────────────────────────────────
async function main() {
    const options = parseArgs();
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
    // Check if SSH tunnel is needed
    const sshConfig = (0, tunnel_1.getSshConfig)(env);
    let tunnel = null;
    // Get DB config - use CLI options if provided, otherwise use env-based config
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
    // Validate required fields if using CLI options
    if (options.host || options.database || options.user) {
        if (!options.database || !options.user) {
            console.error("❌ When using CLI flags, --database and --user are required");
            process.exit(1);
        }
        // Validate port number
        if (options.port) {
            const port = parseInt(options.port, 10);
            if (isNaN(port) || port < 1 || port > 65535) {
                console.error(`❌ Invalid port number: "${options.port}". Port must be between 1 and 65535`);
                process.exit(1);
            }
        }
    }
    if (sshConfig) {
        console.log(`\n🔒 SSH tunnel: ${sshConfig.sshUser}@${sshConfig.sshHost}:${sshConfig.sshPort}`);
        console.log(`   Remote DB:  ${sshConfig.remoteHost}:${sshConfig.remotePort}`);
        try {
            tunnel = await (0, tunnel_1.createSshTunnel)(sshConfig);
            console.log(`   Local port: 127.0.0.1:${tunnel.localPort}`);
            // Override pg config to connect through tunnel
            pgConfig = {
                ...pgConfig,
                host: "127.0.0.1",
                port: tunnel.localPort,
            };
        }
        catch (err) {
            console.error(`\n❌ SSH tunnel failed: ${err.message}`);
            if (err.message.includes("Authentication")) {
                console.error("   → Check SSH_USER, SSH_PASSWORD or SSH_KEY_PATH in .env");
            }
            if (err.message.includes("ECONNREFUSED")) {
                console.error("   → SSH server not reachable");
            }
            process.exit(1);
        }
    }
    console.log(`\n🔌 Connecting to ${pgConfig.host}:${pgConfig.port}/${pgConfig.database}...`);
    const client = new pg_1.Client(pgConfig);
    try {
        await client.connect();
        console.log("✅ Connected\n");
        // Get db version for info
        const { rows } = await client.query("SELECT version();");
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
        // Extract
        const writer = new writer_1.SqlFileWriter(outputDir);
        const extractor = new extractor_1.DdlExtractor(client, writer, filters);
        await extractor.extractAll();
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
    catch (err) {
        console.error(`\n❌ Error: ${err.message}`);
        if (err.code === "ECONNREFUSED") {
            console.error("   → Check that the database server is running");
        }
        if (err.code === "28P01") {
            console.error("   → Invalid username or password");
        }
        if (err.code === "3D000") {
            console.error("   → Database does not exist");
        }
        process.exit(1);
    }
    finally {
        await client.end();
        // Close SSH tunnel if it was opened
        if (tunnel) {
            await tunnel.close();
            console.log("🔒 SSH tunnel closed");
        }
    }
}
main();
