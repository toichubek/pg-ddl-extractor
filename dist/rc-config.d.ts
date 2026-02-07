export interface RcConfig {
    defaults?: {
        env?: string;
        output?: string;
    };
    environments?: Record<string, {
        host?: string;
        port?: number;
        database?: string;
        user?: string;
        password?: string;
    }>;
    extract?: {
        schema?: string[];
        excludeSchema?: string[];
        tables?: string[];
        excludeTables?: string[];
        withData?: string[];
        maxRows?: number;
    };
    migration?: {
        withRollback?: boolean;
        interactive?: boolean;
    };
    lint?: {
        rules?: Record<string, boolean>;
    };
}
export declare function loadRcConfig(startDir?: string): RcConfig | null;
/**
 * Merge RC config with CLI options. CLI options take precedence.
 */
export declare function mergeWithCliOptions(rcConfig: RcConfig, cliOptions: Record<string, any>): Record<string, any>;
