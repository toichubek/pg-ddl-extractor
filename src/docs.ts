import * as fs from "fs";
import * as path from "path";
import * as dotenv from "dotenv";
import { Client } from "pg";
import { program } from "commander";
import { getDbConfig } from "./config";
import { DocsGenerator, formatDocsMarkdown, formatDocsMermaid } from "./docs-generator";
import { getSshConfig, createSshTunnel, TunnelResult } from "./tunnel";

// ─── Load .env ────────────────────────────────────────────────────
dotenv.config();

// ─── Parse CLI args ───────────────────────────────────────────────
interface CliOptions {
  env?: string;
  host?: string;
  port?: string;
  database?: string;
  user?: string;
  password?: string;
  output?: string;
  format?: string;
  diagram?: boolean;
}

function parseArgs(): CliOptions {
  program
    .name("pg-ddl-docs")
    .description("Generate documentation from PostgreSQL database schema")
    .version("1.0.0")
    .option("--env <environment>", "Environment (dev or prod)", "dev")
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

  const sshConfig = getSshConfig(env);
  let tunnel: TunnelResult | null = null;

  let pgConfig =
    options.host || options.database || options.user
      ? {
          host: options.host || "localhost",
          port: options.port ? parseInt(options.port, 10) : 5432,
          database: options.database!,
          user: options.user!,
          password: options.password || "",
          connectionTimeoutMillis: 10000,
          query_timeout: 30000,
        }
      : getDbConfig(env);

  if (options.host || options.database || options.user) {
    if (!options.database || !options.user) {
      console.error("❌ When using CLI flags, --database and --user are required");
      process.exit(1);
    }
  }

  if (sshConfig) {
    try {
      tunnel = await createSshTunnel(sshConfig);
      pgConfig = { ...pgConfig, host: "127.0.0.1", port: tunnel.localPort };
    } catch (err: any) {
      console.error(`\n❌ SSH tunnel failed: ${err.message}`);
      process.exit(1);
    }
  }

  console.log(`\n🔌 Connecting to ${pgConfig.host}:${pgConfig.port}/${pgConfig.database}...`);

  const client = new Client(pgConfig);

  try {
    await client.connect();
    console.log("✅ Connected\n");

    console.log("📝 Generating documentation...\n");

    const generator = new DocsGenerator(client);
    const doc = await generator.generate();

    // Determine output directory
    const outputDir = options.output
      ? path.resolve(options.output)
      : path.resolve(process.cwd(), "docs");

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
  } catch (err: any) {
    console.error(`\n❌ Error: ${err.message}`);
    process.exit(1);
  } finally {
    await client.end();
    if (tunnel) {
      await tunnel.close();
    }
  }
}

main();
