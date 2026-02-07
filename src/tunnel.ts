import * as net from "net";
import * as fs from "fs";

export interface SshTunnelConfig {
  sshHost: string;
  sshPort: number;
  sshUser: string;
  sshPassword?: string;
  sshKeyPath?: string;
  sshPassphrase?: string;
  // remote DB address (as seen from SSH server)
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
export function createSshTunnel(config: SshTunnelConfig): Promise<TunnelResult> {
  // Dynamic import — ssh2 is only loaded when tunnel is actually needed
  let ssh2: any;
  try {
    ssh2 = require("ssh2");
  } catch {
    throw new Error(
      "ssh2 package not installed. Run:\n" +
      "  npm install ssh2 @types/ssh2"
    );
  }

  return new Promise((resolve, reject) => {
    const sshClient = new ssh2.Client();
    let server: net.Server;

    const sshConfig: Record<string, any> = {
      host: config.sshHost,
      port: config.sshPort,
      username: config.sshUser,
      readyTimeout: 15000,
    };

    // Auth: key file takes priority over password
    if (config.sshKeyPath) {
      try {
        sshConfig.privateKey = fs.readFileSync(config.sshKeyPath);
        if (config.sshPassphrase) {
          sshConfig.passphrase = config.sshPassphrase;
        }
      } catch (err: any) {
        reject(new Error(`Cannot read SSH key: ${config.sshKeyPath} — ${err.message}`));
        return;
      }
    } else if (config.sshPassword) {
      sshConfig.password = config.sshPassword;
    } else {
      reject(new Error("SSH auth required: set SSH_KEY_PATH or SSH_PASSWORD in .env"));
      return;
    }

    sshClient.on("error", (err: Error) => {
      reject(new Error(`SSH connection failed: ${err.message}`));
    });

    sshClient.on("ready", () => {
      // Create local TCP server that forwards to remote via SSH
      server = net.createServer((localSocket) => {
        sshClient.forwardOut(
          "127.0.0.1",
          0,
          config.remoteHost,
          config.remotePort,
          (err: Error | undefined, stream: any) => {
            if (err) {
              localSocket.destroy();
              return;
            }
            localSocket.pipe(stream).pipe(localSocket);
          }
        );
      });

      // Listen on random available port
      server.listen(0, "127.0.0.1", () => {
        const addr = server.address() as net.AddressInfo;

        const close = (): Promise<void> => {
          return new Promise((res) => {
            server.close(() => {
              sshClient.end();
              res();
            });
          });
        };

        resolve({ localPort: addr.port, close });
      });

      server.on("error", (err) => {
        reject(new Error(`Tunnel server error: ${err.message}`));
      });
    });

    sshClient.connect(sshConfig);
  });
}

/**
 * Read SSH config from environment variables for a given env prefix
 * Returns null if no SSH config is set (direct connection)
 */
export function getSshConfig(env: string): SshTunnelConfig | null {
  const prefix = env.toUpperCase();

  const sshHost = process.env[`${prefix}_SSH_HOST`];
  if (!sshHost) return null; // No SSH — direct connection

  const dbHost = process.env[`${prefix}_DB_HOST`] || "127.0.0.1";
  const dbPort = parseInt(process.env[`${prefix}_DB_PORT`] || "5432", 10);
  const sshPort = parseInt(process.env[`${prefix}_SSH_PORT`] || "22", 10);

  // Validate port numbers
  if (isNaN(dbPort) || dbPort < 1 || dbPort > 65535) {
    throw new Error(
      `Invalid database port in ${prefix}_DB_PORT: "${process.env[`${prefix}_DB_PORT`]}". Port must be between 1 and 65535`
    );
  }

  if (isNaN(sshPort) || sshPort < 1 || sshPort > 65535) {
    throw new Error(
      `Invalid SSH port in ${prefix}_SSH_PORT: "${process.env[`${prefix}_SSH_PORT`]}". Port must be between 1 and 65535`
    );
  }

  return {
    sshHost,
    sshPort,
    sshUser: process.env[`${prefix}_SSH_USER`] || "",
    sshPassword: process.env[`${prefix}_SSH_PASSWORD`],
    sshKeyPath: process.env[`${prefix}_SSH_KEY_PATH`],
    sshPassphrase: process.env[`${prefix}_SSH_PASSPHRASE`],
    remoteHost: dbHost,
    remotePort: dbPort,
  };
}