import { Client } from "pg";
export type LintSeverity = "error" | "warning" | "info";
export interface LintIssue {
    rule: string;
    severity: LintSeverity;
    object: string;
    message: string;
}
export interface LintResult {
    issues: LintIssue[];
    summary: {
        errors: number;
        warnings: number;
        infos: number;
        tablesChecked: number;
    };
}
export declare class SchemaLinter {
    private client;
    private issues;
    constructor(client: Client);
    lint(): Promise<LintResult>;
    private checkTablesWithoutPK;
    private checkMissingFKIndexes;
    private checkTablesWithoutComments;
    private checkDuplicateIndexes;
    private checkUnusedIndexes;
    private checkSequenceOwnedBy;
    private getTableCount;
    private logRule;
}
export declare function printLintReport(result: LintResult): void;
