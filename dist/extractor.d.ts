import { Client } from "pg";
import { SqlFileWriter } from "./writer";
export interface ExtractionFilters {
    includeSchemas?: string[];
    includeTables?: string[];
    excludeSchemas?: string[];
    excludeTables?: string[];
}
export declare class DdlExtractor {
    private client;
    private writer;
    private allDdl;
    private filters;
    private showProgress;
    constructor(client: Client, writer: SqlFileWriter, filters?: ExtractionFilters, showProgress?: boolean);
    /** Run full extraction */
    extractAll(): Promise<void>;
    private extractSchemas;
    private extractTypes;
    private extractSequences;
    private extractTables;
    private buildTableDdl;
    private buildColumnType;
    private extractViews;
    private extractMaterializedViews;
    private extractFunctions;
    private extractTriggers;
    private extractIndexes;
    /**
     * Check if a schema should be included based on filters
     */
    private shouldIncludeSchema;
    /**
     * Check if a table should be included based on filters
     */
    private shouldIncludeTable;
    private save;
    private log;
}
