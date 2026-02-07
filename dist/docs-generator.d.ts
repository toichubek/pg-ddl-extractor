import { Client } from "pg";
export interface SchemaDoc {
    dbName: string;
    dbVersion: string;
    schemas: SchemaInfo[];
    generatedAt: string;
}
interface SchemaInfo {
    name: string;
    tables: TableInfo[];
    views: string[];
    functions: string[];
}
interface TableInfo {
    name: string;
    comment: string | null;
    rowEstimate: number;
    sizeEstimate: string;
    columns: ColumnInfo[];
    indexes: string[];
    fks: string[];
}
interface ColumnInfo {
    name: string;
    type: string;
    nullable: boolean;
    defaultValue: string | null;
    comment: string | null;
    isPK: boolean;
    isFK: boolean;
}
export declare class DocsGenerator {
    private client;
    constructor(client: Client);
    generate(): Promise<SchemaDoc>;
    private getDbInfo;
    private getSchemas;
    private getTablesInfo;
    private getColumns;
    private getIndexes;
    private getForeignKeys;
    private getTableComment;
    private getTableStats;
    private getViews;
    private getFunctions;
}
export declare function formatDocsMarkdown(doc: SchemaDoc): string;
export declare function formatDocsMermaid(doc: SchemaDoc): string;
export {};
