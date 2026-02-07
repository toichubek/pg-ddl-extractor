import { Client } from "pg";
import { SqlFileWriter } from "./writer";
export declare class DdlExtractor {
    private client;
    private writer;
    private allDdl;
    constructor(client: Client, writer: SqlFileWriter);
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
    private save;
    private log;
}
