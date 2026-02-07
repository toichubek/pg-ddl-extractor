import { PoolConfig } from "pg";
export interface DbConfig {
    host: string;
    port: number;
    database: string;
    user: string;
    password: string;
}
export declare function getDbConfig(env: string): PoolConfig;
