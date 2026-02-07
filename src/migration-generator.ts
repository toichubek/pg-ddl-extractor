import * as fs from "fs";
import * as path from "path";
import { compareDdl } from "./compare";

// ─── Types ────────────────────────────────────────────────────

interface MigrationCommand {
  category: string;
  object: string;
  sql: string;
  priority: number; // Lower number = execute first
  comment: string;
}

interface Migration {
  timestamp: string;
  commands: MigrationCommand[];
  summary: {
    creates: number;
    drops: number;
    alters: number;
  };
}

// ─── Priority Order (execute from low to high) ───────────────

const CATEGORY_PRIORITY: Record<string, number> = {
  schemas: 1,
  types: 2,
  sequences: 3,
  tables: 4,
  functions: 5,
  views: 6,
  materialized_views: 7,
  triggers: 8,
  indexes: 9,
};

const ACTION_PRIORITY: Record<string, number> = {
  DROP: 10, // Drop in reverse order
  CREATE: 20,
  ALTER: 30,
};

// ─── SQL Generator ────────────────────────────────────────────

function generateCreateSql(category: string, object: string, devFile: string): string {
  const content = fs.readFileSync(devFile, "utf-8");
  const ddl = stripHeader(content);

  // For functions and views, use CREATE OR REPLACE
  if (category === "functions" || category === "views") {
    return ddl; // Already has CREATE OR REPLACE
  }

  return ddl;
}

function generateDropSql(category: string, object: string): string {
  const objectType = getCategoryObjectType(category);
  const objectName = object;

  // Use DROP IF EXISTS for safety
  if (category === "functions") {
    // For functions we need to include parameters, but we don't have them
    // So we'll use DROP FUNCTION IF EXISTS with CASCADE
    return `DROP FUNCTION IF EXISTS ${objectName} CASCADE;`;
  }

  if (category === "triggers") {
    // Triggers need table name, which we don't have in the object name
    // We'll need to parse it from the file or skip
    return `-- DROP TRIGGER ${objectName}; -- ⚠️ Manual review needed: specify table name`;
  }

  return `DROP ${objectType} IF EXISTS ${objectName} CASCADE;`;
}

function generateAlterSql(
  category: string,
  object: string,
  devFile: string,
  prodFile: string
): string {
  // For most categories, we can use CREATE OR REPLACE
  if (category === "functions" || category === "views") {
    const content = fs.readFileSync(devFile, "utf-8");
    return stripHeader(content);
  }

  // For tables, we need to analyze column differences
  if (category === "tables") {
    return analyzeTableDiff(object, devFile, prodFile);
  }

  // For other categories, drop and recreate
  const drop = generateDropSql(category, object);
  const create = generateCreateSql(category, object, devFile);
  return `${drop}\n\n${create}`;
}

function analyzeTableDiff(tableName: string, devFile: string, prodFile: string): string {
  // Simple approach: just recreate the table
  // TODO: More sophisticated column-level ALTER analysis
  const devDdl = stripHeader(fs.readFileSync(devFile, "utf-8"));

  return `-- ⚠️ Table modified: ${tableName}
-- Review the changes manually and adjust as needed
-- Option 1: Manually write ALTER TABLE statements
-- Option 2: Recreate table (data loss!)

-- Current DEV definition:
${devDdl}

-- To preserve data, you may need to:
-- 1. Create temporary table
-- 2. Copy data
-- 3. Drop old table
-- 4. Recreate with new structure
-- 5. Restore data`;
}

function getCategoryObjectType(category: string): string {
  const mapping: Record<string, string> = {
    schemas: "SCHEMA",
    types: "TYPE",
    sequences: "SEQUENCE",
    tables: "TABLE",
    functions: "FUNCTION",
    views: "VIEW",
    materialized_views: "MATERIALIZED VIEW",
    triggers: "TRIGGER",
    indexes: "INDEX",
  };
  return mapping[category] || category.toUpperCase();
}

function stripHeader(content: string): string {
  const lines = content.split("\n");
  const start = lines.findIndex(
    (l) => !l.startsWith("-- ") && l.trim() !== ""
  );
  return start >= 0 ? lines.slice(start).join("\n").trim() : content.trim();
}

// ─── Migration Generator ──────────────────────────────────────

