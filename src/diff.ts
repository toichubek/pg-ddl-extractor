import * as fs from "fs";
import * as path from "path";
import { compareDdl, formatConsoleReport, formatMarkdownReport, formatHtmlReport } from "./compare";

// ─── Parse CLI args ───────────────────────────────────────────────
function parseArgs(): { report: boolean } {
  const args = process.argv.slice(2);
  return {
    report: args.includes("--report"),
  };
}

// ─── Main ─────────────────────────────────────────────────────────
function main(): void {
  const { report } = parseArgs();

  // sql/ lives at ../../sql relative to this script (extract-db/src/)
  const sqlRoot = path.resolve(__dirname, "..", "..", "sql");

  if (!fs.existsSync(sqlRoot)) {
    console.error(`❌ sql/ folder not found at: ${sqlRoot}`);
    console.error("   Run extract:dev and extract:prod first.");
    process.exit(1);
  }

  const devDir = path.join(sqlRoot, "dev");
  const prodDir = path.join(sqlRoot, "prod");

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
    if (report) {
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