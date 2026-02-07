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
exports.getDbConfig = getDbConfig;
const dotenv = __importStar(require("dotenv"));
// ─── Load .env ────────────────────────────────────────────────────
dotenv.config();
function getDbConfig(env) {
    const prefix = env.toUpperCase(); // DEV or PROD
    const host = process.env[`${prefix}_DB_HOST`];
    const port = process.env[`${prefix}_DB_PORT`];
    const database = process.env[`${prefix}_DB_NAME`];
    const user = process.env[`${prefix}_DB_USER`];
    const password = process.env[`${prefix}_DB_PASSWORD`];
    if (!host || !database || !user) {
        throw new Error(`Missing DB config for env "${env}". ` +
            `Expected ${prefix}_DB_HOST, ${prefix}_DB_NAME, ${prefix}_DB_USER in .env`);
    }
    return {
        host,
        port: port ? parseInt(port, 10) : 5432,
        database,
        user,
        password: password || "",
        // safe defaults
        connectionTimeoutMillis: 10000,
        query_timeout: 30000,
    };
}
