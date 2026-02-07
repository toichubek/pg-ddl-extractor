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
exports.connectToDatabase = connectToDatabase;
exports.closeConnection = closeConnection;
exports.handleError = handleError;
exports.runWithConnection = runWithConnection;
const dotenv = __importStar(require("dotenv"));
const pg_1 = require("pg");
const config_1 = require("./config");
const tunnel_1 = require("./tunnel");
// Load .env once
dotenv.config();
// ─── Validate DB CLI flags ───────────────────────────────────────
function validateDbOptions(options) {
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
}
// ─── Build pg config from CLI flags or .env ──────────────────────
function buildPgConfig(options, env) {
    if (options.host || options.database || options.user) {
        return {
            host: options.host || "localhost",
            port: options.port ? parseInt(options.port, 10) : 5432,
            database: options.database,
            user: options.user,
            password: options.password || "",
            connectionTimeoutMillis: 10000,
            query_timeout: 30000,
        };
    }
    return (0, config_1.getDbConfig)(env);
}
// ─── Connect to database (with SSH tunnel if needed) ─────────────
async function connectToDatabase(options) {
    const env = options.env || "dev";
    validateDbOptions(options);
    let pgConfig = buildPgConfig(options, env);
    // SSH tunnel
    const sshConfig = (0, tunnel_1.getSshConfig)(env);
    let tunnel = null;
    if (sshConfig) {
        console.log(`\n🔒 SSH tunnel: ${sshConfig.sshUser}@${sshConfig.sshHost}:${sshConfig.sshPort}`);
        tunnel = await (0, tunnel_1.createSshTunnel)(sshConfig);
        pgConfig = { ...pgConfig, host: "127.0.0.1", port: tunnel.localPort };
    }
    console.log(`\n🔌 Connecting to ${pgConfig.host}:${pgConfig.port}/${pgConfig.database}...`);
    const client = new pg_1.Client(pgConfig);
    try {
        await client.connect();
        console.log("✅ Connected\n");
    }
    catch (err) {
        if (tunnel)
            await tunnel.close();
        throw err;
    }
    return { client, config: pgConfig, tunnel };
}
// ─── Cleanup connection ──────────────────────────────────────────
async function closeConnection(conn) {
    await conn.client.end();
    if (conn.tunnel) {
        await conn.tunnel.close();
        console.log("🔒 SSH tunnel closed");
    }
}
// ─── Handle common connection errors ─────────────────────────────
function handleConnectionError(err) {
    console.error(`\n❌ Connection failed: ${err.message}`);
    if (err.message?.includes("Authentication") || err.code === "28P01") {
        console.error("   → Invalid username or password");
    }
    if (err.message?.includes("ECONNREFUSED") || err.code === "ECONNREFUSED") {
        console.error("   → Check that the database server is running");
    }
    if (err.message?.includes("timeout") || err.code === "ETIMEDOUT") {
        console.error("   → Connection timed out. Check host and port");
    }
    if (err.code === "3D000") {
        console.error("   → Database does not exist");
    }
}
// ─── Handle errors in main function ──────────────────────────────
function handleError(err) {
    console.error(`\n❌ Error: ${err.message}`);
    handleConnectionError(err);
}
// ─── Run main with cleanup ───────────────────────────────────────
async function runWithConnection(options, fn) {
    let conn;
    try {
        conn = await connectToDatabase(options);
        await fn(conn.client, conn.config);
    }
    catch (err) {
        handleError(err);
        process.exit(1);
    }
    finally {
        if (conn)
            await closeConnection(conn);
    }
}
