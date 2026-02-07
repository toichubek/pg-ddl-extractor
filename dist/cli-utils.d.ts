import { Client, ClientConfig } from "pg";
import { TunnelResult } from "./tunnel";
export interface DbCliOptions {
    env?: string;
    host?: string;
    port?: string;
    database?: string;
    user?: string;
    password?: string;
}
export interface DbConnection {
    client: Client;
    config: ClientConfig;
    tunnel: TunnelResult | null;
}
export declare function connectToDatabase(options: DbCliOptions): Promise<DbConnection>;
export declare function closeConnection(conn: DbConnection): Promise<void>;
export declare function handleError(err: any): void;
export declare function runWithConnection(options: DbCliOptions, fn: (client: Client, config: ClientConfig) => Promise<void>): Promise<void>;
