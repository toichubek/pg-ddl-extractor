import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";
import { Client } from "pg";

// ─── Types ────────────────────────────────────────────────────

export interface DataExtractionOptions {
  tables: string[];
  maxRows?: number;
  outputDir: string;
}

// ─── Data Extractor ───────────────────────────────────────────

export class DataExtractor {
  private client: Client;

  constructor(client: Client) {
    this.client = client;
  }

  async extractData(options: DataExtractionOptions): Promise<void> {
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

  private parseTableName(name: string): [string, string] {
    const parts = name.split(".");
    if (parts.length === 2) {
      return [parts[0], parts[1]];
    }
    return ["public", parts[0]];
  }

  private async tableExists(schema: string, table: string): Promise<boolean> {
    const { rows } = await this.client.query(
      `SELECT 1 FROM pg_tables WHERE schemaname = $1 AND tablename = $2`,
      [schema, table]
    );
    return rows.length > 0;
  }

  private async extractTableData(
    schema: string,
    table: string,
    dataDir: string,
    maxRows: number
  ): Promise<number> {
    // Get columns
    const { rows: columns } = await this.client.query(
      `SELECT column_name, data_type
       FROM information_schema.columns
       WHERE table_schema = $1 AND table_name = $2
       ORDER BY ordinal_position`,
      [schema, table]
    );

    if (columns.length === 0) return 0;

    const colNames = columns.map((c: { column_name: string }) => c.column_name);

    // Fetch data
    const { rows } = await this.client.query(
      `SELECT * FROM ${this.quoteIdent(schema)}.${this.quoteIdent(table)} LIMIT $1`,
      [maxRows]
    );

    if (rows.length === 0) return 0;

    // Build INSERT statements
    const lines: string[] = [];
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
      const values = colNames.map((col: string) => this.formatValue(row[col]));
      lines.push(
        `INSERT INTO ${schema}.${table} (${colNames.join(", ")}) VALUES (${values.join(", ")});`
      );
    }

    lines.push("");
    lines.push(`-- Re-enable triggers`);
    lines.push(`ALTER TABLE ${schema}.${table} ENABLE TRIGGER ALL;`);
    lines.push("");

    // Write file (only if content changed, ignoring timestamp)
    const filename = `${schema}.${table}.sql`.replace(/[^\w.\-]/g, "_");
    const filepath = path.join(dataDir, filename);
    const newContent = lines.join("\n");

    if (fs.existsSync(filepath)) {
      const existing = fs.readFileSync(filepath, "utf-8");
      const hashOf = (s: string) =>
        crypto
          .createHash("md5")
          .update(
            s
              .split("\n")
              .filter((l) => !l.startsWith("-- Extracted:"))
              .map((l) => l.trimEnd())
              .filter((l) => l.trim() !== "")
              .join("\n")
          )
          .digest("hex");
      if (hashOf(existing) === hashOf(newContent)) {
        return rows.length;
      }
    }

    fs.writeFileSync(filepath, newContent, "utf-8");

    return rows.length;
  }

  private formatValue(value: any): string {
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

  private quoteIdent(name: string): string {
    // Quote identifier if it contains special chars or is a reserved word
    if (/^[a-z_][a-z0-9_]*$/.test(name)) {
      return name;
    }
    return `"${name.replace(/"/g, '""')}"`;
  }
}
