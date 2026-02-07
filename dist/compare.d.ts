interface DiffItem {
    category: string;
    object: string;
    status: "only_dev" | "only_prod" | "modified";
    devFile?: string;
    prodFile?: string;
    diff?: string[];
}
interface DiffSummary {
    total_dev: number;
    total_prod: number;
    only_dev: number;
    only_prod: number;
    modified: number;
    identical: number;
    items: DiffItem[];
}
export declare function compareDdl(sqlRoot: string): DiffSummary;
export declare function formatConsoleReport(summary: DiffSummary): string;
export declare function formatMarkdownReport(summary: DiffSummary): string;
export declare function formatHtmlReport(summary: DiffSummary): string;
export {};
