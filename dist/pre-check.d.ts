import { Client } from "pg";
export interface PreCheckResult {
    checks: CheckItem[];
    passed: boolean;
}
interface CheckItem {
    name: string;
    status: "pass" | "warn" | "fail";
    message: string;
    detail?: string;
}
export declare class PreMigrationChecker {
    private client;
    constructor(client: Client);
    runChecks(): Promise<PreCheckResult>;
    private checkActiveConnections;
    private checkActiveLocks;
    private checkRunningQueries;
    private checkReplicationLag;
    private checkDiskSpace;
    private checkTableBloat;
}
export declare function printPreCheckReport(result: PreCheckResult): void;
export {};
