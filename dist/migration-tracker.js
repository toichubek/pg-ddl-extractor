"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MigrationTracker = void 0;
class MigrationTracker {
    client;
    tableName;
    constructor(client, tableName = "schema_migrations") {
        this.client = client;
        this.tableName = tableName;
    }
    /** Create the migrations tracking table if it doesn't exist */
    async ensureTable() {
        await this.client.query(`
      CREATE TABLE IF NOT EXISTS ${this.tableName} (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL UNIQUE,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        checksum VARCHAR(64) NOT NULL,
        execution_time_ms INTEGER NOT NULL DEFAULT 0,
        applied_by VARCHAR(255) NOT NULL DEFAULT current_user
      );
    `);
    }
    /** Get all applied migrations */
    async getApplied() {
        await this.ensureTable();
        const { rows } = await this.client.query(`SELECT id, name, applied_at, checksum, execution_time_ms, applied_by
       FROM ${this.tableName}
       ORDER BY id;`);
        return rows;
    }
    /** Check if a specific migration has been applied */
    async isApplied(name) {
        await this.ensureTable();
        const { rows } = await this.client.query(`SELECT 1 FROM ${this.tableName} WHERE name = $1;`, [name]);
        return rows.length > 0;
    }
    /** Record a migration as applied */
    async recordApplied(name, checksum, executionTimeMs) {
        await this.ensureTable();
        await this.client.query(`INSERT INTO ${this.tableName} (name, checksum, execution_time_ms)
       VALUES ($1, $2, $3)
       ON CONFLICT (name) DO UPDATE SET
         checksum = EXCLUDED.checksum,
         applied_at = NOW(),
         execution_time_ms = EXCLUDED.execution_time_ms;`, [name, checksum, executionTimeMs]);
    }
    /** Remove a migration record (for rollback) */
    async recordRolledBack(name) {
        await this.ensureTable();
        await this.client.query(`DELETE FROM ${this.tableName} WHERE name = $1;`, [name]);
    }
    /** Get the last applied migration */
    async getLastApplied() {
        await this.ensureTable();
        const { rows } = await this.client.query(`SELECT id, name, applied_at, checksum, execution_time_ms, applied_by
       FROM ${this.tableName}
       ORDER BY id DESC LIMIT 1;`);
        return rows.length > 0 ? rows[0] : null;
    }
    /** Print migration history to console */
    async printHistory() {
        const records = await this.getApplied();
        console.log("═══════════════════════════════════════════════════════════");
        console.log("  Migration History");
        console.log("═══════════════════════════════════════════════════════════");
        console.log("");
        if (records.length === 0) {
            console.log("  No migrations applied yet.");
            console.log("");
            console.log("═══════════════════════════════════════════════════════════");
            return;
        }
        console.log("  " +
            "#".padEnd(5) +
            "Migration".padEnd(45) +
            "Applied At".padEnd(22) +
            "Time".padEnd(10) +
            "By");
        console.log("  " + "─".repeat(95));
        for (const record of records) {
            const appliedAt = new Date(record.applied_at).toISOString().slice(0, 19).replace("T", " ");
            const timeStr = record.execution_time_ms < 1000
                ? `${record.execution_time_ms}ms`
                : `${(record.execution_time_ms / 1000).toFixed(1)}s`;
            console.log("  " +
                String(record.id).padEnd(5) +
                record.name.padEnd(45) +
                appliedAt.padEnd(22) +
                timeStr.padEnd(10) +
                record.applied_by);
        }
        console.log("");
        console.log(`  Total: ${records.length} migration(s) applied`);
        console.log("");
        console.log("═══════════════════════════════════════════════════════════");
    }
}
exports.MigrationTracker = MigrationTracker;
