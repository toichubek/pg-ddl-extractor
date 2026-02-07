import * as fs from "fs";
import * as path from "path";
import { program } from "commander";
import { execFileSync } from "child_process";
const pkg = require("../package.json");

interface ChangelogEntry {
  date: string;
  hash: string;
  author: string;
  message: string;
  files: { status: string; file: string }[];
}

interface CliOptions {
  sqlDir?: string;
  env?: string;
  limit?: string;
  output?: string;
  markdown?: boolean;
}

function getGitLog(sqlDir: string, limit: number): ChangelogEntry[] {
  const entries: ChangelogEntry[] = [];

  try {
    // Get git log for the sql directory with file changes
    const logOutput = execFileSync(
      "git",
      ["log", `--pretty=format:%H|%ai|%an|%s`, "--name-status", "-n", String(limit), "--", sqlDir],
      { encoding: "utf-8", maxBuffer: 10 * 1024 * 1024 }
    ).trim();

    if (!logOutput) return entries;

    const commits = logOutput.split("\n\n");
    for (const commit of commits) {
      const lines = commit.trim().split("\n");
      if (lines.length === 0 || !lines[0].includes("|")) continue;

      const [hash, date, author, ...messageParts] = lines[0].split("|");
      const message = messageParts.join("|");

      const files: { status: string; file: string }[] = [];
      for (let i = 1; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;
        const parts = line.split("\t");
        if (parts.length >= 2) {
          files.push({
            status: parts[0],
            file: parts[1],
          });
        }
      }

      if (files.length > 0) {
        entries.push({
          date: date.slice(0, 10),
          hash: hash.slice(0, 7),
          author,
          message,
          files,
        });
      }
    }
  } catch {
    // Not a git repo or git not available
  }

  return entries;
}

function categorizeFile(file: string): { category: string; object: string } | null {
  // Parse sql/dev/tables/public.users.sql -> category=tables, object=public.users
  const parts = file.split("/");
  const categories = [
    "schemas", "tables", "functions", "views", "materialized_views",
    "sequences", "triggers", "types", "indexes", "data",
  ];
  for (let i = 0; i < parts.length - 1; i++) {
    if (categories.includes(parts[i])) {
      const object = parts[i + 1]?.replace(".sql", "") || "";
      return { category: parts[i], object };
    }
  }
  return null;
}

function formatConsoleChangelog(entries: ChangelogEntry[]): string {
  const lines: string[] = [];

  lines.push("═══════════════════════════════════════════════════════════");
  lines.push("  Schema Changelog");
  lines.push("═══════════════════════════════════════════════════════════");
  lines.push("");

  if (entries.length === 0) {
    lines.push("  No schema changes found in Git history.");
    lines.push("");
    lines.push("═══════════════════════════════════════════════════════════");
    return lines.join("\n");
  }

  const statusIcon: Record<string, string> = {
    A: "🆕",
    M: "🔄",
    D: "🗑️",
    R: "📝",
  };

  for (const entry of entries) {
    lines.push(`  ${entry.date} [${entry.hash}] ${entry.author}`);
    lines.push(`  ${entry.message}`);

    const byCategory = new Map<string, { status: string; object: string }[]>();
    for (const f of entry.files) {
      const parsed = categorizeFile(f.file);
      if (parsed) {
        if (!byCategory.has(parsed.category)) byCategory.set(parsed.category, []);
        byCategory.get(parsed.category)!.push({ status: f.status, object: parsed.object });
      }
    }

    for (const [category, items] of byCategory) {
      for (const item of items) {
        const icon = statusIcon[item.status] || "📄";
        const action =
          item.status === "A" ? "added" :
          item.status === "M" ? "modified" :
          item.status === "D" ? "deleted" : "changed";
        lines.push(`    ${icon} [${category}] ${item.object} (${action})`);
      }
    }

    lines.push("");
  }

  lines.push("═══════════════════════════════════════════════════════════");
  return lines.join("\n");
}

function formatMarkdownChangelog(entries: ChangelogEntry[]): string {
  const lines: string[] = [];

  lines.push("# Schema Changelog");
  lines.push("");
  lines.push(`Generated: ${new Date().toISOString().slice(0, 19)}`);
  lines.push("");

  if (entries.length === 0) {
    lines.push("No schema changes found in Git history.");
    return lines.join("\n");
  }

  const statusLabel: Record<string, string> = {
    A: "Added",
    M: "Modified",
    D: "Deleted",
    R: "Renamed",
  };

  // Group by date
  const byDate = new Map<string, ChangelogEntry[]>();
  for (const entry of entries) {
    if (!byDate.has(entry.date)) byDate.set(entry.date, []);
    byDate.get(entry.date)!.push(entry);
  }

  for (const [date, dayEntries] of byDate) {
    lines.push(`## ${date}`);
    lines.push("");

    for (const entry of dayEntries) {
      lines.push(`### ${entry.message} (\`${entry.hash}\`)`);
      lines.push("");
      lines.push(`*by ${entry.author}*`);
      lines.push("");

      for (const f of entry.files) {
        const parsed = categorizeFile(f.file);
        if (parsed) {
          const action = statusLabel[f.status] || "Changed";
          lines.push(`- **${action}** \`[${parsed.category}]\` ${parsed.object}`);
        }
      }
      lines.push("");
    }
  }

  return lines.join("\n");
}

function parseArgs(): CliOptions {
  program
    .name("pg-ddl-changelog")
    .description("Generate schema changelog from Git history")
    .version(pkg.version)
    .option("--sql-dir <path>", "Path to SQL directory")
    .option("--env <environment>", "Environment filter (dev, prod)")
    .option("--limit <number>", "Max number of commits to show", "20")
    .option("--output <path>", "Output file path")
    .option("--markdown", "Output as Markdown format")
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

  if (!fs.existsSync(searchDir)) {
    console.error(`❌ Directory not found: ${searchDir}`);
    process.exit(1);
  }

  const limit = parseInt(options.limit || "20", 10);
  if (isNaN(limit) || limit < 1 || limit > 1000) {
    console.error(`❌ Invalid --limit: "${options.limit}". Must be between 1 and 1000`);
    process.exit(1);
  }
  const entries = getGitLog(searchDir, limit);

  let output: string;
  if (options.markdown) {
    output = formatMarkdownChangelog(entries);
  } else {
    output = formatConsoleChangelog(entries);
  }

  if (options.output) {
    fs.writeFileSync(options.output, output, "utf-8");
    console.log(`📋 Changelog saved to: ${options.output}`);
  } else {
    console.log(output);
  }
}

main();
