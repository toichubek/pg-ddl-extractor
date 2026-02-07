import { Client } from "pg";
export interface MigrationRecord {
    id: number;
    name: string;
    applied_at: string;
    checksum: string;
    execution_time_ms: number;
    applied_by: string;
}
export declare class MigrationTracker {
    private client;
    private tableName;
    constructor(client: Client, tableName?: string);
    /** Create the migrations tracking table if it doesn't exist */
    ensureTable(): Promise<void>;
    /** Get all applied migrations */
    getApplied(): Promise<MigrationRecord[]>;
    /** Check if a specific migration has been applied */
    isApplied(name: string): Promise<boolean>;
    /** Record a migration as applied */
    recordApplied(name: string, checksum: string, executionTimeMs: number): Promise<void>;
    /** Remove a migration record (for rollback) */
    recordRolledBack(name: string): Promise<void>;
    /** Get the last applied migration */
    getLastApplied(): Promise<MigrationRecord | null>;
    /** Print migration history to console */
    printHistory(): Promise<void>;
}
