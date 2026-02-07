import * as fs from "fs";
import * as path from "path";
import { program } from "commander";
const pkg = require("../package.json");
import { DocsGenerator, formatDocsMarkdown, formatDocsMermaid } from "./docs-generator";
import { DbCliOptions, runWithConnection } from "./cli-utils";

// ─── Parse CLI args ───────────────────────────────────────────────
interface CliOptions extends DbCliOptions {
  output?: string;
  format?: string;
  diagram?: boolean;
}

function parseArgs(): CliOptions {
  program
    .name("pg-ddl-docs")
    .description("Generate documentation from PostgreSQL database schema")
    .version(pkg.version)
    .option("--env <environment>", "Environment name (e.g. dev, stage, prod)", "dev")
    .option("--host <host>", "Database host")
    .option("--port <port>", "Database port")
    .option("--database <database>", "Database name")
    .option("--user <user>", "Database user")
    .option("--password <password>", "Database password")
    .option("--output <path>", "Output directory for documentation")
    .option("--format <format>", "Output format: markdown (default)", "markdown")
    .option("--diagram", "Include Mermaid ERD diagram")
    .parse(process.argv);

  return program.opts<CliOptions>();
}

// ─── Main ─────────────────────────────────────────────────────────
async function main(): Promise<void> {
  const options = parseArgs();
  const env = options.env || "dev";

  console.log("═══════════════════════════════════════════════════════════");
  console.log(`  PostgreSQL Schema Documentation Generator`);
  console.log(`  Environment: ${env.toUpperCase()}`);
  console.log("═══════════════════════════════════════════════════════════");

  await runWithConnection(options, async (client) => {
    console.log("📝 Generating documentation...\n");

    const generator = new DocsGenerator(client);
    const doc = await generator.generate();

    // Determine output directory (default: sql/docs/)
    const outputDir = options.output
      ? path.resolve(options.output)
      : process.env.SQL_OUTPUT_DIR
        ? path.resolve(process.env.SQL_OUTPUT_DIR, "docs")
        : path.resolve(__dirname, "..", "..", "sql", "docs");

    fs.mkdirSync(outputDir, { recursive: true });

    // Generate markdown
    const markdown = formatDocsMarkdown(doc);
    const mdPath = path.join(outputDir, `schema_${env}.md`);
    fs.writeFileSync(mdPath, markdown, "utf-8");
    console.log(`  📄 Markdown: ${mdPath}`);

    // Generate diagram if requested
    if (options.diagram) {
      const mermaid = formatDocsMermaid(doc);
      const diagramPath = path.join(outputDir, `erd_${env}.md`);
      fs.writeFileSync(diagramPath, `# ERD Diagram: ${doc.dbName}\n\n${mermaid}\n`, "utf-8");
      console.log(`  📊 Diagram:  ${diagramPath}`);
    }

    // Print summary
    let totalTables = 0;
    let totalViews = 0;
    let totalFunctions = 0;

    for (const schema of doc.schemas) {
      totalTables += schema.tables.length;
      totalViews += schema.views.length;
      totalFunctions += schema.functions.length;
    }

    console.log("");
    console.log("═══════════════════════════════════════════════════════════");
    console.log("  ✅ Documentation generated!");
    console.log("═══════════════════════════════════════════════════════════");
    console.log(`  Schemas:   ${doc.schemas.length}`);
    console.log(`  Tables:    ${totalTables}`);
    console.log(`  Views:     ${totalViews}`);
    console.log(`  Functions: ${totalFunctions}`);
    console.log("═══════════════════════════════════════════════════════════");
  });
}

main();
