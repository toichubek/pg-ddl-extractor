import * as path from "path";
import * as dotenv from "dotenv";
import { Client } from "pg";
import { program } from "commander";
import { getDbConfig } from "./config";
import { SqlFileWriter } from "./writer";
import { DdlExtractor, ExtractionFilters } from "./extractor";
import { DataExtractor } from "./data-extractor";
import { JsonExporter } from "./json-exporter";
import { getSshConfig, createSshTunnel, TunnelResult } from "./tunnel";
import { loadRcConfig, mergeWithCliOptions } from "./rc-config";

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
  // Selective extraction filters
  schema?: string;
  tables?: string;
  excludeSchema?: string;
  excludeTables?: string;
  // Data extraction
  withData?: string;
  maxRows?: string;
  // Format
  format?: string;
}

function parseArgs(): CliOptions {
  program
    .name("pg-ddl-extract")
    .description("Extract PostgreSQL DDL into organized folder structure")
    .version("1.0.0")
    .option("--env <environment>", "Environment (dev or prod)", "dev")
    .option("--host <host>", "Database host")
    .option("--port <port>", "Database port")
    .option("--database <database>", "Database name")
    .option("--user <user>", "Database user")
    .option("--password <password>", "Database password")
    .option("--output <path>", "Output directory path")
    // Selective extraction options
    .option("--schema <schemas>", "Include only specific schemas (comma-separated)")
    .option("--tables <tables>", "Include only specific tables (comma-separated, format: schema.table)")
    .option("--exclude-schema <schemas>", "Exclude specific schemas (comma-separated)")
    .option("--exclude-tables <tables>", "Exclude specific tables (comma-separated, format: schema.table)")
    // Data extraction options
    .option("--with-data <tables>", "Extract data from specified tables (comma-separated)")
    .option("--max-rows <number>", "Max rows to extract per table (default: 10000)")
    // Format options
    .option("--format <format>", "Output format: sql (default) or json")
    .parse(process.argv);

  const options = program.opts<CliOptions>();

  // Validate env if provided
  if (options.env && !["dev", "prod"].includes(options.env)) {
    console.error(`❌ Invalid env: "${options.env}". Use --env dev or --env prod`);
    process.exit(1);
  }

  // Validate format if provided
  if (options.format && !["sql", "json"].includes(options.format)) {
    console.error(`❌ Invalid format: "${options.format}". Use --format sql or --format json`);
    process.exit(1);
  }

  return options;
}

