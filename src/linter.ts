import { Client } from "pg";

// ─── Types ────────────────────────────────────────────────────

export type LintSeverity = "error" | "warning" | "info";

export interface LintIssue {
  rule: string;
  severity: LintSeverity;
  object: string;
  message: string;
}

export interface LintResult {
  issues: LintIssue[];
  summary: {
    errors: number;
    warnings: number;
    infos: number;
    tablesChecked: number;
  };
}

// ─── Schema Linter ────────────────────────────────────────────

export class SchemaLinter {
  private client: Client;
  private issues: LintIssue[] = [];

  constructor(client: Client) {
    this.client = client;
  }

  async lint(): Promise<LintResult> {
    this.issues = [];

    console.log("\n🔍 Running schema lint checks...\n");

    await this.checkTablesWithoutPK();
    await this.checkMissingFKIndexes();
    await this.checkTablesWithoutComments();
    await this.checkDuplicateIndexes();
    await this.checkUnusedIndexes();
    await this.checkSequenceOwnedBy();

    const tablesChecked = await this.getTableCount();

    return {
      issues: this.issues,
      summary: {
        errors: this.issues.filter((i) => i.severity === "error").length,
        warnings: this.issues.filter((i) => i.severity === "warning").length,
        infos: this.issues.filter((i) => i.severity === "info").length,
        tablesChecked,
      },
    };
  }

  // ─── Rule: Tables without Primary Key ────────────────────────

  private async checkTablesWithoutPK(): Promise<void> {
    const { rows } = await this.client.query(`
      SELECT
        n.nspname || '.' || c.relname AS table_name
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE c.relkind = 'r'
        AND n.nspname NOT IN ('pg_catalog', 'information_schema', 'pg_toast')
        AND NOT EXISTS (
          SELECT 1 FROM pg_constraint con
          WHERE con.conrelid = c.oid AND con.contype = 'p'
        )
      ORDER BY n.nspname, c.relname;
    `);

    for (const row of rows) {
      this.issues.push({
        rule: "no-primary-key",
        severity: "error",
        object: row.table_name,
        message: `Table ${row.table_name} has no PRIMARY KEY`,
      });
    }
    this.logRule("no-primary-key", rows.length);
  }

  // ─── Rule: Foreign Keys without Index ────────────────────────

  private async checkMissingFKIndexes(): Promise<void> {
    const { rows } = await this.client.query(`
      SELECT
        n.nspname || '.' || c.relname AS table_name,
        con.conname AS fk_name,
        a.attname AS column_name
      FROM pg_constraint con
      JOIN pg_class c ON c.oid = con.conrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
      JOIN pg_attribute a ON a.attrelid = con.conrelid AND a.attnum = ANY(con.conkey)
      WHERE con.contype = 'f'
        AND n.nspname NOT IN ('pg_catalog', 'information_schema', 'pg_toast')
        AND NOT EXISTS (
          SELECT 1 FROM pg_index idx
          WHERE idx.indrelid = con.conrelid
            AND a.attnum = ANY(idx.indkey)
        )
      ORDER BY n.nspname, c.relname, a.attname;
    `);

    for (const row of rows) {
      this.issues.push({
        rule: "missing-fk-index",
        severity: "warning",
        object: `${row.table_name}.${row.column_name}`,
        message: `FK column ${row.column_name} on ${row.table_name} (${row.fk_name}) has no index — JOINs will be slow`,
      });
    }
    this.logRule("missing-fk-index", rows.length);
  }

  // ─── Rule: Tables without Comments ───────────────────────────

  private async checkTablesWithoutComments(): Promise<void> {
    const { rows } = await this.client.query(`
      SELECT
        n.nspname || '.' || c.relname AS table_name
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE c.relkind = 'r'
        AND n.nspname NOT IN ('pg_catalog', 'information_schema', 'pg_toast')
        AND NOT EXISTS (
          SELECT 1 FROM pg_description d
          WHERE d.objoid = c.oid AND d.objsubid = 0
        )
      ORDER BY n.nspname, c.relname;
    `);

    for (const row of rows) {
      this.issues.push({
        rule: "no-table-comment",
        severity: "info",
        object: row.table_name,
        message: `Table ${row.table_name} has no COMMENT`,
      });
    }
    this.logRule("no-table-comment", rows.length);
  }

  // ─── Rule: Duplicate Indexes ─────────────────────────────────

  private async checkDuplicateIndexes(): Promise<void> {
    const { rows } = await this.client.query(`
      SELECT
        n.nspname || '.' || ci.relname AS index_name,
        n.nspname || '.' || ct.relname AS table_name,
        pg_get_indexdef(i.indexrelid) AS index_def,
        array_agg(a.attname ORDER BY array_position(i.indkey, a.attnum)) AS columns
      FROM pg_index i
      JOIN pg_class ci ON ci.oid = i.indexrelid
      JOIN pg_class ct ON ct.oid = i.indrelid
      JOIN pg_namespace n ON n.oid = ct.relnamespace
      JOIN pg_attribute a ON a.attrelid = ct.oid AND a.attnum = ANY(i.indkey)
      WHERE n.nspname NOT IN ('pg_catalog', 'information_schema', 'pg_toast')
      GROUP BY n.nspname, ci.relname, ct.relname, i.indexrelid, i.indrelid, i.indkey
      HAVING EXISTS (
        SELECT 1
        FROM pg_index i2
        JOIN pg_class ci2 ON ci2.oid = i2.indexrelid
        WHERE i2.indrelid = i.indrelid
          AND i2.indexrelid != i.indexrelid
          AND i2.indkey = i.indkey
      )
      ORDER BY table_name, index_name;
    `);

    for (const row of rows) {
      this.issues.push({
        rule: "duplicate-index",
        severity: "warning",
        object: row.index_name,
        message: `Index ${row.index_name} on ${row.table_name} may be a duplicate (columns: ${row.columns.join(", ")})`,
      });
    }
    this.logRule("duplicate-index", rows.length);
  }

