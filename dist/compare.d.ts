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
export declare function compareDdlDirs(dir1: string, dir2: string): DiffSummary;
export interface MultiEnvResult {
    envs: string[];
    pairs: {
        env1: string;
        env2: string;
        identical: number;
        onlyFirst: number;
        onlySecond: number;
        modified: number;
        total1: number;
        total2: number;
    }[];
}
export declare function compareMultiEnv(sqlRoot: string, envNames: string[]): MultiEnvResult;
export declare function formatMultiEnvReport(result: MultiEnvResult): string;
export declare function formatConsoleReport(summary: DiffSummary): string;
export declare function formatMarkdownReport(summary: DiffSummary): string;
export declare function formatSideBySideHtml(summary: DiffSummary): string;
export declare function formatHtmlReport(summary: DiffSummary): string;
export {};
