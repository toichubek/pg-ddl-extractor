import * as fs from "fs";
import * as path from "path";
import * as readline from "readline";
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

interface RollbackCommand {
  category: string;
  object: string;
  sql: string;
  priority: number;
  comment: string;
}

interface Rollback {
  timestamp: string;
  commands: RollbackCommand[];
  migrationFile: string;
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
  const start = lines.findIndex((l) => !l.startsWith("-- ") && l.trim() !== "");
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
      const sql = generateAlterSql(item.category, item.object, item.devFile!, item.prodFile!);
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

// ─── Rollback Generator ──────────────────────────────────

export function generateRollback(sqlRoot: string, migration: Migration): Rollback {
  const summary = compareDdl(sqlRoot);
  const commands: RollbackCommand[] = [];

  for (const item of summary.items) {
    const categoryPriority = CATEGORY_PRIORITY[item.category] || 99;

    if (item.status === "only_dev") {
      // Migration CREATEs this → Rollback DROPs it
      const sql = generateDropSql(item.category, item.object);
      // Drop in reverse order of creation
      const priority = (100 - categoryPriority) * 100 + 10;

      commands.push({
        category: item.category,
        object: item.object,
        sql,
        priority,
        comment: `Rollback: Drop ${item.category.slice(0, -1)} ${item.object} (was created by migration)`,
      });
    } else if (item.status === "only_prod") {
      // Migration DROPs this → Rollback restores it from prod
      if (item.prodFile) {
        const sql = generateCreateSql(item.category, item.object, item.prodFile);
        const priority = categoryPriority * 100 + 20;

        commands.push({
          category: item.category,
          object: item.object,
          sql,
          priority,
          comment: `Rollback: Restore ${item.category.slice(0, -1)} ${item.object} (was dropped by migration)`,
        });
      }
    } else if (item.status === "modified") {
      // Migration ALTERs this → Rollback restores old version from prod
      if (item.prodFile) {
        const sql = generateRollbackAlterSql(item.category, item.object, item.prodFile);
        const priority = categoryPriority * 100 + 30;

        commands.push({
          category: item.category,
          object: item.object,
          sql,
          priority,
          comment: `Rollback: Restore ${item.category.slice(0, -1)} ${item.object} to PROD version`,
        });
      }
    }
  }

  // Sort commands by priority
  commands.sort((a, b) => a.priority - b.priority);

  return {
    timestamp: migration.timestamp,
    commands,
    migrationFile: `${migration.timestamp}_dev_to_prod.sql`,
  };
}

function generateRollbackAlterSql(category: string, object: string, prodFile: string): string {
  // For functions and views, simply restore the prod version
  if (category === "functions" || category === "views") {
    const content = fs.readFileSync(prodFile, "utf-8");
    return stripHeader(content);
  }

  // For tables, we can't easily rollback structure changes
  if (category === "tables") {
    const prodDdl = stripHeader(fs.readFileSync(prodFile, "utf-8"));
    return `-- ⚠️ Table rollback: ${object}
-- Review and adjust the following manually to restore PROD state
-- You may need to: ALTER TABLE, DROP/ADD columns, etc.

-- Original PROD definition:
${prodDdl}`;
  }

  // For other categories, drop and recreate from prod
  const drop = generateDropSql(category, object);
  const create = generateCreateSql(category, object, prodFile);
  return `${drop}\n\n${create}`;
}

// ─── Format Rollback File ────────────────────────────────

export function formatRollbackSql(rollback: Rollback): string {
  const lines: string[] = [];

  lines.push("-- ═══════════════════════════════════════════════════════════");
  lines.push("-- ROLLBACK: PROD → DEV (Undo Migration)");
  lines.push(`-- Generated: ${new Date().toISOString()}`);
  lines.push(`-- Undoes migration: ${rollback.migrationFile}`);
  lines.push("-- ═══════════════════════════════════════════════════════════");
  lines.push("");
  lines.push("-- ⚠️  IMPORTANT:");
  lines.push("--   This rollback script reverses the migration above.");
  lines.push("--   Review carefully before running - especially table modifications.");
  lines.push("--   Data changes made after migration will NOT be rolled back.");
  lines.push("");
  lines.push("-- ═══════════════════════════════════════════════════════════");
  lines.push("");
  lines.push("BEGIN;");
  lines.push("");

  if (rollback.commands.length === 0) {
    lines.push("-- 🎉 No rollback needed - migration had no changes!");
  } else {
    let currentCategory = "";

    for (const cmd of rollback.commands) {
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
  lines.push("-- Rollback Complete");
  lines.push("-- ═══════════════════════════════════════════════════════════");

  return lines.join("\n");
}

// ─── Save Rollback ───────────────────────────────────────

export function saveRollback(sqlRoot: string, rollback: Rollback): string {
  const migrationsDir = path.join(sqlRoot, "migrations");
  fs.mkdirSync(migrationsDir, { recursive: true });

  const filename = `${rollback.timestamp}_rollback.sql`;
  const filepath = path.join(migrationsDir, filename);

  const content = formatRollbackSql(rollback);
  fs.writeFileSync(filepath, content, "utf-8");

  return filepath;
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

export function printMigrationSummary(
  migration: Migration,
  filepath: string,
  rollbackPath?: string
): void {
  console.log("═══════════════════════════════════════════════════════════");
  console.log("  Migration Plan Generated");
  console.log("═══════════════════════════════════════════════════════════");
  console.log("");
  console.log(`  📄 Migration: ${filepath}`);
  if (rollbackPath) {
    console.log(`  ↩️  Rollback:  ${rollbackPath}`);
  }
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
    if (rollbackPath) {
      console.log("    2. Review the rollback file");
      console.log("    3. Test on staging environment");
      console.log("    4. Backup production database");
      console.log("    5. Run: psql -d your_db -f " + path.basename(filepath));
      console.log("");
      console.log("  ↩️  To rollback:");
      console.log("       psql -d your_db -f " + path.basename(rollbackPath));
    } else {
      console.log("    2. Test on staging environment");
      console.log("    3. Backup production database");
      console.log("    4. Run: psql -d your_db -f " + path.basename(filepath));
    }
    console.log("");
  } else {
    console.log("  🎉 DEV and PROD are in sync - no migration needed!");
    console.log("");
  }

  console.log("═══════════════════════════════════════════════════════════");
}

// ─── Dry-run Preview ─────────────────────────────────────────

export function printDryRun(migration: Migration): void {
  console.log("═══════════════════════════════════════════════════════════");
  console.log("  DRY RUN — Migration Preview (no files created)");
  console.log("═══════════════════════════════════════════════════════════");
  console.log("");
  console.log("  Summary:");
  console.log(`    🟢 Creates: ${migration.summary.creates}`);
  console.log(`    🔴 Drops:   ${migration.summary.drops}`);
  console.log(`    🔄 Alters:  ${migration.summary.alters}`);
  console.log(`    📊 Total:   ${migration.commands.length} commands`);
  console.log("");

  if (migration.commands.length === 0) {
    console.log("  🎉 DEV and PROD are in sync - no migration needed!");
    console.log("");
    console.log("═══════════════════════════════════════════════════════════");
    return;
  }

  // Group commands by action type
  const creates = migration.commands.filter((c) => c.comment.startsWith("Create"));
  const drops = migration.commands.filter((c) => c.comment.startsWith("Drop"));
  const modifies = migration.commands.filter((c) => c.comment.startsWith("Modify"));

  if (creates.length > 0) {
    console.log("───────────────────────────────────────────────────────────");
    console.log("  🟢 WILL CREATE:");
    console.log("───────────────────────────────────────────────────────────");
    for (const cmd of creates) {
      console.log(`    + [${cmd.category}] ${cmd.object}`);
    }
    console.log("");
  }

  if (modifies.length > 0) {
    console.log("───────────────────────────────────────────────────────────");
    console.log("  🔄 WILL MODIFY:");
    console.log("───────────────────────────────────────────────────────────");
    for (const cmd of modifies) {
      const hasWarning = cmd.sql.includes("⚠️");
      const marker = hasWarning ? " ⚠️  (manual review needed)" : "";
      console.log(`    ~ [${cmd.category}] ${cmd.object}${marker}`);
    }
    console.log("");
  }

  if (drops.length > 0) {
    console.log("───────────────────────────────────────────────────────────");
    console.log("  🔴 WILL DROP:");
    console.log("───────────────────────────────────────────────────────────");
    for (const cmd of drops) {
      console.log(`    - [${cmd.category}] ${cmd.object}`);
    }
    console.log("");
  }

  // Show SQL preview
  console.log("───────────────────────────────────────────────────────────");
  console.log("  📝 SQL Preview:");
  console.log("───────────────────────────────────────────────────────────");
  console.log("");

  let currentCategory = "";
  for (const cmd of migration.commands) {
    if (cmd.category !== currentCategory) {
      console.log(`  -- ${cmd.category.toUpperCase()}`);
      currentCategory = cmd.category;
    }

    // Show first few lines of each SQL command
    const lines = cmd.sql.split("\n");
    const preview = lines.slice(0, 3);
    for (const line of preview) {
      console.log(`  ${line}`);
    }
    if (lines.length > 3) {
      console.log(`  ... (${lines.length - 3} more lines)`);
    }
    console.log("");
  }

  console.log("═══════════════════════════════════════════════════════════");
  console.log("  To generate the actual migration file, run without --dry-run");
  console.log("═══════════════════════════════════════════════════════════");
}

// ─── Interactive Review ──────────────────────────────────────────

function askQuestion(rl: readline.Interface, question: string): Promise<string> {
  return new Promise((resolve) => {
    rl.question(question, (answer) => resolve(answer.trim().toLowerCase()));
  });
}

export async function interactiveReview(migration: Migration): Promise<Migration> {
  if (migration.commands.length === 0) {
    console.log("\n  🎉 No changes to review - DEV and PROD are in sync!\n");
    return migration;
  }

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  console.log("");
  console.log("═══════════════════════════════════════════════════════════");
  console.log("  Interactive Migration Review");
  console.log("═══════════════════════════════════════════════════════════");
  console.log(`  ${migration.commands.length} changes to review`);
  console.log("  [y] include  [n] skip  [v] view SQL  [a] include all  [q] abort");
  console.log("═══════════════════════════════════════════════════════════");
  console.log("");

  const approved: MigrationCommand[] = [];
  let skipped = 0;
  let creates = 0;
  let drops = 0;
  let alters = 0;

  for (let i = 0; i < migration.commands.length; i++) {
    const cmd = migration.commands[i];
    const num = `[${i + 1}/${migration.commands.length}]`;

    const action = cmd.comment.startsWith("Create")
      ? "🟢 CREATE"
      : cmd.comment.startsWith("Drop")
        ? "🔴 DROP"
        : "🔄 MODIFY";

    console.log(`${num} ${action} [${cmd.category}] ${cmd.object}`);

    let decided = false;
    while (!decided) {
      const answer = await askQuestion(rl, "  Include? (y/n/v/a/q): ");

      switch (answer) {
        case "y":
        case "yes":
          approved.push(cmd);
          if (cmd.comment.startsWith("Create")) creates++;
          else if (cmd.comment.startsWith("Drop")) drops++;
          else alters++;
          decided = true;
          break;

        case "n":
        case "no":
          skipped++;
          console.log("  → Skipped");
          decided = true;
          break;

        case "v":
        case "view":
          console.log("  ─────────────────────────────────");
          const sqlLines = cmd.sql.split("\n");
          for (const line of sqlLines.slice(0, 20)) {
            console.log(`  ${line}`);
          }
          if (sqlLines.length > 20) {
            console.log(`  ... (${sqlLines.length - 20} more lines)`);
          }
          console.log("  ─────────────────────────────────");
          break;

        case "a":
        case "all":
          // Include remaining commands
          for (let j = i; j < migration.commands.length; j++) {
            approved.push(migration.commands[j]);
            const c = migration.commands[j];
            if (c.comment.startsWith("Create")) creates++;
            else if (c.comment.startsWith("Drop")) drops++;
            else alters++;
          }
          console.log(`  → Including all ${migration.commands.length - i} remaining commands`);
          decided = true;
          i = migration.commands.length; // Exit outer loop
          break;

        case "q":
        case "quit":
        case "abort":
          console.log("\n  ❌ Migration aborted.\n");
          rl.close();
          process.exit(0);
          break;

        default:
          console.log("  → Invalid option. Use: y, n, v, a, or q");
      }
    }
    console.log("");
  }

  rl.close();

  console.log("───────────────────────────────────────────────────────────");
  console.log("  Review complete:");
  console.log(`    ✅ Included: ${approved.length} commands`);
  console.log(`    ⏭️  Skipped:  ${skipped} commands`);
  console.log("───────────────────────────────────────────────────────────");
  console.log("");

  return {
    timestamp: migration.timestamp,
    commands: approved,
    summary: { creates, drops, alters },
  };
}
