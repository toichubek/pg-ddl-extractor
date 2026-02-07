import { Client } from "pg";
export interface DataExtractionOptions {
    tables: string[];
    maxRows?: number;
    outputDir: string;
}
export declare class DataExtractor {
    private client;
    constructor(client: Client);
    extractData(options: DataExtractionOptions): Promise<void>;
    private parseTableName;
    private tableExists;
    private extractTableData;
    private formatValue;
    private quoteIdent;
}
