import * as fs from "fs";
import * as path from "path";
import { program } from "commander";
import { execFileSync } from "child_process";
const pkg = require("../package.json");

interface CliOptions {
  sqlDir?: string;
  env?: string;
  from?: string;
  to?: string;
  output?: string;
}

interface SnapshotDiffItem {
  file: string;
  category: string;
  object: string;
  status: "added" | "modified" | "deleted";
}

function getGitDiff(sqlDir: string, fromRef: string, toRef: string): SnapshotDiffItem[] {
  const results: SnapshotDiffItem[] = [];

  try {
    const output = execFileSync(
      "git",
      ["diff", "--name-status", fromRef, toRef, "--", sqlDir],
      { encoding: "utf-8", maxBuffer: 10 * 1024 * 1024 }
    ).trim();

    if (!output) return results;

    for (const line of output.split("\n")) {
      const parts = line.trim().split("\t");
      if (parts.length < 2) continue;

      const statusChar = parts[0];
      const file = parts[parts.length - 1];

      if (!file.endsWith(".sql")) continue;

      const fileParts = file.split("/");
      const categories = [
        "schemas", "tables", "functions", "views", "materialized_views",
        "sequences", "triggers", "types", "indexes", "data",
      ];

      let category = "";
      let object = "";
      for (let i = 0; i < fileParts.length - 1; i++) {
        if (categories.includes(fileParts[i])) {
          category = fileParts[i];
          object = fileParts[i + 1]?.replace(".sql", "") || "";
          break;
        }
      }

      if (!category) continue;

      const status: SnapshotDiffItem["status"] =
        statusChar === "A" ? "added" :
        statusChar === "D" ? "deleted" : "modified";

      results.push({ file, category, object, status });
    }
  } catch (err: any) {
    console.error(`❌ Git diff failed: ${err.message}`);
    console.error("   Make sure both refs exist: git log --oneline");
    process.exit(1);
  }

  return results;
}

function printSnapshotDiff(items: SnapshotDiffItem[], fromRef: string, toRef: string): void {
  console.log("═══════════════════════════════════════════════════════════");
  console.log("  Schema Snapshot Comparison");
  console.log(`  From: ${fromRef}`);
  console.log(`  To:   ${toRef}`);
  console.log("═══════════════════════════════════════════════════════════");
  console.log("");

  const added = items.filter((i) => i.status === "added");
  const modified = items.filter((i) => i.status === "modified");
  const deleted = items.filter((i) => i.status === "deleted");

  console.log(`  🆕 Added:    ${added.length}`);
  console.log(`  🔄 Modified: ${modified.length}`);
  console.log(`  🗑️  Deleted:  ${deleted.length}`);
  console.log("");

  if (items.length === 0) {
    console.log("  🎉 No schema changes between these snapshots!\n");
    console.log("═══════════════════════════════════════════════════════════");
    return;
  }

  // Group by category
  const byCategory = new Map<string, SnapshotDiffItem[]>();
  for (const item of items) {
    if (!byCategory.has(item.category)) byCategory.set(item.category, []);
    byCategory.get(item.category)!.push(item);
  }

  for (const [category, catItems] of byCategory) {
    console.log(`  📦 ${category}:`);
    for (const item of catItems) {
      const icon =
        item.status === "added" ? "🆕" :
        item.status === "modified" ? "🔄" : "🗑️";
      console.log(`    ${icon} ${item.object} (${item.status})`);
    }
    console.log("");
  }

  console.log("═══════════════════════════════════════════════════════════");
}

function formatMarkdown(items: SnapshotDiffItem[], fromRef: string, toRef: string): string {
  const lines: string[] = [];

  lines.push("# Schema Snapshot Comparison");
  lines.push("");
  lines.push(`- **From:** \`${fromRef}\``);
  lines.push(`- **To:** \`${toRef}\``);
  lines.push(`- **Generated:** ${new Date().toISOString().slice(0, 19)}`);
  lines.push("");

  const added = items.filter((i) => i.status === "added");
  const modified = items.filter((i) => i.status === "modified");
  const deleted = items.filter((i) => i.status === "deleted");

  lines.push("## Summary");
  lines.push("");
  lines.push(`| Status | Count |`);
  lines.push(`|--------|-------|`);
  lines.push(`| Added | ${added.length} |`);
  lines.push(`| Modified | ${modified.length} |`);
  lines.push(`| Deleted | ${deleted.length} |`);
  lines.push("");

  if (items.length === 0) {
    lines.push("No schema changes between these snapshots.");
    return lines.join("\n");
  }

  lines.push("## Changes");
  lines.push("");
  lines.push("| Category | Object | Status |");
  lines.push("|----------|--------|--------|");

  for (const item of items) {
    lines.push(`| ${item.category} | ${item.object} | ${item.status} |`);
  }

  return lines.join("\n");
}

function parseArgs(): CliOptions {
  program
    .name("pg-ddl-snapshot-diff")
    .description("Compare schema snapshots between Git commits or tags")
    .version(pkg.version)
    .requiredOption("--from <ref>", "Git ref to compare from (commit hash, tag, or branch)")
    .requiredOption("--to <ref>", "Git ref to compare to (commit hash, tag, or branch)")
    .option("--sql-dir <path>", "Path to SQL directory")
    .option("--env <environment>", "Environment filter (dev, prod)")
    .option("--output <path>", "Save as Markdown report")
    .parse(process.argv);

  return program.opts<CliOptions>();
}

function main(): void {
  const options = parseArgs();

  const sqlRoot = options.sqlDir
    ? path.resolve(options.sqlDir)
    : process.env.SQL_OUTPUT_DIR
      ? path.resolve(process.env.SQL_OUTPUT_DIR)
      : path.resolve(__dirname, "..", "..", "sql");

  const searchDir = options.env ? path.join(sqlRoot, options.env) : sqlRoot;

  const items = getGitDiff(searchDir, options.from!, options.to!);

  if (options.output) {
    const md = formatMarkdown(items, options.from!, options.to!);
    fs.writeFileSync(options.output, md, "utf-8");
    console.log(`📊 Snapshot diff saved to: ${options.output}`);
  } else {
    printSnapshotDiff(items, options.from!, options.to!);
  }
}

main();