export function generateMigration(sqlRoot: string): Migration {
  const summary = compareDdl(sqlRoot);
  const commands: MigrationCommand[] = [];

  let creates = 0;
  let drops = 0;
  let alters = 0;

  // Process all differences
  for (const item of summary.items) {
    const categoryPriority = CATEGORY_PRIORITY[item.category] || 99;

    if (item.status === "only_dev") {
      // CREATE: object exists in dev but not in prod
      const sql = generateCreateSql(item.category, item.object, item.devFile!);
      const priority = categoryPriority * 100 + ACTION_PRIORITY.CREATE;

      commands.push({
        category: item.category,
        object: item.object,
        sql,
        priority,
        comment: `Create ${item.category.slice(0, -1)}: ${item.object}`,
      });
      creates++;
    } else if (item.status === "only_prod") {
      // DROP: object exists in prod but not in dev
      const sql = generateDropSql(item.category, item.object);
      // Drop in reverse order (higher priority number)
      const priority = (100 - categoryPriority) * 100 + ACTION_PRIORITY.DROP;

      commands.push({
        category: item.category,
        object: item.object,
        sql,
        priority,
        comment: `Drop ${item.category.slice(0, -1)}: ${item.object}`,
      });
      drops++;
    } else if (item.status === "modified") {
      // ALTER: object exists in both but differs
      const sql = generateAlterSql(
        item.category,
        item.object,
        item.devFile!,
        item.prodFile!
      );
      const priority = categoryPriority * 100 + ACTION_PRIORITY.ALTER;

      commands.push({
        category: item.category,
        object: item.object,
        sql,
        priority,
        comment: `Modify ${item.category.slice(0, -1)}: ${item.object}`,
      });
      alters++;
    }
  }

  // Sort commands by priority
  commands.sort((a, b) => a.priority - b.priority);

  return {
    timestamp: new Date().toISOString().slice(0, 19).replace(/[:-]/g, "").replace("T", "_"),
    commands,
    summary: { creates, drops, alters },
  };
}

// ─── Format Migration File ────────────────────────────────────

export function formatMigrationSql(migration: Migration): string {
  const lines: string[] = [];

  lines.push("-- ═══════════════════════════════════════════════════════════");
  lines.push("-- Migration: DEV → PROD");
  lines.push(`-- Generated: ${new Date().toISOString()}`);
  lines.push("-- ═══════════════════════════════════════════════════════════");
  lines.push("");
  lines.push("-- Summary:");
  lines.push(`--   🟢 Creates: ${migration.summary.creates}`);
  lines.push(`--   🔴 Drops:   ${migration.summary.drops}`);
  lines.push(`--   🔄 Alters:  ${migration.summary.alters}`);
  lines.push("");
  lines.push("-- ⚠️  IMPORTANT:");
  lines.push("--   1. Review this migration carefully before running");
  lines.push("--   2. Test on a staging environment first");
  lines.push("--   3. Backup your production database");
  lines.push("--   4. Some commands may require manual adjustment (marked with ⚠️)");
  lines.push("");
  lines.push("-- ═══════════════════════════════════════════════════════════");
  lines.push("");
  lines.push("BEGIN;");
  lines.push("");

  if (migration.commands.length === 0) {
    lines.push("-- 🎉 No changes needed - DEV and PROD are in sync!");
  } else {
    let currentCategory = "";

    for (const cmd of migration.commands) {
      // Add section header when category changes
      if (cmd.category !== currentCategory) {
        if (currentCategory !== "") {
          lines.push("");
        }
        lines.push(`-- ─────────────────────────────────────────────────────────`);
        lines.push(`-- ${cmd.category.toUpperCase()}`);
        lines.push(`-- ─────────────────────────────────────────────────────────`);
        lines.push("");
        currentCategory = cmd.category;
      }

      lines.push(`-- ${cmd.comment}`);
      lines.push(cmd.sql);
      lines.push("");
    }
  }

  lines.push("COMMIT;");
  lines.push("");
  lines.push("-- ═══════════════════════════════════════════════════════════");
  lines.push("-- Migration Complete");
  lines.push("-- ═══════════════════════════════════════════════════════════");

  return lines.join("\n");
}

// ─── Save Migration ───────────────────────────────────────────

export function saveMigration(sqlRoot: string, migration: Migration): string {
  const migrationsDir = path.join(sqlRoot, "migrations");
  fs.mkdirSync(migrationsDir, { recursive: true });

  const filename = `${migration.timestamp}_dev_to_prod.sql`;
  const filepath = path.join(migrationsDir, filename);

  const content = formatMigrationSql(migration);
  fs.writeFileSync(filepath, content, "utf-8");

  return filepath;
}

// ─── CLI Report ───────────────────────────────────────────────

export function printMigrationSummary(migration: Migration, filepath: string): void {
  console.log("═══════════════════════════════════════════════════════════");
  console.log("  Migration Plan Generated");
  console.log("═══════════════════════════════════════════════════════════");
  console.log("");
  console.log(`  📄 File: ${filepath}`);
  console.log("");
  console.log("  Summary:");
  console.log(`    🟢 Creates: ${migration.summary.creates}`);
  console.log(`    🔴 Drops:   ${migration.summary.drops}`);
  console.log(`    🔄 Alters:  ${migration.summary.alters}`);
  console.log(`    📊 Total:   ${migration.commands.length} commands`);
  console.log("");

  if (migration.commands.length > 0) {
    console.log("  ⚠️  Next Steps:");
    console.log("    1. Review the migration file carefully");
    console.log("    2. Test on staging environment");
    console.log("    3. Backup production database");
    console.log("    4. Run: psql -d your_db -f " + path.basename(filepath));
    console.log("");
  } else {
    console.log("  🎉 DEV and PROD are in sync - no migration needed!");
    console.log("");
  }

  console.log("═══════════════════════════════════════════════════════════");
}
