# PostgreSQL DDL Extractor

[![npm version](https://badge.fury.io/js/@toichubek%2Fpg-ddl-extractor.svg)](https://www.npmjs.com/package/@toichubek/pg-ddl-extractor)
[![npm downloads](https://img.shields.io/npm/dm/@toichubek/pg-ddl-extractor.svg)](https://www.npmjs.com/package/@toichubek/pg-ddl-extractor)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js Version](https://img.shields.io/node/v/@toichubek/pg-ddl-extractor.svg)](https://nodejs.org)

Extracts full database structure (DDL) from PostgreSQL and organizes it into a clean folder structure for Git version control. Smart change detection ensures files are only written when actual content changes -- re-running extraction won't create noisy git diffs from timestamp-only updates. Includes diffing, migration generation, linting, documentation, and more.

## Quick Start

```bash
npm install -g @toichubek/pg-ddl-extractor
pg-ddl-init                    # Create project structure & .env template
# Edit .env with your database credentials
pg-ddl-extract --env dev       # Extract schema → sql/dev/
```

## Installation

```bash
# Global (recommended)
npm install -g @toichubek/pg-ddl-extractor

# Local
npm install --save-dev @toichubek/pg-ddl-extractor
```

## All Commands

| Command | Description | Output |
|---------|-------------|--------|
| `pg-ddl-extract` | Extract DDL from database | `sql/<env>/` |
| `pg-ddl-diff` | Compare DEV vs PROD schemas | console / `sql/reports/` |
| `pg-ddl-migrate` | Generate migration SQL | `sql/migrations/` |
| `pg-ddl-init` | Initialize project structure | `.env.example`, config, `sql/` |
| `pg-ddl-lint` | Lint schema for common issues | console |
| `pg-ddl-validate` | Validate conventions & consistency | console |
| `pg-ddl-deps` | FK dependency graph & creation order | console / `.mmd` / `.dot` |
| `pg-ddl-size` | Storage size analysis | console / JSON |
| `pg-ddl-stats` | Database statistics overview | console |
| `pg-ddl-search` | Search extracted SQL files | console |
| `pg-ddl-docs` | Generate Markdown documentation | `sql/docs/` |
| `pg-ddl-changelog` | Git-based schema changelog | console / Markdown |
| `pg-ddl-snapshot-diff` | Compare schema between Git refs | console / Markdown |
| `pg-ddl-watch` | Auto re-extract on schema changes | continuous |

## Output Structure

```
sql/
├── dev/                        ← pg-ddl-extract --env dev
│   ├── _full_dump.sql
│   ├── schemas/
│   │   └── public.sql
│   ├── tables/
│   │   ├── public.users.sql
│   │   └── public.orders.sql
│   ├── functions/
│   ├── views/
│   ├── materialized_views/
│   ├── sequences/
│   ├── triggers/
│   ├── types/
│   └── indexes/
├── prod/                       ← pg-ddl-extract --env prod
│   └── ... (same structure)
├── docs/                       ← pg-ddl-docs
│   ├── schema_dev.md
│   └── erd_dev.md
├── reports/                    ← pg-ddl-diff --report
│   └── diff_report.md
└── migrations/                 ← pg-ddl-migrate
    ├── 20260207_120000_dev_to_prod.sql
    └── 20260207_120000_rollback.sql
```

## What Gets Extracted

| Object | Includes |
|--------|----------|
| **Tables** | Columns, PK, FK, UNIQUE, CHECK, defaults, comments |
| **Functions** | Full `CREATE FUNCTION` via `pg_get_functiondef()` |
| **Views** | `CREATE OR REPLACE VIEW` |
| **Materialized Views** | `CREATE MATERIALIZED VIEW` |
| **Sequences** | INCREMENT, MIN, MAX, START, CYCLE |
| **Triggers** | Timing, events, action |
| **Types** | Enum and composite types |
| **Indexes** | Non-constraint indexes only |
| **Schemas** | `CREATE SCHEMA IF NOT EXISTS` |

---

## Core Commands

### pg-ddl-extract

Extract database DDL into organized SQL files.

```bash
pg-ddl-extract --env dev                          # Extract DEV → sql/dev/
pg-ddl-extract --env prod                         # Extract PROD → sql/prod/
pg-ddl-extract --host localhost --database mydb --user postgres

# Filters
pg-ddl-extract --env dev --schema public,auth     # Only specific schemas
pg-ddl-extract --env dev --tables public.users     # Only specific tables
pg-ddl-extract --env dev --exclude-schema test     # Exclude schemas
pg-ddl-extract --env dev --exclude-tables public.logs

# Data export
pg-ddl-extract --env dev --with-data countries,currencies --max-rows 5000

# Formats & modes
pg-ddl-extract --env dev --format json            # Export as JSON
pg-ddl-extract --env dev --incremental            # Only changed objects
pg-ddl-extract --env dev --progress               # Show progress bar
pg-ddl-extract --env dev --output /custom/path    # Custom output
```

**Options:**

| Flag | Description | Default |
|------|-------------|---------|
| `--env <env>` | Environment (dev/prod) | `dev` |
| `--host <host>` | Database host | from .env |
| `--port <port>` | Database port | `5432` |
| `--database <db>` | Database name | from .env |
| `--user <user>` | Database user | from .env |
| `--password <pass>` | Database password | from .env |
| `--output <path>` | Output directory | `sql/<env>` |
| `--schema <list>` | Include schemas (comma-separated) | all |
| `--tables <list>` | Include tables (schema.table) | all |
| `--exclude-schema <list>` | Exclude schemas | none |
| `--exclude-tables <list>` | Exclude tables | none |
| `--with-data <list>` | Tables to export INSERT data | none |
| `--max-rows <n>` | Max rows per data table | `10000` |
| `--format <fmt>` | Output: `sql` or `json` | `sql` |
| `--incremental` | Only re-extract changed objects | off |
| `--progress` | Show progress bar | off |

### pg-ddl-diff

Compare schemas between environments.

```bash
pg-ddl-diff                                       # Compare DEV vs PROD
pg-ddl-diff --report                              # Save markdown + HTML report
pg-ddl-diff --side-by-side                        # Side-by-side HTML diff
pg-ddl-diff --dev /path/to/dev --prod /path/to/prod
pg-ddl-diff --envs dev,staging,prod               # Multi-environment compare
```

**Options:**

| Flag | Description | Default |
|------|-------------|---------|
| `--report` | Save markdown/HTML reports | off |
| `--side-by-side` | Side-by-side HTML diff | off |
| `--sql-dir <path>` | SQL directory | `./sql` |
| `--dev <path>` | Dev schema path | auto |
| `--prod <path>` | Prod schema path | auto |
| `--envs <list>` | Compare multiple envs | dev,prod |

### pg-ddl-migrate

Generate migration SQL from DEV to PROD.

```bash
pg-ddl-migrate                                    # Generate migration
pg-ddl-migrate --with-rollback                    # With rollback script
pg-ddl-migrate --dry-run                          # Preview without saving
pg-ddl-migrate --interactive                      # Review each change
pg-ddl-migrate --pre-check                        # Run health checks first
pg-ddl-migrate --track --database mydb --user postgres  # Track in DB
pg-ddl-migrate --history --database mydb --user postgres  # View history
```

**Options:**

| Flag | Description | Default |
|------|-------------|---------|
| `--sql-dir <path>` | SQL directory | `./sql` |
| `--dev <path>` | Dev schema path | auto |
| `--prod <path>` | Prod schema path | auto |
| `--with-rollback` | Generate rollback script | off |
| `--dry-run` | Preview only | off |
| `--interactive` | Review each change | off |
| `--pre-check` | Health checks before migration | off |
| `--history` | Show migration history | off |
| `--track` | Record migration in DB | off |

### pg-ddl-init

Initialize project structure with config templates.

```bash
pg-ddl-init                                       # Create .env.example, config, sql/
```

---

## Analysis Commands

### pg-ddl-lint

Lint your database schema for common issues and best practices.

```bash
pg-ddl-lint --env dev
pg-ddl-lint --env prod
pg-ddl-lint --host localhost --database mydb --user postgres
```

**Lint Rules:**

| Rule | Severity | Description |
|------|----------|-------------|
| `no-primary-key` | Error | Tables without PRIMARY KEY |
| `missing-fk-index` | Warning | FK columns without index (slow JOINs) |
| `duplicate-index` | Warning | Indexes with identical column sets |
| `unused-index` | Info | Indexes never scanned |
| `no-table-comment` | Info | Tables without COMMENT |
| `unowned-sequence` | Info | Sequences not owned by any column |

Exit code `1` if any errors found (useful for CI/CD).

### pg-ddl-validate

Validate schema consistency and conventions.

```bash
pg-ddl-validate --env dev
pg-ddl-validate --env dev --sql-dir ./sql         # Check files vs live DB
pg-ddl-validate --env dev --strict                # Warnings become errors
pg-ddl-validate --host localhost --database mydb --user postgres
```

**Validation Checks:**

| Check | Severity | Description |
|-------|----------|-------------|
| `no-primary-key` | Error | Tables without PRIMARY KEY |
| `wide-table` | Warning | Tables with >20 columns |
| `no-indexes` | Warning | Tables with no indexes |
| `stale-file` | Warning | Extracted files for removed objects |
| `missing-extract` | Warning | DB objects not in extracted files |
| `vague-column-name` | Info | Generic names like "data", "info" |
| `nullable-fk` | Info | Nullable foreign key columns |

Exit code `1` on errors (or warnings in `--strict` mode).

### pg-ddl-deps

Analyze FK dependencies and get safe table creation order.

```bash
pg-ddl-deps --env dev                             # Show dependency graph
pg-ddl-deps --env dev --order                     # Topological creation order
pg-ddl-deps --env dev --mermaid --output deps.mmd # Mermaid ERD export
pg-ddl-deps --env dev --dot --output deps.dot     # Graphviz DOT export
pg-ddl-deps --host localhost --database mydb --user postgres
```

### pg-ddl-size

Detailed storage analysis by schema, table, and index.

```bash
pg-ddl-size --env dev                             # Full size report
pg-ddl-size --env dev --top 10                    # Top 10 largest
pg-ddl-size --env dev --json --output size.json   # Export as JSON
pg-ddl-size --host localhost --database mydb --user postgres
```

### pg-ddl-stats

Database statistics overview (table counts, sizes, activity).

```bash
pg-ddl-stats --env dev
pg-ddl-stats --env prod
pg-ddl-stats --host localhost --database mydb --user postgres
```

### pg-ddl-search

Search across extracted SQL files with regex support.

```bash
pg-ddl-search "email" --env dev                   # Search for keyword
pg-ddl-search "user_id" -i                        # Case-insensitive
pg-ddl-search "created_at" --category tables      # Only in tables
pg-ddl-search "DEFAULT now\(\)" --env dev         # Regex patterns
pg-ddl-search "FOREIGN KEY" --sql-dir /path/to/sql
```

---

## Documentation Commands

### pg-ddl-docs

Auto-generate Markdown documentation from your database schema.

```bash
pg-ddl-docs --env dev                             # Generate → sql/docs/
pg-ddl-docs --env dev --diagram                   # With Mermaid ERD
pg-ddl-docs --env dev --output ./my-docs          # Custom output
pg-ddl-docs --host localhost --database mydb --user postgres --diagram
```

Generated documentation includes:
- Table of contents with links
- Column details (type, nullable, default, PK/FK, comments)
- Table statistics (row estimate, size)
- Foreign key relationships
- Index definitions
- Views and functions listing
- Optional Mermaid ERD diagram

### pg-ddl-changelog

Generate a changelog from Git history of extracted SQL files.

```bash
pg-ddl-changelog                                  # Recent schema changes
pg-ddl-changelog --env dev                        # Specific environment
pg-ddl-changelog --limit 10                       # Last 10 commits
pg-ddl-changelog --markdown --output CHANGELOG.md # Export as Markdown
pg-ddl-changelog --sql-dir /path/to/sql
```

### pg-ddl-snapshot-diff

Compare schema snapshots between Git commits or tags.

```bash
pg-ddl-snapshot-diff --from abc1234 --to def5678
pg-ddl-snapshot-diff --from v1.0.0 --to v2.0.0
pg-ddl-snapshot-diff --from HEAD~5 --to HEAD --env dev
pg-ddl-snapshot-diff --from main~10 --to main --output snapshot-report.md
```

---

## Automation Commands

### pg-ddl-watch

Automatically re-extract DDL when schema changes are detected.

```bash
pg-ddl-watch --env dev                            # Poll every 30s (default)
pg-ddl-watch --env dev --interval 60              # Custom interval
pg-ddl-watch --host localhost --database mydb --user postgres --interval 15
```

Watch mode:
- Full extraction on startup
- Polls for schema changes at configured interval
- Only re-extracts when changes detected (schema hash)
- Periodic heartbeat messages
- Press `Ctrl+C` to stop

---

## Configuration

### Environment Variables (.env)

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

# Optional: SSH tunnel for PROD
PROD_SSH_HOST=your-server.com
PROD_SSH_PORT=22
PROD_SSH_USER=your_ssh_user
PROD_SSH_KEY_PATH=~/.ssh/id_rsa

# Optional: custom output directory
SQL_OUTPUT_DIR=/path/to/sql
```

**Priority:** CLI flags > Environment variables > .env file

### Configuration File

Create `.pg-ddl-extractor.json` in your project root:

```json
{
  "defaults": {
    "env": "dev",
    "output": "./sql"
  },
  "extract": {
    "excludeSchema": ["test", "temp"],
    "excludeTables": ["public.logs", "public.cache"],
    "maxRows": 5000
  },
  "migration": {
    "withRollback": true
  }
}
```

Supported config files (searched in order):
- `.pg-ddl-extractor.json`
- `.pg-ddl-extractor.yml`
- `.pg-ddl-extractor.yaml`
- `pg-ddl-extractor.config.json`

### Direct Connection

All commands support direct connection flags (no .env needed):

```bash
pg-ddl-extract --host localhost --port 5432 --database mydb --user postgres --password secret
```

---

## Programmatic API

```typescript
import { Client } from "pg";
import {
  SqlFileWriter,
  DdlExtractor,
  compareDdl,
  generateMigration,
  JsonExporter,
  DocsGenerator,
  MigrationTracker,
  SnapshotManager,
  createPool,
  ProgressBar,
} from "@toichubek/pg-ddl-extractor";

// Extract DDL
const client = new Client({ /* config */ });
await client.connect();

const writer = new SqlFileWriter("./sql/dev");
const extractor = new DdlExtractor(client, writer);
await extractor.extractAll();

// Export as JSON
const jsonExporter = new JsonExporter(client);
const schema = await jsonExporter.export();

// Compare environments
const summary = compareDdl("./sql");

// Generate migration
const migration = generateMigration("./sql");
```

---

## Migration Workflow

```bash
# 1. Extract both environments
pg-ddl-extract --env dev
pg-ddl-extract --env prod

# 2. Compare
pg-ddl-diff --report

# 3. Generate migration with rollback
pg-ddl-migrate --with-rollback

# 4. Review generated files
cat sql/migrations/YYYYMMDD_HHmmss_dev_to_prod.sql

# 5. Test on staging, then apply
psql -d your_db -f sql/migrations/YYYYMMDD_HHmmss_dev_to_prod.sql

# 6. If something goes wrong
psql -d your_db -f sql/migrations/YYYYMMDD_HHmmss_rollback.sql
```

### Migration Safety

- Uses `IF EXISTS` for DROP commands
- Uses `CASCADE` where needed
- `BEGIN`/`COMMIT` transaction wrapper
- Complex changes marked with warnings for manual review
- Track history with `--track` flag

---

## CI/CD Integration

```bash
# In your CI pipeline
pg-ddl-lint --env dev              # Fail on schema errors
pg-ddl-validate --env dev --strict # Fail on warnings too
pg-ddl-extract --env dev           # Snapshot schema
pg-ddl-diff                        # Check for drift
```

## Git Workflow

Repeated extractions only update files when the actual DDL changes. Timestamp-only differences are ignored, so `git status` stays clean when nothing changed.

```bash
pg-ddl-extract --env dev       # First run: writes all files
pg-ddl-extract --env dev       # Second run: no files changed, git stays clean

# Only actual schema changes produce git diffs
git add sql/
git commit -m "chore: update database DDL snapshot"
```

## npm Scripts (local install / from source)

```bash
npm run extract:dev       # Extract DEV
npm run extract:prod      # Extract PROD
npm run diff              # Compare
npm run diff:report       # Compare + save reports
npm run migrate           # Generate migration
npm run migrate:rollback  # Migration + rollback
npm run migrate:dry-run   # Preview
npm run schema:lint       # Lint schema
npm run watch:dev         # Watch DEV
npm run docs              # Generate docs
npm run stats             # DB statistics
```

## Smart Change Detection

All output formats (SQL files, JSON export, data dumps) use content-aware change detection. When you re-run extraction:

- Files are **only overwritten** when the actual content (DDL, data) changes
- Embedded timestamps (`-- Extracted:`, `exportedAt`) are **ignored** during comparison
- No unnecessary git diffs from timestamp-only updates
- The extraction summary shows created/updated/unchanged counts

This makes it safe to run extractions frequently (CI/CD, cron, watch mode) without polluting your git history.

## Tips

- Run before each release to capture DB changes
- Use `git diff sql/` to review structural changes
- The `_full_dump.sql` can recreate the schema from scratch
- Use a **readonly** database user for PROD extraction
- Add to CI/CD to auto-snapshot on deploy
- Generate migration plan before each production deployment
- Keep migration files in version control for audit trail
- Safe to run repeated extractions -- only real changes create git diffs
