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
const commander_1 = require("commander");
const pkg = require("../package.json");
const cli_utils_1 = require("./cli-utils");
/**
 * Validate that extracted SQL files match the live database.
 */
async function validateAgainstDb(client, sqlDir) {
    const results = [];
    // Get live table list
    const { rows: liveTables } = await client.query(`
    SELECT schemaname || '.' || tablename AS full_name
    FROM pg_tables
    WHERE schemaname NOT IN ('pg_catalog', 'information_schema', 'pg_toast')
    ORDER BY schemaname, tablename;
  `);
    const liveTableSet = new Set(liveTables.map((t) => t.full_name));
    // Check extracted tables dir
    const tablesDir = path.join(sqlDir, "tables");
    if (fs.existsSync(tablesDir)) {
        const extractedTables = fs
            .readdirSync(tablesDir)
            .filter((f) => f.endsWith(".sql"))
            .map((f) => f.replace(".sql", ""));
        for (const t of extractedTables) {
            if (!liveTableSet.has(t)) {
                results.push({
                    rule: "stale-file",
                    severity: "warning",
                    object: t,
                    message: `Table ${t} exists in extracted files but not in database`,
                });
            }
        }
        const extractedSet = new Set(extractedTables);
        for (const t of liveTableSet) {
            if (!extractedSet.has(t)) {
                results.push({
                    rule: "missing-extract",
                    severity: "warning",
                    object: t,
                    message: `Table ${t} exists in database but not in extracted files`,
                });
            }
        }
    }
    // Get live function list
    const { rows: liveFuncs } = await client.query(`
    SELECT n.nspname || '.' || p.proname AS full_name
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname NOT IN ('pg_catalog', 'information_schema', 'pg_toast');
  `);
    const liveFuncSet = new Set(liveFuncs.map((f) => f.full_name));
    const funcsDir = path.join(sqlDir, "functions");
    if (fs.existsSync(funcsDir)) {
        const extractedFuncs = fs
            .readdirSync(funcsDir)
            .filter((f) => f.endsWith(".sql"))
            .map((f) => f.replace(".sql", ""));
        for (const f of extractedFuncs) {
            if (!liveFuncSet.has(f)) {
                results.push({
                    rule: "stale-file",
                    severity: "warning",
                    object: f,
                    message: `Function ${f} exists in extracted files but not in database`,
                });
            }
        }
    }
    return results;
}
/**
 * Validate schema conventions and best practices.
 */
