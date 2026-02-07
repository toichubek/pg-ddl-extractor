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
const dotenv = __importStar(require("dotenv"));
const pg_1 = require("pg");
const commander_1 = require("commander");
const pkg = require("../package.json");
const config_1 = require("./config");
const linter_1 = require("./linter");
const tunnel_1 = require("./tunnel");
// ─── Load .env ────────────────────────────────────────────────────
dotenv.config();
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
    const options = commander_1.program.opts();
    return options;
}
// ─── Main ─────────────────────────────────────────────────────────
async function main() {
    const options = parseArgs();
    const env = options.env || "dev";
    console.log("═══════════════════════════════════════════════════════════");
    console.log(`  PostgreSQL Schema Linter`);
    console.log(`  Environment: ${env.toUpperCase()}`);
    console.log("═══════════════════════════════════════════════════════════");
    // Check if SSH tunnel is needed
    const sshConfig = (0, tunnel_1.getSshConfig)(env);
    let tunnel = null;
    // Get DB config
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
    if (options.host || options.database || options.user) {
        if (!options.database || !options.user) {
            console.error("❌ When using CLI flags, --database and --user are required");
            process.exit(1);
        }
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
        try {
            tunnel = await (0, tunnel_1.createSshTunnel)(sshConfig);
            pgConfig = {
                ...pgConfig,
                host: "127.0.0.1",
                port: tunnel.localPort,
            };
        }
        catch (err) {
            console.error(`\n❌ SSH tunnel failed: ${err.message}`);
            process.exit(1);
        }
    }
    console.log(`\n🔌 Connecting to ${pgConfig.host}:${pgConfig.port}/${pgConfig.database}...`);
    const client = new pg_1.Client(pgConfig);
    try {
        await client.connect();
        console.log("✅ Connected");
        const linter = new linter_1.SchemaLinter(client);
        const result = await linter.lint();
        (0, linter_1.printLintReport)(result);
        // Exit with error code if there are errors
        if (result.summary.errors > 0) {
            process.exit(1);
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
        process.exit(1);
    }
    finally {
        await client.end();
        if (tunnel) {
            await tunnel.close();
            console.log("🔒 SSH tunnel closed");
        }
    }
}
main();
