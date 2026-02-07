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
const path = __importStar(require("path"));
const dotenv = __importStar(require("dotenv"));
const commander_1 = require("commander");
const pg_1 = require("pg");
const config_1 = require("./config");
const tunnel_1 = require("./tunnel");
const migration_generator_1 = require("./migration-generator");
const pre_check_1 = require("./pre-check");
const migration_tracker_1 = require("./migration-tracker");
// ─── Load .env ────────────────────────────────────────────────────
dotenv.config();
function parseArgs() {
    commander_1.program
        .name("pg-ddl-migrate")
        .description("Generate migration script from dev to prod schema")
        .version("1.0.0")
        .option("--sql-dir <path>", "Path to SQL directory (default: ../../sql)")
        .option("--dev <path>", "Path to dev schema directory")
        .option("--prod <path>", "Path to prod schema directory")
        .option("--output <path>", "Output directory for migration files")
        .option("--with-rollback", "Generate rollback script alongside migration")
        .option("--dry-run", "Preview migration plan without saving files")
        .option("--interactive", "Review each change interactively before including")
        .option("--pre-check", "Run database health checks before generating migration")
        .option("--history", "Show migration history from the database")
        .option("--track", "Record migration in schema_migrations table after generating")
        .option("--env <environment>", "Environment for pre-check connection", "dev")
        .option("--host <host>", "Database host for pre-check")
        .option("--port <port>", "Database port for pre-check")
        .option("--database <database>", "Database name for pre-check")
        .option("--user <user>", "Database user for pre-check")
        .option("--password <password>", "Database password for pre-check")
        .parse(process.argv);
    return commander_1.program.opts();
}
// ─── Main ─────────────────────────────────────────────────────
async function main() {
    const options = parseArgs();
    // Determine SQL root directory
    const sqlRoot = options.sqlDir
        ? path.resolve(options.sqlDir)
        : process.env.SQL_OUTPUT_DIR
            ? path.resolve(process.env.SQL_OUTPUT_DIR)
            : path.resolve(__dirname, "..", "..", "sql");
    if (!fs.existsSync(sqlRoot)) {
        console.error(`❌ sql/ folder not found at: ${sqlRoot}`);
        console.error("   Run extract:dev and extract:prod first.");
        process.exit(1);
    }
    // Determine dev and prod directories
    const devDir = options.dev ? path.resolve(options.dev) : path.join(sqlRoot, "dev");
    const prodDir = options.prod ? path.resolve(options.prod) : path.join(sqlRoot, "prod");
    if (!fs.existsSync(devDir)) {
        console.error("❌ sql/dev/ not found. Run: npm run extract:dev");
        process.exit(1);
    }
    if (!fs.existsSync(prodDir)) {
        console.error("❌ sql/prod/ not found. Run: npm run extract:prod");
        process.exit(1);
    }
    // Helper to get DB connection config
    function getConnectionConfig() {
        return options.host || options.database || options.user
            ? {
                host: options.host || "localhost",
                port: options.port ? parseInt(options.port, 10) : 5432,
                database: options.database,
                user: options.user,
                password: options.password || "",
                connectionTimeoutMillis: 10000,
                query_timeout: 30000,
            }
            : (0, config_1.getDbConfig)(options.env || "dev");
    }
    try {
        // Show migration history
        if (options.history) {
            const pgConfig = getConnectionConfig();
            const sshConfig = (0, tunnel_1.getSshConfig)(options.env || "dev");
            let tunnel = null;
            let finalConfig = pgConfig;
            if (sshConfig) {
                tunnel = await (0, tunnel_1.createSshTunnel)(sshConfig);
                finalConfig = { ...pgConfig, host: "127.0.0.1", port: tunnel.localPort };
            }
            const client = new pg_1.Client(finalConfig);
            try {
                await client.connect();
                const tracker = new migration_tracker_1.MigrationTracker(client);
                await tracker.printHistory();
            }
            finally {
                await client.end();
                if (tunnel)
                    await tunnel.close();
            }
            return;
        }
        // Run pre-migration checks if requested
        if (options.preCheck) {
            const pgConfig = getConnectionConfig();
            const sshConfig = (0, tunnel_1.getSshConfig)(options.env || "dev");
            let tunnel = null;
            let finalConfig = pgConfig;
            if (sshConfig) {
                tunnel = await (0, tunnel_1.createSshTunnel)(sshConfig);
                finalConfig = { ...pgConfig, host: "127.0.0.1", port: tunnel.localPort };
            }
            const client = new pg_1.Client(finalConfig);
            try {
                await client.connect();
                const checker = new pre_check_1.PreMigrationChecker(client);
                const result = await checker.runChecks();
                (0, pre_check_1.printPreCheckReport)(result);
                if (!result.passed) {
                    console.log("  ⚠️  Pre-checks have warnings. Proceeding with migration generation...\n");
                }
            }
            catch (err) {
                console.error(`  ⚠️  Pre-check connection failed: ${err.message}`);
                console.error("  Continuing with migration generation...\n");
            }
            finally {
                await client.end();
                if (tunnel)
                    await tunnel.close();
            }
        }
        // Generate migration plan
        let migration = (0, migration_generator_1.generateMigration)(sqlRoot);
        if (options.dryRun) {
            // Dry-run: show what would be done without saving
            (0, migration_generator_1.printDryRun)(migration);
            return;
        }
        // Interactive mode: review each change
        if (options.interactive) {
            migration = await (0, migration_generator_1.interactiveReview)(migration);
        }
        // Save migration to file
        const filepath = (0, migration_generator_1.saveMigration)(sqlRoot, migration);
        // Generate and save rollback if requested
        let rollbackPath;
        if (options.withRollback) {
            const rollback = (0, migration_generator_1.generateRollback)(sqlRoot, migration);
            rollbackPath = (0, migration_generator_1.saveRollback)(sqlRoot, rollback);
        }
        // Track migration in database if requested
        if (options.track && migration.commands.length > 0) {
            const pgConfig = getConnectionConfig();
            const sshConfig = (0, tunnel_1.getSshConfig)(options.env || "dev");
            let tunnel = null;
            let finalConfig = pgConfig;
            if (sshConfig) {
                tunnel = await (0, tunnel_1.createSshTunnel)(sshConfig);
                finalConfig = { ...pgConfig, host: "127.0.0.1", port: tunnel.localPort };
            }
            const client = new pg_1.Client(finalConfig);
            try {
                await client.connect();
                const tracker = new migration_tracker_1.MigrationTracker(client);
                const crypto = await Promise.resolve().then(() => __importStar(require("crypto")));
                const migrationContent = fs.readFileSync(filepath, "utf-8");
                const checksum = crypto.createHash("md5").update(migrationContent).digest("hex");
                const migrationName = path.basename(filepath);
                await tracker.recordApplied(migrationName, checksum, 0);
                console.log(`\n  📋 Recorded in schema_migrations: ${migrationName}`);
            }
            catch (err) {
                console.error(`\n  ⚠️  Could not record migration: ${err.message}`);
            }
            finally {
                await client.end();
                if (tunnel)
                    await tunnel.close();
            }
        }
        // Print summary
        (0, migration_generator_1.printMigrationSummary)(migration, filepath, rollbackPath);
    }
    catch (err) {
        console.error(`❌ ${err.message}`);
        process.exit(1);
    }
}
main();
