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
exports.JsonExporter = void 0;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const EXCLUDED_SCHEMAS = `('pg_catalog', 'information_schema', 'pg_toast')`;
class JsonExporter {
    client;
    filters;
    constructor(client, filters = {}) {
        this.client = client;
        this.filters = filters;
    }
    async export() {
        console.log("\n📦 Extracting database structure as JSON...\n");
        const { rows: vr } = await this.client.query("SELECT version(), current_database();");
        const result = {
            metadata: {
                exportedAt: new Date().toISOString(),
                database: vr[0].current_database,
                version: vr[0].version.split(",")[0],
            },
            schemas: await this.extractSchemas(),
            types: await this.extractTypes(),
            sequences: await this.extractSequences(),
            tables: await this.extractTables(),
            views: await this.extractViews(),
            materializedViews: await this.extractMaterializedViews(),
            functions: await this.extractFunctions(),
            triggers: await this.extractTriggers(),
            indexes: await this.extractIndexes(),
        };
        const total = result.schemas.length +
            result.types.length +
            result.sequences.length +
            result.tables.length +
            result.views.length +
            result.materializedViews.length +
            result.functions.length +
            result.triggers.length +
            result.indexes.length;
        console.log(`  🗂️  schemas                ${result.schemas.length}`);
        console.log(`  🏷️  types                  ${result.types.length}`);
        console.log(`  🔢  sequences              ${result.sequences.length}`);
        console.log(`  📋  tables                 ${result.tables.length}`);
        console.log(`  👁️  views                  ${result.views.length}`);
        console.log(`  👁️  materialized_views     ${result.materializedViews.length}`);
        console.log(`  ⚙️  functions              ${result.functions.length}`);
        console.log(`  ⚡  triggers               ${result.triggers.length}`);
        console.log(`  🔍  indexes                ${result.indexes.length}`);
        console.log(`\n  Total: ${total} objects`);
        return result;
    }
    async exportToFile(outputDir) {
        const data = await this.export();
        fs.mkdirSync(outputDir, { recursive: true });
        const filepath = path.join(outputDir, "schema.json");
        const newContent = JSON.stringify(data, null, 2);
        // Only write if content changed (ignoring exportedAt timestamp)
        if (fs.existsSync(filepath)) {
            const existing = fs.readFileSync(filepath, "utf-8");
            const stripTimestamp = (s) => s.replace(/"exportedAt":\s*"[^"]*"/, '"exportedAt": ""');
            if (stripTimestamp(existing) === stripTimestamp(newContent)) {
                return filepath;
            }
        }
        fs.writeFileSync(filepath, newContent, "utf-8");
        return filepath;
    }
    shouldIncludeSchema(schemaName) {
        if (this.filters.includeSchemas && this.filters.includeSchemas.length > 0) {
            return this.filters.includeSchemas.includes(schemaName);
        }
        if (this.filters.excludeSchemas && this.filters.excludeSchemas.length > 0) {
            return !this.filters.excludeSchemas.includes(schemaName);
        }
        return true;
    }
    shouldIncludeTable(schemaName, tableName) {
        const fullName = `${schemaName}.${tableName}`;
        if (this.filters.includeTables && this.filters.includeTables.length > 0) {
            return this.filters.includeTables.includes(fullName);
        }
        if (this.filters.excludeTables && this.filters.excludeTables.length > 0) {
            return !this.filters.excludeTables.includes(fullName);
        }
        return this.shouldIncludeSchema(schemaName);
    }
    async extractSchemas() {
        const { rows } = await this.client.query(`
      SELECT nspname AS schema_name
      FROM pg_namespace
      WHERE nspname NOT LIKE 'pg_%' AND nspname != 'information_schema'
      ORDER BY nspname;
    `);
        return rows
            .filter((r) => this.shouldIncludeSchema(r.schema_name))
            .map((r) => r.schema_name);
    }
    async extractTypes() {
        const result = [];
        const { rows: enums } = await this.client.query(`
      SELECT
        n.nspname AS schema_name,
        t.typname AS type_name,
        string_agg(e.enumlabel, '||' ORDER BY e.enumsortorder) AS labels
      FROM pg_type t
      JOIN pg_namespace n ON n.oid = t.typnamespace
      JOIN pg_enum e ON e.enumtypid = t.oid
      WHERE n.nspname NOT IN ${EXCLUDED_SCHEMAS}
      GROUP BY n.nspname, t.typname
      ORDER BY n.nspname, t.typname;
    `);
        for (const row of enums) {
            if (!this.shouldIncludeSchema(row.schema_name))
                continue;
            result.push({
                schema: row.schema_name,
                name: row.type_name,
                type: "enum",
                labels: row.labels.split("||"),
            });
        }
        const { rows: composites } = await this.client.query(`
      SELECT
        n.nspname AS schema_name,
        t.typname AS type_name,
        string_agg(
          a.attname || ' ' || pg_catalog.format_type(a.atttypid, a.atttypmod),
          ', ' ORDER BY a.attnum
        ) AS attributes
      FROM pg_type t
      JOIN pg_namespace n ON n.oid = t.typnamespace
      JOIN pg_class c ON c.oid = t.typrelid
      JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
      WHERE n.nspname NOT IN ${EXCLUDED_SCHEMAS}
        AND t.typtype = 'c' AND c.relkind = 'c'
      GROUP BY n.nspname, t.typname
      ORDER BY n.nspname, t.typname;
    `);
        for (const row of composites) {
            if (!this.shouldIncludeSchema(row.schema_name))
                continue;
            result.push({
                schema: row.schema_name,
                name: row.type_name,
                type: "composite",
                attributes: row.attributes,
            });
        }
        return result;
    }
    async extractSequences() {
        const { rows } = await this.client.query(`
      SELECT
        sequence_schema AS schema_name,
        sequence_name,
        start_value, minimum_value, maximum_value,
        increment, cycle_option
      FROM information_schema.sequences
      WHERE sequence_schema NOT IN ${EXCLUDED_SCHEMAS}
      ORDER BY sequence_schema, sequence_name;
    `);
        return rows
            .filter((r) => this.shouldIncludeSchema(r.schema_name))
            .map((r) => ({
            schema: r.schema_name,
            name: r.sequence_name,
            startValue: r.start_value,
            minValue: r.minimum_value,
            maxValue: r.maximum_value,
            increment: r.increment,
            cycle: r.cycle_option === "YES",
        }));
    }
    async extractTables() {
        const { rows: tables } = await this.client.query(`
      SELECT schemaname, tablename
      FROM pg_tables
      WHERE schemaname NOT IN ${EXCLUDED_SCHEMAS}
      ORDER BY schemaname, tablename;
    `);
        const result = [];
        for (const tbl of tables) {
            if (!this.shouldIncludeTable(tbl.schemaname, tbl.tablename))
                continue;
            result.push(await this.buildTableJson(tbl.schemaname, tbl.tablename));
        }
        return result;
    }
    async buildTableJson(schema, table) {
        // Columns
        const { rows: columns } = await this.client.query(`
      SELECT
        c.column_name, c.data_type, c.udt_name,
        c.character_maximum_length, c.numeric_precision, c.numeric_scale,
        c.is_nullable, c.column_default
      FROM information_schema.columns c
      WHERE c.table_schema = $1 AND c.table_name = $2
      ORDER BY c.ordinal_position;
    `, [schema, table]);
        // Column comments
        const { rows: comments } = await this.client.query(`
      SELECT a.attname AS column_name, d.description
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
      JOIN pg_description d ON d.objoid = c.oid AND d.objsubid = a.attnum
      WHERE n.nspname = $1 AND c.relname = $2;
    `, [schema, table]);
        const commentMap = new Map(comments.map((c) => [c.column_name, c.description]));
        const colDefs = columns.map((col) => ({
            name: col.column_name,
            type: this.buildColumnType(col),
            nullable: col.is_nullable === "YES",
            default: col.column_default,
            comment: commentMap.get(col.column_name) || null,
        }));
        // Constraints
        const constraints = [];
        // Primary keys
        const { rows: pks } = await this.client.query(`
      SELECT tc.constraint_name,
        string_agg(kcu.column_name, ', ' ORDER BY kcu.ordinal_position) AS columns
      FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu
        ON kcu.constraint_name = tc.constraint_name AND kcu.constraint_schema = tc.constraint_schema
      WHERE tc.table_schema = $1 AND tc.table_name = $2 AND tc.constraint_type = 'PRIMARY KEY'
      GROUP BY tc.constraint_name;
    `, [schema, table]);
        for (const pk of pks) {
            constraints.push({ name: pk.constraint_name, type: "PRIMARY KEY", columns: pk.columns });
        }
        // Unique constraints
        const { rows: uqs } = await this.client.query(`
      SELECT tc.constraint_name,
        string_agg(kcu.column_name, ', ' ORDER BY kcu.ordinal_position) AS columns
      FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu
        ON kcu.constraint_name = tc.constraint_name AND kcu.constraint_schema = tc.constraint_schema
      WHERE tc.table_schema = $1 AND tc.table_name = $2 AND tc.constraint_type = 'UNIQUE'
      GROUP BY tc.constraint_name;
    `, [schema, table]);
        for (const uq of uqs) {
            constraints.push({ name: uq.constraint_name, type: "UNIQUE", columns: uq.columns });
        }
        // Foreign keys
        const { rows: fks } = await this.client.query(`
      SELECT
        tc.constraint_name,
        string_agg(DISTINCT kcu.column_name, ', ' ORDER BY kcu.column_name) AS columns,
        ccu.table_schema AS ref_schema, ccu.table_name AS ref_table,
        string_agg(DISTINCT ccu.column_name, ', ' ORDER BY ccu.column_name) AS ref_columns,
        rc.update_rule, rc.delete_rule
      FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu
        ON kcu.constraint_name = tc.constraint_name AND kcu.constraint_schema = tc.constraint_schema
      JOIN information_schema.constraint_column_usage ccu
        ON ccu.constraint_name = tc.constraint_name AND ccu.constraint_schema = tc.constraint_schema
      JOIN information_schema.referential_constraints rc
        ON rc.constraint_name = tc.constraint_name AND rc.constraint_schema = tc.constraint_schema
      WHERE tc.table_schema = $1 AND tc.table_name = $2 AND tc.constraint_type = 'FOREIGN KEY'
      GROUP BY tc.constraint_name, ccu.table_schema, ccu.table_name, rc.update_rule, rc.delete_rule;
    `, [schema, table]);
        for (const fk of fks) {
            constraints.push({
                name: fk.constraint_name,
                type: "FOREIGN KEY",
                columns: fk.columns,
                refTable: `${fk.ref_schema}.${fk.ref_table}`,
                refColumns: fk.ref_columns,
                updateRule: fk.update_rule,
                deleteRule: fk.delete_rule,
            });
        }
        // Check constraints
        const { rows: checks } = await this.client.query(`
      SELECT cc.constraint_name, cc.check_clause
      FROM information_schema.check_constraints cc
      JOIN information_schema.table_constraints tc
        ON tc.constraint_name = cc.constraint_name AND tc.constraint_schema = cc.constraint_schema
      WHERE tc.table_schema = $1 AND tc.table_name = $2
        AND tc.constraint_type = 'CHECK' AND cc.constraint_name NOT LIKE '%_not_null';
    `, [schema, table]);
        for (const chk of checks) {
            constraints.push({
                name: chk.constraint_name,
                type: "CHECK",
                columns: "",
                checkClause: chk.check_clause,
            });
        }
        // Table comment
        const { rows: tblComments } = await this.client.query(`
      SELECT d.description
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      JOIN pg_description d ON d.objoid = c.oid AND d.objsubid = 0
      WHERE n.nspname = $1 AND c.relname = $2;
    `, [schema, table]);
        // Table stats
        const { rows: stats } = await this.client.query(`
      SELECT n_live_tup AS row_estimate,
        pg_size_pretty(pg_total_relation_size(relid)) AS total_size
      FROM pg_stat_user_tables
      WHERE schemaname = $1 AND relname = $2;
    `, [schema, table]);
        return {
            schema,
            name: table,
            columns: colDefs,
            constraints,
            comment: tblComments.length > 0 ? tblComments[0].description : null,
            rowEstimate: stats.length > 0 ? parseInt(stats[0].row_estimate, 10) : undefined,
            size: stats.length > 0 ? stats[0].total_size : undefined,
        };
    }
    buildColumnType(col) {
        const { data_type, udt_name, character_maximum_length, numeric_precision, numeric_scale } = col;
        if (data_type === "ARRAY")
            return `${udt_name.replace(/^_/, "")}[]`;
        if (data_type === "USER-DEFINED")
            return udt_name;
        if (["character varying", "varchar"].includes(data_type)) {
            return character_maximum_length ? `varchar(${character_maximum_length})` : "varchar";
        }
        if (["character", "char"].includes(data_type)) {
            return character_maximum_length ? `char(${character_maximum_length})` : "char";
        }
        if (data_type === "numeric" && numeric_precision) {
            return `numeric(${numeric_precision},${numeric_scale || 0})`;
        }
        return data_type;
    }
    async extractViews() {
        const { rows } = await this.client.query(`
      SELECT schemaname AS schema_name, viewname AS view_name, definition
      FROM pg_views
      WHERE schemaname NOT IN ${EXCLUDED_SCHEMAS}
      ORDER BY schemaname, viewname;
    `);
        return rows
            .filter((r) => this.shouldIncludeSchema(r.schema_name))
            .map((r) => ({
            schema: r.schema_name,
            name: r.view_name,
            definition: r.definition.trim(),
        }));
    }
    async extractMaterializedViews() {
        const { rows } = await this.client.query(`
      SELECT schemaname AS schema_name, matviewname AS view_name, definition
      FROM pg_matviews
      WHERE schemaname NOT IN ${EXCLUDED_SCHEMAS}
      ORDER BY schemaname, matviewname;
    `);
        return rows
            .filter((r) => this.shouldIncludeSchema(r.schema_name))
            .map((r) => ({
            schema: r.schema_name,
            name: r.view_name,
            definition: r.definition.trim(),
        }));
    }
    async extractFunctions() {
        const { rows } = await this.client.query(`
      SELECT
        n.nspname AS schema_name,
        p.proname AS function_name,
        pg_get_functiondef(p.oid) AS definition
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname NOT IN ${EXCLUDED_SCHEMAS}
      ORDER BY n.nspname, p.proname;
    `);
        return rows
            .filter((r) => this.shouldIncludeSchema(r.schema_name))
            .map((r) => ({
            schema: r.schema_name,
            name: r.function_name,
            definition: r.definition,
        }));
    }
    async extractTriggers() {
        const { rows } = await this.client.query(`
      SELECT
        trigger_schema AS schema_name, trigger_name,
        event_object_schema, event_object_table,
        action_statement, action_timing, event_manipulation, action_orientation
      FROM information_schema.triggers
      WHERE trigger_schema NOT IN ${EXCLUDED_SCHEMAS}
      ORDER BY trigger_schema, trigger_name;
    `);
        const grouped = new Map();
        for (const row of rows) {
            if (!this.shouldIncludeSchema(row.schema_name))
                continue;
            const key = `${row.schema_name}.${row.trigger_name}`;
            if (!grouped.has(key))
                grouped.set(key, []);
            grouped.get(key).push(row);
        }
        const result = [];
        for (const [, events] of grouped) {
            const first = events[0];
            result.push({
                schema: first.schema_name,
                name: first.trigger_name,
                table: `${first.event_object_schema}.${first.event_object_table}`,
                timing: first.action_timing,
                events: events.map((e) => e.event_manipulation),
                orientation: first.action_orientation,
                action: first.action_statement,
            });
        }
        return result;
    }
    async extractIndexes() {
        const { rows } = await this.client.query(`
      SELECT
        schemaname AS schema_name, indexname AS index_name, indexdef AS definition
      FROM pg_indexes
      WHERE schemaname NOT IN ${EXCLUDED_SCHEMAS}
        AND indexname NOT IN (
          SELECT constraint_name FROM information_schema.table_constraints
          WHERE constraint_type IN ('PRIMARY KEY', 'UNIQUE')
        )
      ORDER BY schemaname, indexname;
    `);
        return rows
            .filter((r) => this.shouldIncludeSchema(r.schema_name))
            .map((r) => ({
            schema: r.schema_name,
            name: r.index_name,
            definition: r.definition,
        }));
    }
}
exports.JsonExporter = JsonExporter;
