import { Client } from "pg";
import { ExtractionFilters } from "./extractor";
export interface SchemaJson {
    metadata: {
        exportedAt: string;
        database: string;
        version: string;
    };
    schemas: string[];
    types: TypeJson[];
    sequences: SequenceJson[];
    tables: TableJson[];
    views: ViewJson[];
    materializedViews: ViewJson[];
    functions: FunctionJson[];
    triggers: TriggerJson[];
    indexes: IndexJson[];
}
interface TypeJson {
    schema: string;
    name: string;
    type: "enum" | "composite";
    labels?: string[];
    attributes?: string;
}
interface SequenceJson {
    schema: string;
    name: string;
    startValue: string;
    minValue: string;
    maxValue: string;
    increment: string;
    cycle: boolean;
}
interface ColumnJson {
    name: string;
    type: string;
    nullable: boolean;
    default: string | null;
    comment: string | null;
}
interface ConstraintJson {
    name: string;
    type: "PRIMARY KEY" | "UNIQUE" | "FOREIGN KEY" | "CHECK";
    columns: string;
    refTable?: string;
    refColumns?: string;
    updateRule?: string;
    deleteRule?: string;
    checkClause?: string;
}
interface TableJson {
    schema: string;
    name: string;
    columns: ColumnJson[];
    constraints: ConstraintJson[];
    comment: string | null;
    rowEstimate?: number;
    size?: string;
}
interface ViewJson {
    schema: string;
    name: string;
    definition: string;
}
interface FunctionJson {
    schema: string;
    name: string;
    definition: string;
}
interface TriggerJson {
    schema: string;
    name: string;
    table: string;
    timing: string;
    events: string[];
    orientation: string;
    action: string;
}
interface IndexJson {
    schema: string;
    name: string;
    definition: string;
}
export declare class JsonExporter {
    private client;
    private filters;
    constructor(client: Client, filters?: ExtractionFilters);
    export(): Promise<SchemaJson>;
    exportToFile(outputDir: string): Promise<string>;
    private shouldIncludeSchema;
    private shouldIncludeTable;
    private extractSchemas;
    private extractTypes;
    private extractSequences;
    private extractTables;
    private buildTableJson;
    private buildColumnType;
    private extractViews;
    private extractMaterializedViews;
    private extractFunctions;
    private extractTriggers;
    private extractIndexes;
}
export {};
