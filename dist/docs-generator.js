"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DocsGenerator = void 0;
exports.formatDocsMarkdown = formatDocsMarkdown;
exports.formatDocsMermaid = formatDocsMermaid;
const EXCLUDED = `('pg_catalog', 'information_schema', 'pg_toast')`;
// ─── Documentation Generator ──────────────────────────────────
class DocsGenerator {
    client;
    constructor(client) {
        this.client = client;
    }
    async generate() {
        const dbInfo = await this.getDbInfo();
        const schemas = await this.getSchemas();
        const schemaInfos = [];
        for (const schema of schemas) {
            const tables = await this.getTablesInfo(schema);
            const views = await this.getViews(schema);
            const functions = await this.getFunctions(schema);
            schemaInfos.push({ name: schema, tables, views, functions });
        }
        return {
            dbName: dbInfo.name,
            dbVersion: dbInfo.version,
            schemas: schemaInfos,
            generatedAt: new Date().toISOString(),
        };
    }
    async getDbInfo() {
        const { rows: vr } = await this.client.query("SELECT version();");
        const { rows: nr } = await this.client.query("SELECT current_database() AS name;");
        return {
            name: nr[0].name,
            version: vr[0].version.split(",")[0],
        };
    }
    async getSchemas() {
        const { rows } = await this.client.query(`
      SELECT nspname FROM pg_namespace
      WHERE nspname NOT LIKE 'pg_%' AND nspname != 'information_schema'
      ORDER BY nspname
    `);
        return rows.map((r) => r.nspname);
    }
    async getTablesInfo(schema) {
        const { rows: tables } = await this.client.query(`SELECT tablename FROM pg_tables WHERE schemaname = $1 ORDER BY tablename`, [schema]);
        const result = [];
        for (const tbl of tables) {
            const columns = await this.getColumns(schema, tbl.tablename);
            const indexes = await this.getIndexes(schema, tbl.tablename);
            const fks = await this.getForeignKeys(schema, tbl.tablename);
            const comment = await this.getTableComment(schema, tbl.tablename);
            const stats = await this.getTableStats(schema, tbl.tablename);
            result.push({
                name: tbl.tablename,
                comment,
                rowEstimate: stats.rows,
                sizeEstimate: stats.size,
                columns,
                indexes,
                fks,
            });
        }
        return result;
    }
    async getColumns(schema, table) {
        const { rows } = await this.client.query(`SELECT
        c.column_name,
        c.data_type,
        c.udt_name,
        c.character_maximum_length,
        c.is_nullable,
        c.column_default,
        d.description AS comment,
        EXISTS(
          SELECT 1 FROM information_schema.table_constraints tc
          JOIN information_schema.key_column_usage kcu ON kcu.constraint_name = tc.constraint_name
            AND kcu.constraint_schema = tc.constraint_schema
          WHERE tc.table_schema = $1 AND tc.table_name = $2
            AND tc.constraint_type = 'PRIMARY KEY'
            AND kcu.column_name = c.column_name
        ) AS is_pk,
        EXISTS(
          SELECT 1 FROM information_schema.table_constraints tc
          JOIN information_schema.key_column_usage kcu ON kcu.constraint_name = tc.constraint_name
            AND kcu.constraint_schema = tc.constraint_schema
          WHERE tc.table_schema = $1 AND tc.table_name = $2
            AND tc.constraint_type = 'FOREIGN KEY'
            AND kcu.column_name = c.column_name
        ) AS is_fk
      FROM information_schema.columns c
      LEFT JOIN pg_class cls ON cls.relname = c.table_name
      LEFT JOIN pg_namespace ns ON ns.oid = cls.relnamespace AND ns.nspname = c.table_schema
      LEFT JOIN pg_attribute a ON a.attrelid = cls.oid AND a.attname = c.column_name
      LEFT JOIN pg_description d ON d.objoid = cls.oid AND d.objsubid = a.attnum
      WHERE c.table_schema = $1 AND c.table_name = $2
      ORDER BY c.ordinal_position`, [schema, table]);
        return rows.map((r) => {
            let type = r.data_type;
            if (r.data_type === "USER-DEFINED")
                type = r.udt_name;
            if (r.character_maximum_length)
                type += `(${r.character_maximum_length})`;
            return {
                name: r.column_name,
                type,
                nullable: r.is_nullable === "YES",
                defaultValue: r.column_default,
                comment: r.comment,
                isPK: r.is_pk,
                isFK: r.is_fk,
            };
        });
    }
    async getIndexes(schema, table) {
        const { rows } = await this.client.query(`SELECT indexname, indexdef FROM pg_indexes WHERE schemaname = $1 AND tablename = $2 ORDER BY indexname`, [schema, table]);
        return rows.map((r) => r.indexdef);
    }
    async getForeignKeys(schema, table) {
        const { rows } = await this.client.query(`SELECT
        tc.constraint_name,
        string_agg(DISTINCT kcu.column_name, ', ') AS columns,
        ccu.table_schema || '.' || ccu.table_name AS ref_table,
        string_agg(DISTINCT ccu.column_name, ', ') AS ref_columns
      FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu ON kcu.constraint_name = tc.constraint_name
        AND kcu.constraint_schema = tc.constraint_schema
      JOIN information_schema.constraint_column_usage ccu ON ccu.constraint_name = tc.constraint_name
        AND ccu.constraint_schema = tc.constraint_schema
      WHERE tc.table_schema = $1 AND tc.table_name = $2 AND tc.constraint_type = 'FOREIGN KEY'
      GROUP BY tc.constraint_name, ccu.table_schema, ccu.table_name`, [schema, table]);
        return rows.map((r) => `${r.columns} → ${r.ref_table}(${r.ref_columns})`);
    }
    async getTableComment(schema, table) {
        const { rows } = await this.client.query(`SELECT d.description FROM pg_class c
       JOIN pg_namespace n ON n.oid = c.relnamespace
       JOIN pg_description d ON d.objoid = c.oid AND d.objsubid = 0
       WHERE n.nspname = $1 AND c.relname = $2`, [schema, table]);
        return rows.length > 0 ? rows[0].description : null;
    }
    async getTableStats(schema, table) {
        const { rows } = await this.client.query(`SELECT
        COALESCE(c.reltuples::bigint, 0) AS row_estimate,
        pg_size_pretty(pg_total_relation_size(c.oid)) AS total_size
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = $1 AND c.relname = $2`, [schema, table]);
        return rows.length > 0
            ? { rows: rows[0].row_estimate, size: rows[0].total_size }
            : { rows: 0, size: "0 bytes" };
    }
    async getViews(schema) {
        const { rows } = await this.client.query(`SELECT viewname FROM pg_views WHERE schemaname = $1 ORDER BY viewname`, [schema]);
        return rows.map((r) => r.viewname);
    }
    async getFunctions(schema) {
        const { rows } = await this.client.query(`SELECT p.proname || '(' || pg_get_function_arguments(p.oid) || ')' AS func_sig
       FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = $1 ORDER BY p.proname`, [schema]);
        return rows.map((r) => r.func_sig);
    }
}
exports.DocsGenerator = DocsGenerator;
// ─── Markdown Formatter ───────────────────────────────────────
function formatDocsMarkdown(doc) {
    const lines = [];
    lines.push(`# Database Documentation: ${doc.dbName}`);
    lines.push("");
    lines.push(`> ${doc.dbVersion}`);
    lines.push(`> Generated: ${doc.generatedAt.slice(0, 19)}`);
    lines.push("");
    // Table of contents
    lines.push("## Table of Contents");
    lines.push("");
    for (const schema of doc.schemas) {
        lines.push(`- [Schema: ${schema.name}](#schema-${schema.name})`);
        for (const table of schema.tables) {
            lines.push(`  - [${table.name}](#${schema.name}${table.name})`);
        }
    }
    lines.push("");
    // Schema details
    for (const schema of doc.schemas) {
        lines.push(`## Schema: ${schema.name}`);
        lines.push("");
        lines.push(`Tables: ${schema.tables.length} | Views: ${schema.views.length} | Functions: ${schema.functions.length}`);
        lines.push("");
        for (const table of schema.tables) {
            lines.push(`### ${schema.name}.${table.name}`);
            lines.push("");
            if (table.comment) {
                lines.push(`> ${table.comment}`);
                lines.push("");
            }
            lines.push(`Rows: ~${table.rowEstimate.toLocaleString()} | Size: ${table.sizeEstimate}`);
            lines.push("");
            // Columns table
            lines.push("| Column | Type | Nullable | Default | Key | Comment |");
            lines.push("|--------|------|----------|---------|-----|---------|");
            for (const col of table.columns) {
                const key = col.isPK ? "PK" : col.isFK ? "FK" : "";
                const nullable = col.nullable ? "YES" : "NO";
                const def = col.defaultValue ? `\`${col.defaultValue}\`` : "";
                const comment = col.comment || "";
                lines.push(`| ${col.name} | ${col.type} | ${nullable} | ${def} | ${key} | ${comment} |`);
            }
            lines.push("");
            if (table.fks.length > 0) {
                lines.push("**Foreign Keys:**");
                for (const fk of table.fks) {
                    lines.push(`- ${fk}`);
                }
                lines.push("");
            }
            if (table.indexes.length > 0) {
                lines.push("<details><summary>Indexes</summary>");
                lines.push("");
                for (const idx of table.indexes) {
                    lines.push(`- \`${idx}\``);
                }
                lines.push("</details>");
                lines.push("");
            }
        }
        if (schema.views.length > 0) {
            lines.push("### Views");
            lines.push("");
            for (const view of schema.views) {
                lines.push(`- ${schema.name}.${view}`);
            }
            lines.push("");
        }
        if (schema.functions.length > 0) {
            lines.push("### Functions");
            lines.push("");
            for (const func of schema.functions) {
                lines.push(`- \`${schema.name}.${func}\``);
            }
            lines.push("");
        }
    }
    return lines.join("\n");
}
// ─── Mermaid ERD Formatter ────────────────────────────────────
function formatDocsMermaid(doc) {
    const lines = [];
    lines.push("```mermaid");
    lines.push("erDiagram");
    for (const schema of doc.schemas) {
        for (const table of schema.tables) {
            const tableName = table.name.replace(/[^a-zA-Z0-9_]/g, "_");
            // Table definition
            lines.push(`    ${tableName} {`);
            for (const col of table.columns) {
                const type = col.type.replace(/\s+/g, "_").replace(/[()]/g, "");
                const attrs = [];
                if (col.isPK)
                    attrs.push("PK");
                if (col.isFK)
                    attrs.push("FK");
                const attrStr = attrs.length > 0 ? ` "${attrs.join(",")}"` : "";
                lines.push(`        ${type} ${col.name}${attrStr}`);
            }
            lines.push("    }");
            // Relationships from FKs
            for (const fk of table.fks) {
                const match = fk.match(/^(.+)\s*→\s*\w+\.(\w+)\((.+)\)$/);
                if (match) {
                    const refTable = match[2].replace(/[^a-zA-Z0-9_]/g, "_");
                    lines.push(`    ${tableName} ||--o{ ${refTable} : "FK"`);
                }
            }
        }
    }
    lines.push("```");
    return lines.join("\n");
}
