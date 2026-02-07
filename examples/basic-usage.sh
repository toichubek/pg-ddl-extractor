#!/bin/bash
# Basic usage examples for pg-ddl-extractor

echo "=== PostgreSQL DDL Extractor - Basic Usage Examples ==="
echo ""

# Example 1: Using .env file
echo "Example 1: Extract using .env file"
echo "-------------------------------------"
echo "1. Create .env file with your database credentials:"
echo "   DEV_DB_HOST=localhost"
echo "   DEV_DB_NAME=mydb"
echo "   DEV_DB_USER=postgres"
echo "   DEV_DB_PASSWORD=secret"
echo ""
echo "2. Run extraction:"
echo "   pg-ddl-extract --env dev"
echo ""

# Example 2: Using CLI flags
echo "Example 2: Extract using CLI flags (no .env needed)"
echo "----------------------------------------------------"
echo "pg-ddl-extract \\"
echo "  --host localhost \\"
echo "  --database mydb \\"
echo "  --user postgres \\"
echo "  --password secret \\"
echo "  --output ./output/dev"
echo ""

# Example 3: Compare environments
echo "Example 3: Compare dev and prod schemas"
echo "----------------------------------------"
echo "# First extract both environments"
echo "pg-ddl-extract --env dev"
echo "pg-ddl-extract --env prod"
echo ""
echo "# Then compare"
echo "pg-ddl-diff"
echo ""
echo "# Generate detailed reports"
echo "pg-ddl-diff --report"
echo ""

# Example 4: Generate migration
echo "Example 4: Generate migration script"
echo "-------------------------------------"
echo "# After extracting both dev and prod"
echo "pg-ddl-migrate"
echo ""
echo "# This creates: sql/migrations/YYYYMMDD_HHmmss_dev_to_prod.sql"
echo ""

# Example 5: Custom directories
echo "Example 5: Using custom directories"
echo "------------------------------------"
echo "pg-ddl-extract --env dev --output /custom/path/dev"
echo "pg-ddl-diff --dev /custom/path/dev --prod /custom/path/prod"
echo ""

# Example 6: Environment variables
echo "Example 6: Using environment variables"
echo "---------------------------------------"
echo "export SQL_OUTPUT_DIR=/my/sql/output"
echo "export DEV_DB_HOST=localhost"
echo "export DEV_DB_NAME=mydb"
echo "pg-ddl-extract --env dev"
echo ""

echo "=== For more information, visit: ==="
echo "📦 npm: https://www.npmjs.com/package/@toichubek/pg-ddl-extractor"
echo "📚 GitHub: https://github.com/toichubek/pg-ddl-extractor"
