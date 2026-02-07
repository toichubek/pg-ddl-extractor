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
exports.DataExtractor = void 0;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
// ─── Data Extractor ───────────────────────────────────────────
class DataExtractor {
    client;
    constructor(client) {
        this.client = client;
    }
    async extractData(options) {
        const { tables, maxRows = 10000, outputDir } = options;
        const dataDir = path.join(outputDir, "data");
        fs.mkdirSync(dataDir, { recursive: true });
        console.log("\n📊 Extracting table data...\n");
        let totalRows = 0;
        for (const tableName of tables) {
            const [schema, table] = this.parseTableName(tableName);
            // Check table exists
            const exists = await this.tableExists(schema, table);
            if (!exists) {
                console.log(`  ⚠️  ${schema}.${table} — table not found, skipping`);
                continue;
            }
            const rowCount = await this.extractTableData(schema, table, dataDir, maxRows);
            totalRows += rowCount;
            console.log(`  📋 ${schema}.${table} — ${rowCount} rows`);
        }
        console.log(`\n  📊 Total: ${totalRows} rows extracted to ${dataDir}`);
    }
    parseTableName(name) {
        const parts = name.split(".");
        if (parts.length === 2) {
            return [parts[0], parts[1]];
        }
        return ["public", parts[0]];
    }
    async tableExists(schema, table) {
        const { rows } = await this.client.query(`SELECT 1 FROM pg_tables WHERE schemaname = $1 AND tablename = $2`, [schema, table]);
        return rows.length > 0;
    }
    async extractTableData(schema, table, dataDir, maxRows) {
        // Get columns
        const { rows: columns } = await this.client.query(`SELECT column_name, data_type
       FROM information_schema.columns
       WHERE table_schema = $1 AND table_name = $2
       ORDER BY ordinal_position`, [schema, table]);
        if (columns.length === 0)
            return 0;
        const colNames = columns.map((c) => c.column_name);
        // Fetch data
        const { rows } = await this.client.query(`SELECT * FROM ${this.quoteIdent(schema)}.${this.quoteIdent(table)} LIMIT $1`, [maxRows]);
        if (rows.length === 0)
            return 0;
        // Build INSERT statements
        const lines = [];
        const now = new Date().toISOString().replace("T", " ").slice(0, 19);
        lines.push("-- =============================================================");
        lines.push(`-- Data:      ${schema}.${table}`);
        lines.push(`-- Rows:      ${rows.length}`);
        lines.push(`-- Extracted: ${now}`);
        lines.push("-- =============================================================");
        lines.push("");
        lines.push(`-- Disable triggers during data load`);
        lines.push(`ALTER TABLE ${schema}.${table} DISABLE TRIGGER ALL;`);
        lines.push("");
        for (const row of rows) {
            const values = colNames.map((col) => this.formatValue(row[col]));
            lines.push(`INSERT INTO ${schema}.${table} (${colNames.join(", ")}) VALUES (${values.join(", ")});`);
        }
        lines.push("");
        lines.push(`-- Re-enable triggers`);
        lines.push(`ALTER TABLE ${schema}.${table} ENABLE TRIGGER ALL;`);
        lines.push("");
        // Write file
        const filename = `${schema}.${table}.sql`.replace(/[^\w.\-]/g, "_");
        const filepath = path.join(dataDir, filename);
        fs.writeFileSync(filepath, lines.join("\n"), "utf-8");
        return rows.length;
    }
    formatValue(value) {
        if (value === null || value === undefined) {
            return "NULL";
        }
        if (typeof value === "number") {
            return String(value);
        }
        if (typeof value === "boolean") {
            return value ? "TRUE" : "FALSE";
        }
        if (value instanceof Date) {
            return `'${value.toISOString()}'`;
        }
        if (typeof value === "object") {
            // JSON/JSONB
            return `'${JSON.stringify(value).replace(/'/g, "''")}'::jsonb`;
        }
        // String — escape single quotes
        return `'${String(value).replace(/'/g, "''")}'`;
    }
    quoteIdent(name) {
        // Quote identifier if it contains special chars or is a reserved word
        if (/^[a-z_][a-z0-9_]*$/.test(name)) {
            return name;
        }
        return `"${name.replace(/"/g, '""')}"`;
    }
}
exports.DataExtractor = DataExtractor;
