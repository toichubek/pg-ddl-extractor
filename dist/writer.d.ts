/** Object categories mapped to folder names */
export type ObjectCategory = "schemas" | "tables" | "functions" | "views" | "materialized_views" | "sequences" | "triggers" | "types" | "indexes";
export declare class SqlFileWriter {
    private baseDir;
    private counts;
    private unchanged;
    private updated;
    private created;
    constructor(baseDir: string);
    /** Write a single DDL file (only if changed) */
    write(category: ObjectCategory, objectName: string, ddl: string): string;
    /** Write a combined full dump file (only if changed) */
    writeFull(allDdl: string): string;
    /** Get extraction summary */
    getSummary(): Record<string, number>;
    /** Get change statistics */
    getChangeStats(): {
        created: number;
        updated: number;
        unchanged: number;
    };
}
