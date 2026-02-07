#!/bin/bash

# ═══════════════════════════════════════════════════════════════════
#  Selective Extraction Examples
# ═══════════════════════════════════════════════════════════════════

echo "📦 Selective Extraction Examples"
echo ""

# ─── Extract only specific schemas ───────────────────────────────────
echo "1️⃣  Extract only 'public' and 'auth' schemas:"
echo "   pg-ddl-extract --env dev --schema public,auth"
echo ""

# ─── Extract only specific tables ────────────────────────────────────
echo "2️⃣  Extract only specific tables:"
echo "   pg-ddl-extract --env dev --tables public.users,public.orders,auth.sessions"
echo ""

# ─── Exclude specific schemas ────────────────────────────────────────
echo "3️⃣  Exclude test and temporary schemas:"
echo "   pg-ddl-extract --env dev --exclude-schema test,temp,staging"
echo ""

# ─── Exclude specific tables ─────────────────────────────────────────
echo "4️⃣  Exclude log and cache tables:"
echo "   pg-ddl-extract --env dev --exclude-tables public.logs,public.cache,public.sessions"
echo ""

# ─── Combine filters ─────────────────────────────────────────────────
echo "5️⃣  Extract 'public' schema but exclude logs:"
echo "   pg-ddl-extract --env dev --schema public --exclude-tables public.logs,public.audit_logs"
echo ""

# ─── Programmatic API example ────────────────────────────────────────
echo "6️⃣  Programmatic API with filters:"
cat << 'EOF'
import { Client } from "pg";
import { SqlFileWriter, DdlExtractor, ExtractionFilters } from "@toichubek/pg-ddl-extractor";

const client = new Client({
  host: "localhost",
  database: "mydb",
  user: "postgres",
  password: "secret"
});

await client.connect();

const filters: ExtractionFilters = {
  includeSchemas: ["public", "auth"],
  excludeTables: ["public.logs", "public.cache"]
};

const writer = new SqlFileWriter("./sql/dev");
const extractor = new DdlExtractor(client, writer, filters);
await extractor.extractAll();

await client.end();
EOF
echo ""

# ─── Use cases ───────────────────────────────────────────────────────
echo "💡 Common Use Cases:"
echo ""
echo "   • Large databases - extract only relevant schemas"
echo "   • Exclude temporary/test data - keep production clean"
echo "   • Microservices - extract specific service schemas"
echo "   • Testing - extract subset for local development"
echo "   • Documentation - extract public API schemas only"
echo ""
