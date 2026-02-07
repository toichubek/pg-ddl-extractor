import * as path from "path";
import * as dotenv from "dotenv";
import { Client } from "pg";
import { getDbConfig } from "./config";
import { SqlFileWriter } from "./writer";
import { DdlExtractor } from "./extractor";
import { getSshConfig, createSshTunnel, TunnelResult } from "./tunnel";

// ─── Load .env ────────────────────────────────────────────────────
dotenv.config();

// ─── Parse CLI args ───────────────────────────────────────────────
function parseArgs(): { env: string } {
  const args = process.argv.slice(2);
  let env = "dev"; // default

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--env" && args[i + 1]) {
      env = args[i + 1].toLowerCase();
      i++;
    }
  }

  if (!["dev", "prod"].includes(env)) {
    console.error(`❌ Invalid env: "${env}". Use --env dev or --env prod`);
    process.exit(1);
  }

  return { env };
}

// ─── Main ─────────────────────────────────────────────────────────
async function main(): Promise<void> {
  const { env } = parseArgs();
  // extract-db lives at /myproject/extract-db/
  // sql folder lives at  /myproject/sql/
  const outputDir = path.resolve(__dirname, "..", "..", "sql", env);

  console.log("═══════════════════════════════════════════════════");
  console.log(`  PostgreSQL DDL Extractor`);
  console.log(`  Environment: ${env.toUpperCase()}`);
  console.log(`  Output:      ${outputDir}`);
  console.log("═══════════════════════════════════════════════════");

  // Check if SSH tunnel is needed
  const sshConfig = getSshConfig(env);
  let tunnel: TunnelResult | null = null;
  let pgConfig = getDbConfig(env);

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

    // Extract
    const writer = new SqlFileWriter(outputDir);
    const extractor = new DdlExtractor(client, writer);
    await extractor.extractAll();

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