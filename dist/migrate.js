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
const migration_generator_1 = require("./migration-generator");
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
        .parse(process.argv);
    return commander_1.program.opts();
}
// ─── Main ─────────────────────────────────────────────────────
function main() {
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
    try {
        // Generate migration plan
        const migration = (0, migration_generator_1.generateMigration)(sqlRoot);
        if (options.dryRun) {
            // Dry-run: show what would be done without saving
            (0, migration_generator_1.printDryRun)(migration);
            return;
        }
        // Save migration to file
        const filepath = (0, migration_generator_1.saveMigration)(sqlRoot, migration);
        // Generate and save rollback if requested
        let rollbackPath;
        if (options.withRollback) {
            const rollback = (0, migration_generator_1.generateRollback)(sqlRoot, migration);
            rollbackPath = (0, migration_generator_1.saveRollback)(sqlRoot, rollback);
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
