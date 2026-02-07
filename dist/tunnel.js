"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.createSshTunnel = createSshTunnel;
exports.getSshConfig = getSshConfig;
const net = __importStar(require("net"));
const fs = __importStar(require("fs"));
/**
 * Creates an SSH tunnel:
 *   local machine :localPort  →  SSH server  →  remoteHost:remotePort
 *
 * pg then connects to localhost:localPort
 */
function createSshTunnel(config) {
    // Dynamic import — ssh2 is only loaded when tunnel is actually needed
    let ssh2;
    try {
        ssh2 = require("ssh2");
    }
    catch {
        throw new Error("ssh2 package not installed. Run:\n" +
            "  npm install ssh2 @types/ssh2");
    }
    return new Promise((resolve, reject) => {
        const sshClient = new ssh2.Client();
        let server;
        const sshConfig = {
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
            }
            catch (err) {
                reject(new Error(`Cannot read SSH key: ${config.sshKeyPath} — ${err.message}`));
                return;
            }
        }
        else if (config.sshPassword) {
            sshConfig.password = config.sshPassword;
        }
        else {
            reject(new Error("SSH auth required: set SSH_KEY_PATH or SSH_PASSWORD in .env"));
            return;
        }
        sshClient.on("error", (err) => {
            reject(new Error(`SSH connection failed: ${err.message}`));
        });
        sshClient.on("ready", () => {
            // Create local TCP server that forwards to remote via SSH
            server = net.createServer((localSocket) => {
                sshClient.forwardOut("127.0.0.1", 0, config.remoteHost, config.remotePort, (err, stream) => {
                    if (err) {
                        localSocket.destroy();
                        return;
                    }
                    localSocket.pipe(stream).pipe(localSocket);
                });
            });
            // Listen on random available port
            server.listen(0, "127.0.0.1", () => {
                const addr = server.address();
                const close = () => {
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
function getSshConfig(env) {
    const prefix = env.toUpperCase();
    const sshHost = process.env[`${prefix}_SSH_HOST`];
    if (!sshHost)
        return null; // No SSH — direct connection
    const dbHost = process.env[`${prefix}_DB_HOST`] || "127.0.0.1";
    const dbPort = parseInt(process.env[`${prefix}_DB_PORT`] || "5432", 10);
    return {
        sshHost,
        sshPort: parseInt(process.env[`${prefix}_SSH_PORT`] || "22", 10),
        sshUser: process.env[`${prefix}_SSH_USER`] || "",
        sshPassword: process.env[`${prefix}_SSH_PASSWORD`],
        sshKeyPath: process.env[`${prefix}_SSH_KEY_PATH`],
        sshPassphrase: process.env[`${prefix}_SSH_PASSPHRASE`],
        remoteHost: dbHost,
        remotePort: dbPort,
    };
}