// ─── Main ─────────────────────────────────────────────────────────
async function main(): Promise<void> {
  const cliOptions = parseArgs();

  // Load config file and merge with CLI options
  const rcConfig = loadRcConfig();
  const options = rcConfig
    ? (mergeWithCliOptions(rcConfig, cliOptions) as CliOptions)
    : cliOptions;

  const env = options.env || "dev";

  // Determine output directory
  const outputDir = options.output
    ? path.resolve(options.output)
    : process.env.SQL_OUTPUT_DIR
      ? path.resolve(process.env.SQL_OUTPUT_DIR, env)
      : path.resolve(__dirname, "..", "..", "sql", env);

  console.log("═══════════════════════════════════════════════════");
  console.log(`  PostgreSQL DDL Extractor`);
  console.log(`  Environment: ${env.toUpperCase()}`);
  console.log(`  Output:      ${outputDir}`);
  console.log("═══════════════════════════════════════════════════");

  // Check if SSH tunnel is needed
  const sshConfig = getSshConfig(env);
  let tunnel: TunnelResult | null = null;

  // Get DB config - use CLI options if provided, otherwise use env-based config
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

  // Validate required fields if using CLI options
  if (options.host || options.database || options.user) {
    if (!options.database || !options.user) {
      console.error("❌ When using CLI flags, --database and --user are required");
      process.exit(1);
    }

    // Validate port number
    if (options.port) {
      const port = parseInt(options.port, 10);
      if (isNaN(port) || port < 1 || port > 65535) {
        console.error(
          `❌ Invalid port number: "${options.port}". Port must be between 1 and 65535`
        );
        process.exit(1);
      }
    }
  }

  if (sshConfig) {
    console.log(`\n🔒 SSH tunnel: ${sshConfig.sshUser}@${sshConfig.sshHost}:${sshConfig.sshPort}`);
    console.log(`   Remote DB:  ${sshConfig.remoteHost}:${sshConfig.remotePort}`);

    try {
      tunnel = await createSshTunnel(sshConfig);
      console.log(`   Local port: 127.0.0.1:${tunnel.localPort}`);

      // Override pg config to connect through tunnel
      pgConfig = {
        ...pgConfig,
        host: "127.0.0.1",
        port: tunnel.localPort,
      };
    } catch (err: any) {
      console.error(`\n❌ SSH tunnel failed: ${err.message}`);
      if (err.message.includes("Authentication")) {
        console.error("   → Check SSH_USER, SSH_PASSWORD or SSH_KEY_PATH in .env");
      }
      if (err.message.includes("ECONNREFUSED")) {
        console.error("   → SSH server not reachable");
      }
      process.exit(1);
    }
  }

  console.log(`\n🔌 Connecting to ${pgConfig.host}:${pgConfig.port}/${pgConfig.database}...`);

  const client = new Client(pgConfig);

  try {
    await client.connect();
    console.log("✅ Connected\n");

    // Get db version for info
    const { rows } = await client.query("SELECT version();");
    console.log(`  DB: ${rows[0].version.split(",")[0]}\n`);

    // Prepare extraction filters
    const filters = {
      includeSchemas: options.schema ? options.schema.split(",").map((s) => s.trim()) : undefined,
      includeTables: options.tables ? options.tables.split(",").map((t) => t.trim()) : undefined,
      excludeSchemas: options.excludeSchema
        ? options.excludeSchema.split(",").map((s) => s.trim())
        : undefined,
      excludeTables: options.excludeTables
        ? options.excludeTables.split(",").map((t) => t.trim())
        : undefined,
    };

    // Log filters if any are set
    if (filters.includeSchemas || filters.includeTables || filters.excludeSchemas || filters.excludeTables) {
      console.log("\n🔍 Filters:");
      if (filters.includeSchemas) console.log(`   Include schemas: ${filters.includeSchemas.join(", ")}`);
      if (filters.includeTables) console.log(`   Include tables:  ${filters.includeTables.join(", ")}`);
      if (filters.excludeSchemas) console.log(`   Exclude schemas: ${filters.excludeSchemas.join(", ")}`);
      if (filters.excludeTables) console.log(`   Exclude tables:  ${filters.excludeTables.join(", ")}`);
    }

    const format = options.format || "sql";

    if (format === "json") {
      // JSON export mode
      const jsonExporter = new JsonExporter(client, filters);
      const filepath = await jsonExporter.exportToFile(outputDir);

      console.log("\n═══════════════════════════════════════════════════");
      console.log(`  ✅ Done! Exported schema as JSON`);
      console.log("═══════════════════════════════════════════════════");
      console.log(`\n  📁 ${filepath}\n`);
    } else {
      // SQL export mode (default)
      const writer = new SqlFileWriter(outputDir);
      const extractor = new DdlExtractor(client, writer, filters);
      await extractor.extractAll();

      // Extract data if requested
      if (options.withData) {
        const dataTables = options.withData.split(",").map((t) => t.trim());
        const maxRows = options.maxRows ? parseInt(options.maxRows, 10) : 10000;
        const dataExtractor = new DataExtractor(client);
        await dataExtractor.extractData({
          tables: dataTables,
          maxRows,
          outputDir,
        });
      }

      // Summary
      const summary = writer.getSummary();
      const total = Object.values(summary).reduce((a, b) => a + b, 0);
      const stats = writer.getChangeStats();

      console.log("\n═══════════════════════════════════════════════════");
      console.log(`  ✅ Done! Extracted ${total} objects into sql/${env}/`);
      console.log("═══════════════════════════════════════════════════");
      console.log(`\n  📁 ${outputDir}`);
      console.log(`  📄 Full dump: sql/${env}/_full_dump.sql`);
      console.log("\n  Change Summary:");
      console.log(`    🆕 Created:   ${stats.created}`);
      console.log(`    🔄 Updated:   ${stats.updated}`);
      console.log(`    ✅ Unchanged: ${stats.unchanged}`);

      if (stats.created === 0 && stats.updated === 0) {
        console.log(`\n  🎉 No changes - database structure is unchanged!\n`);
      } else {
        console.log(`\n  Ready to commit to Git! 🎉\n`);
      }
    }
  } catch (err: any) {
    console.error(`\n❌ Error: ${err.message}`);
    if (err.code === "ECONNREFUSED") {
      console.error("   → Check that the database server is running");
    }
    if (err.code === "28P01") {
      console.error("   → Invalid username or password");
    }
    if (err.code === "3D000") {
      console.error("   → Database does not exist");
    }
    process.exit(1);
  } finally {
    await client.end();
    // Close SSH tunnel if it was opened
    if (tunnel) {
      await tunnel.close();
      console.log("🔒 SSH tunnel closed");
    }
  }
}

main();
