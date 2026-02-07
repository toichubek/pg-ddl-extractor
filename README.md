# 📦 PostgreSQL DDL Extractor

[![npm version](https://badge.fury.io/js/@toichubek%2Fpg-ddl-extractor.svg)](https://www.npmjs.com/package/@toichubek/pg-ddl-extractor)
[![npm downloads](https://img.shields.io/npm/dm/@toichubek/pg-ddl-extractor.svg)](https://www.npmjs.com/package/@toichubek/pg-ddl-extractor)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js Version](https://img.shields.io/node/v/@toichubek/pg-ddl-extractor.svg)](https://nodejs.org)

Extracts full database structure (DDL) from PostgreSQL and organizes it into a clean folder structure for Git version control.

## 🚀 Installation

### As npm package (recommended)

```bash
# Install globally
npm install -g @toichubek/pg-ddl-extractor

# Or install locally in your project
npm install --save-dev @toichubek/pg-ddl-extractor
```

### From source

Clone this repository and use directly with npm scripts.

## Project Structure

```
myproject/
├── back/
├── front/
├── extract-db/              ← this tool
│   ├── src/
│   │   ├── extract.ts       ← entry point
│   │   ├── extractor.ts     ← SQL queries
│   │   ├── writer.ts        ← file writer
│   │   └── config.ts        ← DB config
│   ├── package.json
│   ├── tsconfig.json
│   └── .env
└── sql/                     ← output goes here
    ├── dev/
    │   ├── _full_dump.sql
    │   ├── schemas/
    │   │   └── public.sql
    │   ├── tables/
    │   │   ├── public.users.sql
    │   │   ├── public.orders.sql
    │   │   └── ...
    │   ├── functions/
    │   │   ├── public.calculate_total.sql
    │   │   └── ...
    │   ├── views/
    │   ├── materialized_views/
    │   ├── sequences/
    │   ├── triggers/
    │   ├── types/
    │   └── indexes/
    └── prod/
        └── ... (same structure)
```

## What Gets Extracted

| Object             | Includes                                          |
|--------------------|---------------------------------------------------|
| **Tables**         | Columns, PK, FK, UNIQUE, CHECK, defaults, comments |
| **Functions**      | Full `CREATE FUNCTION` via `pg_get_functiondef()`  |
| **Views**          | `CREATE OR REPLACE VIEW`                           |
| **Materialized Views** | `CREATE MATERIALIZED VIEW`                     |
| **Sequences**      | INCREMENT, MIN, MAX, START, CYCLE                  |
| **Triggers**       | Timing, events, action                             |
| **Types**          | Enum and composite types                           |
| **Indexes**        | Non-constraint indexes only                        |
| **Schemas**        | `CREATE SCHEMA IF NOT EXISTS`                      |

## Setup

```bash
# Install dependencies
npm install

# Copy env template and fill in your DB credentials
cp .env.example .env
```

Edit `.env`:

```env
DEV_DB_HOST=localhost
DEV_DB_PORT=5432
DEV_DB_NAME=my_database
DEV_DB_USER=postgres
DEV_DB_PASSWORD=secret

PROD_DB_HOST=prod-server.example.com
PROD_DB_PORT=5432
PROD_DB_NAME=my_database
PROD_DB_USER=readonly_user
PROD_DB_PASSWORD=secret
```

## Configuration

### Environment Variables

You can configure database connections using environment variables in a `.env` file or via your shell:

```env
# DEV database
DEV_DB_HOST=localhost
DEV_DB_PORT=5432
DEV_DB_NAME=my_database
DEV_DB_USER=postgres
DEV_DB_PASSWORD=secret

# PROD database
PROD_DB_HOST=prod-server.example.com
PROD_DB_PORT=5432
PROD_DB_NAME=my_database
PROD_DB_USER=readonly_user
PROD_DB_PASSWORD=secret

# Optional: Custom output directory
SQL_OUTPUT_DIR=/path/to/sql
```

### CLI Flags

All commands support CLI flags to override environment variables:

**`pg-ddl-extract` Options:**
- `--env <environment>` - Environment name (dev or prod) - default: `dev`
- `--host <host>` - Database host
- `--port <port>` - Database port - default: `5432`
- `--database <database>` - Database name (required with --host)
- `--user <user>` - Database user (required with --host)
- `--password <password>` - Database password
- `--output <path>` - Custom output directory path
- `--schema <schemas>` - Include only specific schemas (comma-separated)
- `--tables <tables>` - Include only specific tables (comma-separated, format: schema.table)
- `--exclude-schema <schemas>` - Exclude specific schemas (comma-separated)
- `--exclude-tables <tables>` - Exclude specific tables (comma-separated, format: schema.table)
- `--help` - Display help
- `--version` - Display version

**`pg-ddl-diff` Options:**
- `--report` - Generate markdown and HTML reports
- `--sql-dir <path>` - Path to SQL directory - default: `./sql`
- `--dev <path>` - Path to dev schema directory
- `--prod <path>` - Path to prod schema directory
- `--help` - Display help
- `--version` - Display version

**`pg-ddl-migrate` Options:**
- `--sql-dir <path>` - Path to SQL directory - default: `./sql`
- `--dev <path>` - Path to dev schema directory
- `--prod <path>` - Path to prod schema directory
- `--with-rollback` - Generate rollback script alongside migration
- `--help` - Display help
- `--version` - Display version

## Usage

### CLI Commands (after global install)

```bash
# Extract DEV database → saves to ./sql/dev/
pg-ddl-extract --env dev

# Extract PROD database → saves to ./sql/prod/
pg-ddl-extract --env prod

# Extract with direct connection (no .env file needed)
pg-ddl-extract --host localhost --database mydb --user postgres --password secret

# Extract to custom output directory
pg-ddl-extract --env dev --output /custom/path

# Selective extraction - extract only specific schemas
pg-ddl-extract --env dev --schema public,auth

# Extract only specific tables
pg-ddl-extract --env dev --tables public.users,public.orders,auth.sessions

# Exclude specific schemas
pg-ddl-extract --env dev --exclude-schema test,temp

# Exclude specific tables
pg-ddl-extract --env dev --exclude-tables public.logs,public.cache

# Combine filters - extract public schema but exclude logs table
pg-ddl-extract --env dev --schema public --exclude-tables public.logs

# Compare DEV vs PROD
pg-ddl-diff

# Compare and save reports
pg-ddl-diff --report

# Compare with custom directories
pg-ddl-diff --dev /path/to/dev --prod /path/to/prod

# Generate migration plan
pg-ddl-migrate

# Generate migration with rollback script
pg-ddl-migrate --with-rollback

# Generate migration with custom SQL directory
pg-ddl-migrate --sql-dir /custom/sql
```

### Examples with Environment Variables

```bash
# Unix/Linux/Mac - Pass env vars inline
DEV_DB_HOST=localhost DEV_DB_NAME=mydb DEV_DB_USER=postgres pg-ddl-extract --env dev

# Windows (PowerShell)
$env:DEV_DB_HOST="localhost"; $env:DEV_DB_NAME="mydb"; pg-ddl-extract --env dev

# Windows (cmd)
set DEV_DB_HOST=localhost && set DEV_DB_NAME=mydb && pg-ddl-extract --env dev
```

### Using npm scripts (local install or from source)

```bash
# From your project root or extract-db/ folder
npm run extract:dev
npm run extract:prod
npm run diff
npm run diff:report
npm run migrate
npm run migrate:rollback  # Generate migration + rollback
```

### Programmatic API

```typescript
import { Client } from "pg";
import {
  SqlFileWriter,
  DdlExtractor,
  compareDdl,
  generateMigration,
} from "@toichubek/pg-ddl-extractor";

// Extract database DDL
const client = new Client({ /* config */ });
await client.connect();

const writer = new SqlFileWriter("./sql/dev");
const extractor = new DdlExtractor(client, writer);
await extractor.extractAll();

// Compare environments
const summary = compareDdl("./sql");
console.log(summary);

// Generate migration
const migration = generateMigration("./sql");
```

## Compare DEV vs PROD

```bash
# Print diff to console
npm run diff

# Print to console + save markdown report to sql/reports/
npm run diff:report
```

## Generate Migration Plan

```bash
# Generate SQL migration file from DEV → PROD
npm run migrate
```

This will:
- Analyze differences between DEV and PROD
- Generate SQL migration commands (CREATE, ALTER, DROP)
- Save to `sql/migrations/YYYYMMDD_HHmmss_dev_to_prod.sql`
- Organize commands in correct execution order
- Add safety comments for manual review

⚠️ **Important**: Always review and test migrations before running on production!

Example output:
```
═══════════════════════════════════════════════════════════
  Migration Plan Generated
═══════════════════════════════════════════════════════════

  📄 File: /path/to/sql/migrations/20260207_052700_dev_to_prod.sql

  Summary:
    🟢 Creates: 16
    🔴 Drops:   57
    🔄 Alters:  50
    📊 Total:   123 commands

  ⚠️  Next Steps:
    1. Review the migration file carefully
    2. Test on staging environment
    3. Backup production database
    4. Run: psql -d your_db -f 20260207_052700_dev_to_prod.sql

═══════════════════════════════════════════════════════════
```

The generated migration file includes:
- **Sequences** - CREATE SEQUENCE for new sequences
- **Tables** - CREATE TABLE for new tables, with warnings for modified tables
- **Functions** - CREATE OR REPLACE FUNCTION for new/modified functions
- **Views** - CREATE OR REPLACE VIEW for new/modified views
- **Triggers** - CREATE TRIGGER (may need manual adjustment)
- **Indexes** - CREATE INDEX for new indexes
- **Drops** - DROP ... IF EXISTS CASCADE for removed objects

All commands are organized in correct dependency order.

## Rollback Generation

Generate rollback scripts alongside migrations for safe deployments:

```bash
# Generate both migration and rollback
pg-ddl-migrate --with-rollback

# Or with npm scripts
npm run migrate:rollback
```

This creates two files:
- `migrations/YYYYMMDD_HHmmss_dev_to_prod.sql` — Forward migration
- `migrations/YYYYMMDD_HHmmss_rollback.sql` — Reverse migration

The rollback script:
- **DROPs** objects that were CREATEd by the migration
- **RESTOREs** objects that were DROPped (from PROD DDL)
- **REVERTs** modified objects to their PROD version
- Wraps everything in a `BEGIN`/`COMMIT` transaction

Example:
```bash
# Apply migration
psql -d your_db -f sql/migrations/20260207_120000_dev_to_prod.sql

# If something goes wrong — rollback!
psql -d your_db -f sql/migrations/20260207_120000_rollback.sql
```

Example diff output:
```
═══════════════════════════════════════════════════════════
  DEV vs PROD — DDL Comparison Report
═══════════════════════════════════════════════════════════

  DEV objects:  48
  PROD objects: 45

  ✅ Identical:  40
  🔄 Modified:   3
  🟢 Only DEV:   5
  🔴 Only PROD:  2

───────────────────────────────────────────────────────────
  🟢 EXISTS ONLY IN DEV (not yet in prod)
───────────────────────────────────────────────────────────
    [tables] public.student_drafts
    [functions] public.fn_calculate_scores

───────────────────────────────────────────────────────────
  🔄 MODIFIED (different between dev and prod)
───────────────────────────────────────────────────────────

    [tables] public.users
      DEV  [5]: email varchar(255) NOT NULL
      PROD [5]: email varchar(150) NOT NULL
```

## Git Workflow

```bash
# From project root
git add sql/
git commit -m "chore: update database DDL snapshot"
```

### Recommended: Add to root project scripts

In your root `package.json`:

```json
{
  "scripts": {
    "db:snapshot:dev": "cd extract-db && npx ts-node src/extract.ts --env dev",
    "db:snapshot:prod": "cd extract-db && npx ts-node src/extract.ts --env prod"
  }
}
```

## Running Migrations

After generating a migration file:

1. **Review carefully** - Open the generated SQL file and review all changes
2. **Test on staging** - Run the migration on a staging database first
3. **Backup production** - Create a full backup before running on production
4. **Run migration**:
   ```bash
   psql -h prod-host -U db_user -d database_name -f sql/migrations/YYYYMMDD_HHmmss_dev_to_prod.sql
   ```

### Migration Safety

The generator includes safety features:
- Uses `IF EXISTS` for DROP commands
- Uses `CASCADE` where needed
- Adds `BEGIN`/`COMMIT` transaction wrapper
- Marks complex changes with ⚠️ for manual review
- Provides comments explaining each change

### What Requires Manual Review

Some changes cannot be fully automated:
- **Table modifications** - May need custom ALTER TABLE logic to preserve data
- **Triggers** - May need table name specification
- **Complex renames** - Should be done manually to avoid data loss
- **Data migrations** - Any data transformation logic

## Publishing to npm

```bash
# 1. Update version in package.json
npm version patch  # or minor, major

# 2. Build the package
npm run build

# 3. Test locally with npm link
npm link
pg-ddl-extract --help

# 4. Publish to npm
npm publish --access public

# 5. Or publish to private registry
npm publish --registry https://your-registry.com
```

## Development

```bash
# Install dependencies
npm install

# Build TypeScript
npm run build

# Test locally
npm link
```

## Tips

- Run before each release to capture DB changes
- Use `git diff sql/` to review structural changes between commits
- The `_full_dump.sql` can be used to recreate the schema from scratch
- Use a **readonly** database user for PROD extraction
- Add to CI/CD to auto-snapshot on deploy
- Generate migration plan (`npm run migrate`) before each production deployment
- Keep migration files in version control for audit trail