async function validateConventions(client) {
    const results = [];
    // Check for tables without primary keys
    const { rows: noPk } = await client.query(`
    SELECT t.schemaname || '.' || t.tablename AS full_name
    FROM pg_tables t
    LEFT JOIN information_schema.table_constraints tc
      ON tc.table_schema = t.schemaname AND tc.table_name = t.tablename AND tc.constraint_type = 'PRIMARY KEY'
    WHERE t.schemaname NOT IN ('pg_catalog', 'information_schema', 'pg_toast')
      AND tc.constraint_name IS NULL;
  `);
    for (const r of noPk) {
        results.push({
            rule: "no-primary-key",
            severity: "error",
            object: r.full_name,
            message: `Table ${r.full_name} has no PRIMARY KEY`,
        });
    }
    // Check for wide tables (>20 columns)
    const { rows: wideTables } = await client.query(`
    SELECT table_schema || '.' || table_name AS full_name, count(*) AS col_count
    FROM information_schema.columns
    WHERE table_schema NOT IN ('pg_catalog', 'information_schema', 'pg_toast')
    GROUP BY table_schema, table_name
    HAVING count(*) > 20;
  `);
    for (const r of wideTables) {
        results.push({
            rule: "wide-table",
            severity: "warning",
            object: r.full_name,
            message: `Table ${r.full_name} has ${r.col_count} columns (consider normalization)`,
        });
    }
    // Check for columns named "data" or "info" with type text/json (vague naming)
    const { rows: vagueColumns } = await client.query(`
    SELECT table_schema || '.' || table_name AS full_name, column_name, data_type
    FROM information_schema.columns
    WHERE table_schema NOT IN ('pg_catalog', 'information_schema', 'pg_toast')
      AND column_name IN ('data', 'info', 'value', 'blob', 'content')
      AND data_type IN ('text', 'json', 'jsonb', 'bytea');
  `);
    for (const r of vagueColumns) {
        results.push({
            rule: "vague-column-name",
            severity: "info",
            object: `${r.full_name}.${r.column_name}`,
            message: `Column "${r.column_name}" (${r.data_type}) has a vague name — consider being more specific`,
        });
    }
    // Check for tables with no indexes at all
    const { rows: noIdx } = await client.query(`
    SELECT t.schemaname || '.' || t.tablename AS full_name
    FROM pg_tables t
    LEFT JOIN pg_indexes i ON i.schemaname = t.schemaname AND i.tablename = t.tablename
    WHERE t.schemaname NOT IN ('pg_catalog', 'information_schema', 'pg_toast')
    GROUP BY t.schemaname, t.tablename
    HAVING count(i.indexname) = 0;
  `);
    for (const r of noIdx) {
        results.push({
            rule: "no-indexes",
            severity: "warning",
            object: r.full_name,
            message: `Table ${r.full_name} has no indexes at all`,
        });
    }
    // Check for nullable FK columns
    const { rows: nullableFks } = await client.query(`
    SELECT
      kcu.table_schema || '.' || kcu.table_name AS full_name,
      kcu.column_name,
      c.is_nullable
    FROM information_schema.key_column_usage kcu
    JOIN information_schema.table_constraints tc
      ON tc.constraint_name = kcu.constraint_name AND tc.constraint_schema = kcu.constraint_schema
    JOIN information_schema.columns c
      ON c.table_schema = kcu.table_schema AND c.table_name = kcu.table_name AND c.column_name = kcu.column_name
    WHERE tc.constraint_type = 'FOREIGN KEY'
      AND c.is_nullable = 'YES'
      AND kcu.table_schema NOT IN ('pg_catalog', 'information_schema', 'pg_toast');
  `);
    for (const r of nullableFks) {
        results.push({
            rule: "nullable-fk",
            severity: "info",
            object: `${r.full_name}.${r.column_name}`,
            message: `FK column ${r.column_name} is nullable — consider if this is intentional`,
        });
    }
    return results;
}
function printValidationReport(results, strict) {
    console.log("═══════════════════════════════════════════════════════════");
    console.log("  Schema Validation Report");
    console.log("═══════════════════════════════════════════════════════════");
    console.log("");
    const errors = results.filter((r) => r.severity === "error");
    const warnings = results.filter((r) => r.severity === "warning");
    const infos = results.filter((r) => r.severity === "info");
    console.log(`  ❌ Errors:   ${errors.length}`);
    console.log(`  ⚠️  Warnings: ${warnings.length}`);
    console.log(`  ℹ️  Info:     ${infos.length}`);
    console.log("");
    if (results.length === 0) {
        console.log("  🎉 All validation checks passed!\n");
        console.log("═══════════════════════════════════════════════════════════");
        return;
    }
    // Group by rule
    const byRule = new Map();
    for (const r of results) {
        if (!byRule.has(r.rule))
            byRule.set(r.rule, []);
        byRule.get(r.rule).push(r);
    }
    for (const [rule, items] of byRule) {
        const icon = items[0].severity === "error" ? "❌" : items[0].severity === "warning" ? "⚠️" : "ℹ️";
        console.log(`  ${icon} ${rule} (${items.length})`);
        for (const item of items.slice(0, 10)) {
            console.log(`     ${item.message}`);
        }
        if (items.length > 10) {
            console.log(`     ... and ${items.length - 10} more`);
        }
        console.log("");
    }
    console.log("═══════════════════════════════════════════════════════════");
    // Exit code
    if (errors.length > 0) {
        process.exit(1);
    }
    if (strict && warnings.length > 0) {
        process.exit(1);
    }
}
function parseArgs() {
    commander_1.program
        .name("pg-ddl-validate")
        .description("Validate schema consistency and conventions")
        .version(pkg.version)
        .option("--env <environment>", "Environment name (e.g. dev, stage, prod)", "dev")
        .option("--host <host>", "Database host")
        .option("--port <port>", "Database port")
        .option("--database <database>", "Database name")
        .option("--user <user>", "Database user")
        .option("--password <password>", "Database password")
        .option("--sql-dir <path>", "Path to SQL directory for file validation")
        .option("--strict", "Treat warnings as errors (exit code 1)")
        .parse(process.argv);
    return commander_1.program.opts();
}
async function main() {
    const options = parseArgs();
    const env = options.env || "dev";
    await (0, cli_utils_1.runWithConnection)(options, async (client) => {
        let results = [];
        // Convention checks (always run)
        results = results.concat(await validateConventions(client));
        // File validation (if sql-dir is provided)
        if (options.sqlDir) {
            const sqlDir = path.join(path.resolve(options.sqlDir), env);
            if (fs.existsSync(sqlDir)) {
                results = results.concat(await validateAgainstDb(client, sqlDir));
            }
        }
        else {
            const defaultDir = process.env.SQL_OUTPUT_DIR
                ? path.resolve(process.env.SQL_OUTPUT_DIR, env)
                : path.resolve(__dirname, "..", "..", "sql", env);
            if (fs.existsSync(defaultDir)) {
                results = results.concat(await validateAgainstDb(client, defaultDir));
            }
        }
        printValidationReport(results, !!options.strict);
    });
}
main();
