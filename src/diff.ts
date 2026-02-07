import * as fs from "fs";
import * as path from "path";
import * as dotenv from "dotenv";
import { program } from "commander";
import {
  compareDdl,
  compareDdlDirs,
  compareMultiEnv,
  formatConsoleReport,
  formatMarkdownReport,
  formatHtmlReport,
  formatMultiEnvReport,
} from "./compare";

// ─── Load .env ────────────────────────────────────────────────────
dotenv.config();

// ─── Parse CLI args ───────────────────────────────────────────────
interface CliOptions {
  report?: boolean;
  sqlDir?: string;
  dev?: string;
  prod?: string;
  envs?: string;
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
    .option("--envs <environments>", "Compare multiple environments (comma-separated, e.g. dev,staging,prod)")
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

  try {
    // Multi-environment comparison
    if (options.envs) {
      const envNames = options.envs.split(",").map((e) => e.trim());

      if (envNames.length < 2) {
        console.error("❌ --envs requires at least 2 environments");
        process.exit(1);
      }

      // Verify all directories exist
      for (const env of envNames) {
        const dir = path.join(sqlRoot, env);
        if (!fs.existsSync(dir)) {
          console.error(`❌ sql/${env}/ not found. Run: pg-ddl-extract --env ${env}`);
          process.exit(1);
        }
      }

      const result = compareMultiEnv(sqlRoot, envNames);
      console.log(formatMultiEnvReport(result));
      return;
    }

    // Standard two-environment comparison
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

    const summary = options.dev || options.prod
      ? compareDdlDirs(devDir, prodDir)
      : compareDdl(sqlRoot);

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