  // ─── Rule: Unused Indexes ────────────────────────────────────

  private async checkUnusedIndexes(): Promise<void> {
    const { rows } = await this.client.query(`
      SELECT
        schemaname || '.' || indexrelname AS index_name,
        schemaname || '.' || relname AS table_name,
        idx_scan,
        pg_size_pretty(pg_relation_size(indexrelid)) AS index_size
      FROM pg_stat_user_indexes
      WHERE idx_scan = 0
        AND schemaname NOT IN ('pg_catalog', 'information_schema', 'pg_toast')
        AND indexrelname NOT IN (
          SELECT constraint_name
          FROM information_schema.table_constraints
          WHERE constraint_type IN ('PRIMARY KEY', 'UNIQUE')
        )
      ORDER BY pg_relation_size(indexrelid) DESC
      LIMIT 20;
    `);

    for (const row of rows) {
      this.issues.push({
        rule: "unused-index",
        severity: "info",
        object: row.index_name,
        message: `Index ${row.index_name} on ${row.table_name} has never been used (size: ${row.index_size})`,
      });
    }
    this.logRule("unused-index", rows.length);
  }

  // ─── Rule: Sequences not owned by column ─────────────────────

  private async checkSequenceOwnedBy(): Promise<void> {
    const { rows } = await this.client.query(`
      SELECT
        n.nspname || '.' || c.relname AS sequence_name
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE c.relkind = 'S'
        AND n.nspname NOT IN ('pg_catalog', 'information_schema', 'pg_toast')
        AND NOT EXISTS (
          SELECT 1 FROM pg_depend d
          WHERE d.objid = c.oid
            AND d.deptype = 'a'
        )
      ORDER BY n.nspname, c.relname;
    `);

    for (const row of rows) {
      this.issues.push({
        rule: "unowned-sequence",
        severity: "info",
        object: row.sequence_name,
        message: `Sequence ${row.sequence_name} is not owned by any column — may be orphaned`,
      });
    }
    this.logRule("unowned-sequence", rows.length);
  }

  // ─── Helpers ────────────────────────────────────────────────

  private async getTableCount(): Promise<number> {
    const { rows } = await this.client.query(`
      SELECT count(*) AS cnt
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE c.relkind = 'r'
        AND n.nspname NOT IN ('pg_catalog', 'information_schema', 'pg_toast');
    `);
    return parseInt(rows[0].cnt, 10);
  }

  private logRule(rule: string, count: number): void {
    const status = count === 0 ? "✅" : "⚠️";
    console.log(`  ${status} ${rule.padEnd(25)} ${count} issue${count !== 1 ? "s" : ""}`);
  }
}

// ─── Report Formatter ─────────────────────────────────────────

export function printLintReport(result: LintResult): void {
  console.log("");
  console.log("═══════════════════════════════════════════════════════════");
  console.log("  Schema Lint Report");
  console.log("═══════════════════════════════════════════════════════════");
  console.log("");
  console.log(`  Tables checked: ${result.summary.tablesChecked}`);
  console.log(`  🔴 Errors:   ${result.summary.errors}`);
  console.log(`  🟡 Warnings: ${result.summary.warnings}`);
  console.log(`  🔵 Info:     ${result.summary.infos}`);
  console.log("");

  if (result.issues.length === 0) {
    console.log("  🎉 No issues found — schema looks great!");
    console.log("");
    console.log("═══════════════════════════════════════════════════════════");
    return;
  }

  // Group by severity
  const errors = result.issues.filter((i) => i.severity === "error");
  const warnings = result.issues.filter((i) => i.severity === "warning");
  const infos = result.issues.filter((i) => i.severity === "info");

  if (errors.length > 0) {
    console.log("───────────────────────────────────────────────────────────");
    console.log("  🔴 ERRORS (should fix):");
    console.log("───────────────────────────────────────────────────────────");
    for (const issue of errors) {
      console.log(`    ${issue.message}`);
    }
    console.log("");
  }

  if (warnings.length > 0) {
    console.log("───────────────────────────────────────────────────────────");
    console.log("  🟡 WARNINGS (recommended to fix):");
    console.log("───────────────────────────────────────────────────────────");
    for (const issue of warnings) {
      console.log(`    ${issue.message}`);
    }
    console.log("");
  }

  if (infos.length > 0) {
    console.log("───────────────────────────────────────────────────────────");
    console.log("  🔵 INFO (consider improving):");
    console.log("───────────────────────────────────────────────────────────");
    for (const issue of infos) {
      console.log(`    ${issue.message}`);
    }
    console.log("");
  }

  console.log("═══════════════════════════════════════════════════════════");
}
