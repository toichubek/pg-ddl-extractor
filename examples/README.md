# Examples

This directory contains usage examples for `@toichubek/pg-ddl-extractor`.

## Quick Start

### 1. Using .env File (Recommended)

Copy the example .env file and fill in your credentials:

```bash
cp .env.example .env
# Edit .env with your database credentials
```

Then run:

```bash
# Extract dev database
pg-ddl-extract --env dev

# Extract prod database
pg-ddl-extract --env prod

# Compare the two
pg-ddl-diff

# Generate migration
pg-ddl-migrate
```

### 2. Using CLI Flags (No .env Needed)

```bash
pg-ddl-extract \
  --host localhost \
  --database mydb \
  --user postgres \
  --password secret \
  --output ./sql/dev
```

### 3. Programmatic Usage

```javascript
// example-script.js
const { Client } = require('pg');
const { SqlFileWriter, DdlExtractor } = require('@toichubek/pg-ddl-extractor');

async function extractDatabase() {
  const client = new Client({
    host: 'localhost',
    database: 'mydb',
    user: 'postgres',
    password: 'secret'
  });

  await client.connect();

  const writer = new SqlFileWriter('./output');
  const extractor = new DdlExtractor(client, writer);

  await extractor.extractAll();

  await client.end();

  console.log('Extraction complete!');
}

extractDatabase().catch(console.error);
```

## File Examples

- **`basic-usage.sh`** - Shell script showing common usage patterns
- **`.env.example`** - Example environment configuration
- **`README.md`** - This file

## Common Workflows

### Workflow 1: Track Database Changes in Git

```bash
# Extract current state
pg-ddl-extract --env dev

# Re-running is safe -- only files with actual DDL changes are updated
# Timestamps are ignored, so git stays clean when nothing changed
pg-ddl-extract --env dev   # no git diff if schema hasn't changed

# Commit to git
git add sql/
git commit -m "chore: update database schema"
```

### Workflow 2: Sync Dev → Prod

```bash
# Extract both environments
pg-ddl-extract --env dev
pg-ddl-extract --env prod

# Compare
pg-ddl-diff --report

# Generate migration
pg-ddl-migrate

# Review the migration file
cat sql/migrations/YYYYMMDD_HHmmss_dev_to_prod.sql

# Apply to prod (carefully!)
psql -h prod-host -U user -d database -f sql/migrations/YYYYMMDD_HHmmss_dev_to_prod.sql
```

### Workflow 3: CI/CD Integration

```yaml
# .github/workflows/db-snapshot.yml
name: Database Snapshot
on:
  schedule:
    - cron: '0 0 * * *'  # Daily at midnight
  workflow_dispatch:

jobs:
  snapshot:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3

      - name: Setup Node.js
        uses: actions/setup-node@v3
        with:
          node-version: '18'

      - name: Install pg-ddl-extractor
        run: npm install -g @toichubek/pg-ddl-extractor

      - name: Extract database schema
        env:
          DEV_DB_HOST: ${{ secrets.DB_HOST }}
          DEV_DB_NAME: ${{ secrets.DB_NAME }}
          DEV_DB_USER: ${{ secrets.DB_USER }}
          DEV_DB_PASSWORD: ${{ secrets.DB_PASSWORD }}
        run: pg-ddl-extract --env dev

      - name: Commit changes
        run: |
          git config user.name "GitHub Actions"
          git config user.email "actions@github.com"
          git add sql/
          git commit -m "chore: daily database snapshot" || echo "No changes"
          git push
```

## Tips

- Use a **read-only** user for production databases
- Always **review** migration files before running on production
- Store `.env` files securely (never commit to git)
- Use SSH tunnels for secure remote connections
- Run extractions before each deployment to track changes
- Safe to run repeatedly -- only actual content changes produce git diffs (timestamps are ignored)

## Need Help?

- 📚 [Full Documentation](https://github.com/toichubek/pg-ddl-extractor#readme)
- 🐛 [Report Issues](https://github.com/toichubek/pg-ddl-extractor/issues)
- 💬 [Discussions](https://github.com/toichubek/pg-ddl-extractor/discussions)
