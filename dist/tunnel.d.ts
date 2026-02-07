export interface SshTunnelConfig {
    sshHost: string;
    sshPort: number;
    sshUser: string;
    sshPassword?: string;
    sshKeyPath?: string;
    sshPassphrase?: string;
    remoteHost: string;
    remotePort: number;
}
export interface TunnelResult {
    localPort: number;
    close: () => Promise<void>;
}
/**
 * Creates an SSH tunnel:
 *   local machine :localPort  →  SSH server  →  remoteHost:remotePort
 *
 * pg then connects to localhost:localPort
 */
export declare function createSshTunnel(config: SshTunnelConfig): Promise<TunnelResult>;
/**
 * Read SSH config from environment variables for a given env prefix
 * Returns null if no SSH config is set (direct connection)
 */
export declare function getSshConfig(env: string): SshTunnelConfig | null;
