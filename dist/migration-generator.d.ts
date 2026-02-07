interface MigrationCommand {
    category: string;
    object: string;
    sql: string;
    priority: number;
    comment: string;
}
interface Migration {
    timestamp: string;
    commands: MigrationCommand[];
    summary: {
        creates: number;
        drops: number;
        alters: number;
    };
}
interface RollbackCommand {
    category: string;
    object: string;
    sql: string;
    priority: number;
    comment: string;
}
interface Rollback {
    timestamp: string;
    commands: RollbackCommand[];
    migrationFile: string;
}
export declare function generateMigration(sqlRoot: string): Migration;
export declare function generateRollback(sqlRoot: string, migration: Migration): Rollback;
export declare function formatRollbackSql(rollback: Rollback): string;
export declare function saveRollback(sqlRoot: string, rollback: Rollback): string;
export declare function formatMigrationSql(migration: Migration): string;
export declare function saveMigration(sqlRoot: string, migration: Migration): string;
export declare function printMigrationSummary(migration: Migration, filepath: string, rollbackPath?: string): void;
export {};
