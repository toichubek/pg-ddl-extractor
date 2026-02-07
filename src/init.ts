import * as fs from "fs";
import * as path from "path";
import { program } from "commander";
const pkg = require("../package.json");

interface CliOptions {
  dir?: string;
  force?: boolean;
}

const ENV_TEMPLATE = `# PostgreSQL DDL Extractor Configuration
# ──────────────────────────────────────

# DEV Database
DEV_DB_HOST=localhost
DEV_DB_PORT=5432
DEV_DB_NAME=my_database
DEV_DB_USER=postgres
DEV_DB_PASSWORD=

# PROD Database
PROD_DB_HOST=prod-server.example.com
PROD_DB_PORT=5432
PROD_DB_NAME=my_database
PROD_DB_USER=readonly_user
PROD_DB_PASSWORD=

# Optional: Custom SQL output directory
# SQL_OUTPUT_DIR=./sql

# Optional: SSH Tunnel (if database is behind a bastion host)
# DEV_SSH_HOST=bastion.example.com
# DEV_SSH_PORT=22
# DEV_SSH_USER=ubuntu
# DEV_SSH_KEY_PATH=~/.ssh/id_rsa
# DEV_SSH_REMOTE_HOST=10.0.0.5
# DEV_SSH_REMOTE_PORT=5432
`;

const CONFIG_TEMPLATE = `{
  "defaults": {
    "env": "dev",
    "output": "./sql"
  },
  "extract": {
    "excludeSchema": [],
    "excludeTables": []
  },
  "migration": {
    "withRollback": true
  }
}
`;

const GITIGNORE_TEMPLATE = `.env
node_modules/
.snapshot-meta.json
`;

function writeIfNotExists(filepath: string, content: string, force: boolean): boolean {
  if (fs.existsSync(filepath) && !force) {
    console.log(`  ⏭️  ${path.basename(filepath)} already exists (use --force to overwrite)`);
    return false;
  }
  fs.writeFileSync(filepath, content, "utf-8");
  console.log(`  ✅ Created ${path.basename(filepath)}`);
  return true;
}

function parseArgs(): CliOptions {
  program
    .name("pg-ddl-init")
    .description("Initialize a new pg-ddl-extractor project with config files")
    .version(pkg.version)
    .option("--dir <path>", "Project directory (default: current directory)")
    .option("--force", "Overwrite existing files")
    .parse(process.argv);

  return program.opts<CliOptions>();
}

function main(): void {
  const options = parseArgs();
  const dir = options.dir ? path.resolve(options.dir) : process.cwd();
  const force = !!options.force;

  console.log("═══════════════════════════════════════════════════════════");
  console.log("  Initializing pg-ddl-extractor project");
  console.log(`  Directory: ${dir}`);
  console.log("═══════════════════════════════════════════════════════════");
  console.log("");

  fs.mkdirSync(dir, { recursive: true });

  // Create config files
  writeIfNotExists(path.join(dir, ".env.example"), ENV_TEMPLATE, force);
  writeIfNotExists(path.join(dir, ".pg-ddl-extractor.json"), CONFIG_TEMPLATE, force);

  // Create .gitignore additions
  const gitignorePath = path.join(dir, ".gitignore");
  if (fs.existsSync(gitignorePath)) {
    const existing = fs.readFileSync(gitignorePath, "utf-8");
    const additions: string[] = [];
    if (!existing.includes(".env")) additions.push(".env");
    if (!existing.includes(".snapshot-meta.json")) additions.push(".snapshot-meta.json");

    if (additions.length > 0) {
      fs.appendFileSync(gitignorePath, "\n# pg-ddl-extractor\n" + additions.join("\n") + "\n");
      console.log(`  ✅ Updated .gitignore (+${additions.length} entries)`);
    } else {
      console.log("  ⏭️  .gitignore already has required entries");
    }
  } else {
    writeIfNotExists(gitignorePath, GITIGNORE_TEMPLATE, force);
  }

  // Create sql directory structure
  const sqlDir = path.join(dir, "sql");
  fs.mkdirSync(path.join(sqlDir, "dev"), { recursive: true });
  fs.mkdirSync(path.join(sqlDir, "prod"), { recursive: true });
  fs.mkdirSync(path.join(sqlDir, "migrations"), { recursive: true });
  fs.mkdirSync(path.join(sqlDir, "reports"), { recursive: true });
  console.log("  ✅ Created sql/ directory structure");

  console.log("");
  console.log("  📋 Next steps:");
  console.log("    1. Copy .env.example to .env and fill in your database credentials");
  console.log("    2. Run: pg-ddl-extract --env dev");
  console.log("    3. Commit the sql/ directory to Git");
  console.log("");
  console.log("  💡 Available commands:");
  console.log("    pg-ddl-extract    Extract schema DDL");
  console.log("    pg-ddl-diff       Compare environments");
  console.log("    pg-ddl-migrate    Generate migrations");
  console.log("    pg-ddl-lint       Lint schema");
  console.log("    pg-ddl-stats      Database statistics");
  console.log("    pg-ddl-docs       Generate documentation");
  console.log("    pg-ddl-deps       Dependency graph");
  console.log("    pg-ddl-validate   Schema validation");
  console.log("    pg-ddl-search     Search SQL files");
  console.log("    pg-ddl-size       Size report");
  console.log("    pg-ddl-watch      Watch for changes");
  console.log("    pg-ddl-changelog  Git changelog");
  console.log("");
  console.log("═══════════════════════════════════════════════════════════");
}

main();
