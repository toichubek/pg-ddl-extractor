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
export declare function generateMigration(sqlRoot: string): Migration;
export declare function formatMigrationSql(migration: Migration): string;
export declare function saveMigration(sqlRoot: string, migration: Migration): string;
export declare function printMigrationSummary(migration: Migration, filepath: string): void;
export {};
