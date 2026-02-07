import { Client } from "pg";
import { SqlFileWriter, ObjectCategory } from "./writer";
import { ProgressBar } from "./progress";

const EXCLUDED_SCHEMAS = `('pg_catalog', 'information_schema', 'pg_toast')`;

interface DdlObject {
  category: ObjectCategory;
  name: string;
  ddl: string;
}

export interface ExtractionFilters {
  includeSchemas?: string[];
  includeTables?: string[];
  excludeSchemas?: string[];
  excludeTables?: string[];
}

export class DdlExtractor {
  private client: Client;
  private writer: SqlFileWriter;
  private allDdl: string[] = [];
  private filters: ExtractionFilters;
  private showProgress: boolean;

  constructor(client: Client, writer: SqlFileWriter, filters: ExtractionFilters = {}, showProgress: boolean = false) {
    this.client = client;
    this.writer = writer;
    this.filters = filters;
    this.showProgress = showProgress;
  }

  /** Run full extraction */
  async extractAll(): Promise<void> {
    console.log("\n📦 Extracting database structure...\n");

    const steps = [
      { name: "schemas", fn: () => this.extractSchemas() },
      { name: "types", fn: () => this.extractTypes() },
      { name: "sequences", fn: () => this.extractSequences() },
      { name: "tables", fn: () => this.extractTables() },
      { name: "views", fn: () => this.extractViews() },
      { name: "materialized_views", fn: () => this.extractMaterializedViews() },
      { name: "functions", fn: () => this.extractFunctions() },
      { name: "triggers", fn: () => this.extractTriggers() },
      { name: "indexes", fn: () => this.extractIndexes() },
    ];

    if (this.showProgress) {
      const bar = new ProgressBar(steps.length, "Extracting...");
      for (const step of steps) {
        await step.fn();
        bar.tick(step.name);
      }
      bar.complete("Extraction complete");
    } else {
      for (const step of steps) {
        await step.fn();
      }
    }

    // Write combined dump
    this.writer.writeFull(this.allDdl.join("\n\n"));
  }

  // ─── SCHEMAS ────────────────────────────────────────────────────

  private async extractSchemas(): Promise<void> {
    const { rows } = await this.client.query(`
      SELECT nspname AS schema_name
      FROM pg_namespace
      WHERE nspname NOT LIKE 'pg_%'
        AND nspname != 'information_schema'
      ORDER BY nspname;
    `);

    let count = 0;
    for (const row of rows) {
      if (!this.shouldIncludeSchema(row.schema_name)) {
        continue;
      }
      const ddl = `CREATE SCHEMA IF NOT EXISTS ${row.schema_name};`;
      this.save("schemas", row.schema_name, ddl);
      count++;
    }
    this.log("schemas", count);
  }

  // ─── CUSTOM TYPES (enum + composite) ────────────────────────────

