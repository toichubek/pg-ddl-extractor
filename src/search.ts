import * as fs from "fs";
import * as path from "path";
import * as dotenv from "dotenv";
import { program } from "commander";

dotenv.config();

interface SearchResult {
  file: string;
  category: string;
  object: string;
  lineNumber: number;
  line: string;
}

interface CliOptions {
  sqlDir?: string;
  env?: string;
  category?: string;
  ignoreCase?: boolean;
}

function searchFiles(
  dir: string,
  pattern: string,
  category?: string,
  ignoreCase?: boolean
): SearchResult[] {
  const results: SearchResult[] = [];

  if (!fs.existsSync(dir)) return results;

  const categories = fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && d.name !== "data" && d.name !== "reports")
    .map((d) => d.name);

  const regex = new RegExp(pattern, ignoreCase ? "i" : "");

  for (const cat of categories) {
    if (category && cat !== category) continue;

    const catDir = path.join(dir, cat);
    if (!fs.existsSync(catDir)) continue;

    const files = fs.readdirSync(catDir).filter((f) => f.endsWith(".sql"));

    for (const file of files) {
      const filepath = path.join(catDir, file);
      const content = fs.readFileSync(filepath, "utf-8");
      const lines = content.split("\n");

      for (let i = 0; i < lines.length; i++) {
        if (regex.test(lines[i])) {
          results.push({
            file: filepath,
            category: cat,
            object: file.replace(".sql", ""),
            lineNumber: i + 1,
            line: lines[i].trimEnd(),
          });
        }
      }
    }
  }

  return results;
}

function parseArgs(): { pattern: string; options: CliOptions } {
  program
    .name("pg-ddl-search")
    .description("Search across extracted SQL files")
    .version("1.0.0")
    .argument("<pattern>", "Search pattern (regex supported)")
    .option("--sql-dir <path>", "Path to SQL directory")
    .option("--env <environment>", "Environment to search (dev or prod)", "dev")
    .option("--category <category>", "Limit search to a category (tables, functions, etc.)")
    .option("-i, --ignore-case", "Case-insensitive search")
    .parse(process.argv);

  const args = program.args;
  if (args.length === 0) {
    console.error("❌ Please provide a search pattern");
    process.exit(1);
  }

  return {
    pattern: args[0],
    options: program.opts<CliOptions>(),
  };
}

function main(): void {
  const { pattern, options } = parseArgs();

  const sqlRoot = options.sqlDir
    ? path.resolve(options.sqlDir)
    : process.env.SQL_OUTPUT_DIR
      ? path.resolve(process.env.SQL_OUTPUT_DIR)
      : path.resolve(__dirname, "..", "..", "sql");

  const env = options.env || "dev";
  const searchDir = path.join(sqlRoot, env);

  if (!fs.existsSync(searchDir)) {
    console.error(`❌ Directory not found: ${searchDir}`);
    console.error(`   Run: pg-ddl-extract --env ${env}`);
    process.exit(1);
  }

  console.log(`\n🔍 Searching "${pattern}" in sql/${env}/`);
  if (options.category) {
    console.log(`   Category: ${options.category}`);
  }
  console.log("");

  const results = searchFiles(searchDir, pattern, options.category, options.ignoreCase);

  if (results.length === 0) {
    console.log("  No matches found.\n");
    return;
  }

  // Group by category and object
  const grouped = new Map<string, SearchResult[]>();
  for (const result of results) {
    const key = `${result.category}/${result.object}`;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key)!.push(result);
  }

  for (const [key, matches] of grouped) {
    const [cat, obj] = key.split("/");
    console.log(`  📄 [${cat}] ${obj} (${matches.length} match${matches.length > 1 ? "es" : ""})`);
    for (const m of matches.slice(0, 5)) {
      // Highlight the match in the line
      const highlightedLine = options.ignoreCase
        ? m.line.replace(new RegExp(pattern, "gi"), (match) => `\x1b[33m${match}\x1b[0m`)
        : m.line.replace(new RegExp(pattern, "g"), (match) => `\x1b[33m${match}\x1b[0m`);
      console.log(`     L${m.lineNumber}: ${highlightedLine}`);
    }
    if (matches.length > 5) {
      console.log(`     ... and ${matches.length - 5} more matches`);
    }
    console.log("");
  }

  console.log(`  Total: ${results.length} match${results.length > 1 ? "es" : ""} in ${grouped.size} file${grouped.size > 1 ? "s" : ""}\n`);
}

main();
