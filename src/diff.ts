import * as fs from "fs";
import * as path from "path";
import { program } from "commander";
import { compareDdl, formatConsoleReport, formatMarkdownReport, formatHtmlReport } from "./compare";

// ─── Parse CLI args ───────────────────────────────────────────────
interface CliOptions {
  report?: boolean;
  sqlDir?: string;
  dev?: string;
  prod?: string;
}

function parseArgs(): CliOptions {
  program
    .name("pg-ddl-diff")
    .description("Compare dev and prod PostgreSQL schemas")
    .version("1.0.0")
    .option("--report", "Generate markdown and HTML reports")
    .option("--sql-dir <path>", "Path to SQL directory (default: ../../sql)")
    .option("--dev <path>", "Path to dev schema directory")
    .option("--prod <path>", "Path to prod schema directory")
    .parse(process.argv);

  return program.opts<CliOptions>();
}

// ─── Main ─────────────────────────────────────────────────────────
function main(): void {
  const options = parseArgs();

  // Determine SQL root directory
  const sqlRoot = options.sqlDir
    ? path.resolve(options.sqlDir)
    : process.env.SQL_OUTPUT_DIR
      ? path.resolve(process.env.SQL_OUTPUT_DIR)
      : path.resolve(__dirname, "..", "..", "sql");

  if (!fs.existsSync(sqlRoot)) {
    console.error(`❌ sql/ folder not found at: ${sqlRoot}`);
    console.error("   Run extract:dev and extract:prod first.");
    process.exit(1);
  }

  // Determine dev and prod directories
  const devDir = options.dev ? path.resolve(options.dev) : path.join(sqlRoot, "dev");
  const prodDir = options.prod ? path.resolve(options.prod) : path.join(sqlRoot, "prod");

  if (!fs.existsSync(devDir)) {
    console.error("❌ sql/dev/ not found. Run: npm run extract:dev");
    process.exit(1);
  }
  if (!fs.existsSync(prodDir)) {
    console.error("❌ sql/prod/ not found. Run: npm run extract:prod");
    process.exit(1);
  }

  try {
    const summary = compareDdl(sqlRoot);

    // Always print to console
    console.log(formatConsoleReport(summary));

    // Optionally save reports (markdown + HTML)
    if (options.report) {
      const reportDir = path.join(sqlRoot, "reports");
      fs.mkdirSync(reportDir, { recursive: true });

      const timestamp = new Date().toISOString().slice(0, 10);

      const mdPath = path.join(reportDir, `diff_${timestamp}.md`);
      fs.writeFileSync(mdPath, formatMarkdownReport(summary), "utf-8");

      const htmlPath = path.join(reportDir, `diff_${timestamp}.html`);
      fs.writeFileSync(htmlPath, formatHtmlReport(summary), "utf-8");

      console.log(`\n📄 Markdown: ${mdPath}`);
      console.log(`🌐 HTML:     ${htmlPath}`);
      console.log(`\n   Open in browser: open ${htmlPath}`);
    }
  } catch (err: any) {
    console.error(`❌ ${err.message}`);
    process.exit(1);
  }
}

main();
