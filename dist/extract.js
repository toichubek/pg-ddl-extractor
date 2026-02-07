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
const config_1 = require("./config");
const writer_1 = require("./writer");
const extractor_1 = require("./extractor");
const tunnel_1 = require("./tunnel");
// ─── Load .env ────────────────────────────────────────────────────
dotenv.config();
// ─── Parse CLI args ───────────────────────────────────────────────
function parseArgs() {
    const args = process.argv.slice(2);
    let env = "dev"; // default
    for (let i = 0; i < args.length; i++) {
        if (args[i] === "--env" && args[i + 1]) {
            env = args[i + 1].toLowerCase();
            i++;
        }
    }
    if (!["dev", "prod"].includes(env)) {
        console.error(`❌ Invalid env: "${env}". Use --env dev or --env prod`);
        process.exit(1);
    }
    return { env };
}
// ─── Main ─────────────────────────────────────────────────────────
async function main() {
    const { env } = parseArgs();
    // extract-db lives at /myproject/extract-db/
    // sql folder lives at  /myproject/sql/
    const outputDir = path.resolve(__dirname, "..", "..", "sql", env);
    console.log("═══════════════════════════════════════════════════");
    console.log(`  PostgreSQL DDL Extractor`);
    console.log(`  Environment: ${env.toUpperCase()}`);
    console.log(`  Output:      ${outputDir}`);
    console.log("═══════════════════════════════════════════════════");
    // Check if SSH tunnel is needed
    const sshConfig = (0, tunnel_1.getSshConfig)(env);
    let tunnel = null;
    let pgConfig = (0, config_1.getDbConfig)(env);
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
        // Extract
        const writer = new writer_1.SqlFileWriter(outputDir);
        const extractor = new extractor_1.DdlExtractor(client, writer);
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