  private async extractTypes(): Promise<void> {
    // Enum types
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

    let count = 0;
    for (const row of enums) {
      if (!this.shouldIncludeSchema(row.schema_name)) {
        continue;
      }
      const labels = row.labels
        .split("||")
        .map((l: string) => `    '${l}'`)
        .join(",\n");
      const ddl = `CREATE TYPE ${row.schema_name}.${row.type_name} AS ENUM (\n${labels}\n);`;
      this.save("types", `${row.schema_name}.${row.type_name}`, ddl);
      count++;
    }

    // Composite types
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
        AND t.typtype = 'c'
        AND c.relkind = 'c'
      GROUP BY n.nspname, t.typname
      ORDER BY n.nspname, t.typname;
    `);

    for (const row of composites) {
      if (!this.shouldIncludeSchema(row.schema_name)) {
        continue;
      }
      const ddl = `CREATE TYPE ${row.schema_name}.${row.type_name} AS (\n    ${row.attributes}\n);`;
      this.save("types", `${row.schema_name}.${row.type_name}`, ddl);
      count++;
    }

    this.log("types", count);
  }

  // ─── SEQUENCES ──────────────────────────────────────────────────

  private async extractSequences(): Promise<void> {
    const { rows } = await this.client.query(`
      SELECT
        s.sequence_schema AS schema_name,
        s.sequence_name,
        s.start_value,
        s.minimum_value,
        s.maximum_value,
        s.increment,
        s.cycle_option
      FROM information_schema.sequences s
      WHERE s.sequence_schema NOT IN ${EXCLUDED_SCHEMAS}
      ORDER BY s.sequence_schema, s.sequence_name;
    `);

    let count = 0;
    for (const row of rows) {
      if (!this.shouldIncludeSchema(row.schema_name)) {
        continue;
      }
      const cycle = row.cycle_option === "YES" ? "CYCLE" : "NO CYCLE";
      const ddl = [
        `CREATE SEQUENCE ${row.schema_name}.${row.sequence_name}`,
        `    INCREMENT BY ${row.increment}`,
        `    MINVALUE ${row.minimum_value}`,
        `    MAXVALUE ${row.maximum_value}`,
        `    START WITH ${row.start_value}`,
        `    ${cycle};`,
      ].join("\n");
      this.save("sequences", `${row.schema_name}.${row.sequence_name}`, ddl);
      count++;
    }
    this.log("sequences", count);
  }

  // ─── TABLES (full DDL with constraints) ─────────────────────────

  private async extractTables(): Promise<void> {
    const { rows: tables } = await this.client.query(`
      SELECT schemaname, tablename
      FROM pg_tables
      WHERE schemaname NOT IN ${EXCLUDED_SCHEMAS}
      ORDER BY schemaname, tablename;
    `);

    let count = 0;
    for (const tbl of tables) {
      if (!this.shouldIncludeTable(tbl.schemaname, tbl.tablename)) {
        continue;
      }
      const ddl = await this.buildTableDdl(tbl.schemaname, tbl.tablename);
      this.save("tables", `${tbl.schemaname}.${tbl.tablename}`, ddl);
      count++;
    }
    this.log("tables", count);
  }

  private async buildTableDdl(schema: string, table: string): Promise<string> {
    const parts: string[] = [];

    // ── Columns ──
    const { rows: columns } = await this.client.query(
      `
      SELECT
        c.column_name,
        c.data_type,
        c.udt_name,
        c.character_maximum_length,
        c.numeric_precision,
        c.numeric_scale,
        c.is_nullable,
        c.column_default
      FROM information_schema.columns c
      WHERE c.table_schema = $1 AND c.table_name = $2
      ORDER BY c.ordinal_position;
    `,
      [schema, table]
    );

    const colDefs = columns.map((col) => {
      let typeStr = this.buildColumnType(col);
      let def = `    ${col.column_name} ${typeStr}`;
      if (col.column_default !== null) def += ` DEFAULT ${col.column_default}`;
      if (col.is_nullable === "NO") def += " NOT NULL";
      return def;
    });

    parts.push(`CREATE TABLE ${schema}.${table} (`);
    parts.push(colDefs.join(",\n"));

    // ── Primary Key ──
    const { rows: pks } = await this.client.query(
      `
      SELECT
        tc.constraint_name,
        string_agg(kcu.column_name, ', ' ORDER BY kcu.ordinal_position) AS columns
      FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu
        ON kcu.constraint_name = tc.constraint_name
        AND kcu.constraint_schema = tc.constraint_schema
      WHERE tc.table_schema = $1
        AND tc.table_name = $2
        AND tc.constraint_type = 'PRIMARY KEY'
      GROUP BY tc.constraint_name;
    `,
      [schema, table]
    );

    if (pks.length > 0) {
      parts[parts.length - 1] += ",";
      parts.push(`    CONSTRAINT ${pks[0].constraint_name} PRIMARY KEY (${pks[0].columns})`);
    }

    // ── Unique Constraints ──
    const { rows: uqs } = await this.client.query(
      `
      SELECT
        tc.constraint_name,
        string_agg(kcu.column_name, ', ' ORDER BY kcu.ordinal_position) AS columns
      FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu
        ON kcu.constraint_name = tc.constraint_name
        AND kcu.constraint_schema = tc.constraint_schema
      WHERE tc.table_schema = $1
        AND tc.table_name = $2
        AND tc.constraint_type = 'UNIQUE'
      GROUP BY tc.constraint_name;
    `,
      [schema, table]
    );

    for (const uq of uqs) {
      parts[parts.length - 1] += ",";
      parts.push(`    CONSTRAINT ${uq.constraint_name} UNIQUE (${uq.columns})`);
    }

    // ── Foreign Keys ──
    const { rows: fks } = await this.client.query(
      `
      SELECT
        tc.constraint_name,
        string_agg(DISTINCT kcu.column_name, ', ' ORDER BY kcu.column_name) AS columns,
        ccu.table_schema AS ref_schema,
        ccu.table_name AS ref_table,
        string_agg(DISTINCT ccu.column_name, ', ' ORDER BY ccu.column_name) AS ref_columns,
        rc.update_rule,
        rc.delete_rule
      FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu
        ON kcu.constraint_name = tc.constraint_name
        AND kcu.constraint_schema = tc.constraint_schema
      JOIN information_schema.constraint_column_usage ccu
        ON ccu.constraint_name = tc.constraint_name
        AND ccu.constraint_schema = tc.constraint_schema
      JOIN information_schema.referential_constraints rc
        ON rc.constraint_name = tc.constraint_name
        AND rc.constraint_schema = tc.constraint_schema
      WHERE tc.table_schema = $1
        AND tc.table_name = $2
        AND tc.constraint_type = 'FOREIGN KEY'
      GROUP BY tc.constraint_name, ccu.table_schema, ccu.table_name,
               rc.update_rule, rc.delete_rule;
    `,
      [schema, table]
    );

    for (const fk of fks) {
      parts[parts.length - 1] += ",";
      let fkDef = `    CONSTRAINT ${fk.constraint_name} FOREIGN KEY (${fk.columns})`;
      fkDef += ` REFERENCES ${fk.ref_schema}.${fk.ref_table} (${fk.ref_columns})`;
      if (fk.update_rule && fk.update_rule !== "NO ACTION") {
        fkDef += ` ON UPDATE ${fk.update_rule}`;
      }
      if (fk.delete_rule && fk.delete_rule !== "NO ACTION") {
        fkDef += ` ON DELETE ${fk.delete_rule}`;
      }
      parts.push(fkDef);
    }

    // ── Check Constraints ──
    const { rows: checks } = await this.client.query(
      `
      SELECT
        cc.constraint_name,
        cc.check_clause
      FROM information_schema.check_constraints cc
      JOIN information_schema.table_constraints tc
        ON tc.constraint_name = cc.constraint_name
        AND tc.constraint_schema = cc.constraint_schema
      WHERE tc.table_schema = $1
        AND tc.table_name = $2
        AND tc.constraint_type = 'CHECK'
        AND cc.constraint_name NOT LIKE '%_not_null';
    `,
      [schema, table]
    );

    for (const chk of checks) {
      parts[parts.length - 1] += ",";
      parts.push(`    CONSTRAINT ${chk.constraint_name} CHECK (${chk.check_clause})`);
    }

    parts.push(");");

    // ── Column Comments ──
    const { rows: comments } = await this.client.query(
      `
      SELECT
        a.attname AS column_name,
        d.description
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
      JOIN pg_description d ON d.objoid = c.oid AND d.objsubid = a.attnum
      WHERE n.nspname = $1 AND c.relname = $2;
    `,
      [schema, table]
    );

    for (const cmt of comments) {
      parts.push(
        `\nCOMMENT ON COLUMN ${schema}.${table}.${cmt.column_name} IS '${cmt.description.replace(/'/g, "''")}';`
      );
    }

    // ── Table Comment ──
    const { rows: tblComments } = await this.client.query(
      `
      SELECT d.description
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      JOIN pg_description d ON d.objoid = c.oid AND d.objsubid = 0
      WHERE n.nspname = $1 AND c.relname = $2;
    `,
      [schema, table]
    );

    if (tblComments.length > 0) {
      parts.push(
        `\nCOMMENT ON TABLE ${schema}.${table} IS '${tblComments[0].description.replace(/'/g, "''")}';`
      );
    }

    return parts.join("\n");
  }

  private buildColumnType(col: any): string {
    const { data_type, udt_name, character_maximum_length, numeric_precision, numeric_scale } = col;

    if (data_type === "ARRAY") return `${udt_name.replace(/^_/, "")}[]`;
    if (data_type === "USER-DEFINED") return udt_name;
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

  // ─── VIEWS ──────────────────────────────────────────────────────

  private async extractViews(): Promise<void> {
    const { rows } = await this.client.query(`
      SELECT
        schemaname AS schema_name,
        viewname AS view_name,
        definition
      FROM pg_views
      WHERE schemaname NOT IN ${EXCLUDED_SCHEMAS}
      ORDER BY schemaname, viewname;
    `);

    let count = 0;
    for (const row of rows) {
      if (!this.shouldIncludeSchema(row.schema_name)) {
        continue;
      }
      const ddl = `CREATE OR REPLACE VIEW ${row.schema_name}.${row.view_name} AS\n${row.definition}`;
      this.save("views", `${row.schema_name}.${row.view_name}`, ddl);
      count++;
    }
    this.log("views", count);
  }

  // ─── MATERIALIZED VIEWS ─────────────────────────────────────────

  private async extractMaterializedViews(): Promise<void> {
    const { rows } = await this.client.query(`
      SELECT
        schemaname AS schema_name,
        matviewname AS view_name,
        definition
      FROM pg_matviews
      WHERE schemaname NOT IN ${EXCLUDED_SCHEMAS}
      ORDER BY schemaname, matviewname;
    `);

    let count = 0;
    for (const row of rows) {
      if (!this.shouldIncludeSchema(row.schema_name)) {
        continue;
      }
      const ddl = `CREATE MATERIALIZED VIEW ${row.schema_name}.${row.view_name} AS\n${row.definition}\nWITH DATA;`;
      this.save("materialized_views", `${row.schema_name}.${row.view_name}`, ddl);
      count++;
    }
    this.log("materialized_views", count);
  }

  // ─── FUNCTIONS & PROCEDURES ─────────────────────────────────────

  private async extractFunctions(): Promise<void> {
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

    // Handle overloaded functions (same name, different args)
    const nameCount: Record<string, number> = {};
    let count = 0;

    for (const row of rows) {
      if (!this.shouldIncludeSchema(row.schema_name)) {
        continue;
      }
      const baseName = `${row.schema_name}.${row.function_name}`;
      nameCount[baseName] = (nameCount[baseName] || 0) + 1;
      const suffix = nameCount[baseName] > 1 ? `_${nameCount[baseName]}` : "";
      const objectName = `${baseName}${suffix}`;

      const ddl = `${row.definition};`;
      this.save("functions", objectName, ddl);
      count++;
    }
    this.log("functions", count);
  }

  // ─── TRIGGERS ───────────────────────────────────────────────────

  private async extractTriggers(): Promise<void> {
    const { rows } = await this.client.query(`
      SELECT
        trigger_schema AS schema_name,
        trigger_name,
        event_object_schema,
        event_object_table,
        action_statement,
        action_timing,
        event_manipulation,
        action_orientation
      FROM information_schema.triggers
      WHERE trigger_schema NOT IN ${EXCLUDED_SCHEMAS}
      ORDER BY trigger_schema, trigger_name;
    `);

    // Group by trigger name (one trigger can fire on multiple events)
    const grouped = new Map<string, any[]>();
    for (const row of rows) {
      if (!this.shouldIncludeSchema(row.schema_name)) {
        continue;
      }
      const key = `${row.schema_name}.${row.trigger_name}`;
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key)!.push(row);
    }

    for (const [key, events] of grouped) {
      const first = events[0];
      const eventList = events.map((e: any) => e.event_manipulation).join(" OR ");
      const ddl = [
        `CREATE TRIGGER ${first.trigger_name}`,
        `    ${first.action_timing} ${eventList}`,
        `    ON ${first.event_object_schema}.${first.event_object_table}`,
        `    FOR EACH ${first.action_orientation}`,
        `    ${first.action_statement};`,
      ].join("\n");
      this.save("triggers", key, ddl);
    }
    this.log("triggers", grouped.size);
  }

  // ─── INDEXES (non-pk, non-unique-constraint) ────────────────────

  private async extractIndexes(): Promise<void> {
    const { rows } = await this.client.query(`
      SELECT
        schemaname AS schema_name,
        indexname AS index_name,
        indexdef AS definition
      FROM pg_indexes
      WHERE schemaname NOT IN ${EXCLUDED_SCHEMAS}
        -- skip indexes already represented by constraints
        AND indexname NOT IN (
          SELECT constraint_name
          FROM information_schema.table_constraints
          WHERE constraint_type IN ('PRIMARY KEY', 'UNIQUE')
        )
      ORDER BY schemaname, indexname;
    `);

    let count = 0;
    for (const row of rows) {
      if (!this.shouldIncludeSchema(row.schema_name)) {
        continue;
      }
      const ddl = `${row.definition};`;
      this.save("indexes", `${row.schema_name}.${row.index_name}`, ddl);
      count++;
    }
    this.log("indexes", count);
  }

  // ─── Helpers ────────────────────────────────────────────────────

  /**
   * Check if a schema should be included based on filters
   */
  private shouldIncludeSchema(schemaName: string): boolean {
    // If includeSchemas is specified, only include those schemas
    if (this.filters.includeSchemas && this.filters.includeSchemas.length > 0) {
      return this.filters.includeSchemas.includes(schemaName);
    }

    // If excludeSchemas is specified, exclude those schemas
    if (this.filters.excludeSchemas && this.filters.excludeSchemas.length > 0) {
      return !this.filters.excludeSchemas.includes(schemaName);
    }

    return true;
  }

  /**
   * Check if a table should be included based on filters
   */
  private shouldIncludeTable(schemaName: string, tableName: string): boolean {
    const fullName = `${schemaName}.${tableName}`;

    // If includeTables is specified, only include those tables
    if (this.filters.includeTables && this.filters.includeTables.length > 0) {
      return this.filters.includeTables.includes(fullName);
    }

    // If excludeTables is specified, exclude those tables
    if (this.filters.excludeTables && this.filters.excludeTables.length > 0) {
      return !this.filters.excludeTables.includes(fullName);
    }

    // Check schema-level filters
    return this.shouldIncludeSchema(schemaName);
  }

  private save(category: ObjectCategory, name: string, ddl: string): void {
    this.writer.write(category, name, ddl);
    this.allDdl.push(`-- [${category.toUpperCase()}] ${name}\n${ddl}`);
  }

  private log(category: string, count: number): void {
    const icon =
      {
        schemas: "🗂️",
        types: "🏷️",
        sequences: "🔢",
        tables: "📋",
        views: "👁️",
        materialized_views: "👁️",
        functions: "⚙️",
        triggers: "⚡",
        indexes: "🔍",
      }[category] || "📄";
    console.log(`  ${icon}  ${category.padEnd(22)} ${count}`);
  }
}
