import { Client } from "pg";
/**
 * Manages incremental snapshots by tracking per-object hashes.
 * On subsequent runs, only objects whose hash changed are re-extracted.
 */
export declare class SnapshotManager {
    private metaFile;
    private meta;
    constructor(outputDir: string);
    /** Load existing snapshot metadata */
    private load;
    /** Get last snapshot timestamp */
    getLastTimestamp(): string | null;
    /** Check if an object has changed since the last snapshot */
    hasChanged(objectKey: string, currentHash: string): boolean;
    /** Save snapshot metadata */
    save(database: string, objectHashes: Record<string, string>): void;
    /** Get a summary of changes */
    getChangeSummary(newHashes: Record<string, string>): {
        added: string[];
        modified: string[];
        removed: string[];
        unchanged: string[];
    };
}
/**
 * Query per-object hashes from the database.
 * Each object gets a hash based on its DDL definition.
 */
export declare function getObjectHashes(client: Client): Promise<Record<string, string>>;
