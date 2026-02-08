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
exports.SqlFileWriter = void 0;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const crypto = __importStar(require("crypto"));
/** Sanitize a name for safe filesystem usage */
function sanitize(name) {
    return name.replace(/[^\w.\-]/g, "_");
}
/** Build the header comment for each .sql file */
function buildHeader(objectName, category) {
    const now = new Date().toISOString().replace("T", " ").slice(0, 19);
    return [
        "-- =============================================================",
        `-- Object:    ${objectName}`,
        `-- Type:      ${category.toUpperCase()}`,
        `-- Extracted: ${now}`,
        "-- =============================================================",
        "",
        "",
    ].join("\n");
}
/** Calculate hash of content, ignoring the Extracted timestamp line */
function contentHash(content) {
    const normalized = content
        .split("\n")
        .filter((l) => !l.startsWith("-- Extracted:"))
        .map((l) => l.trimEnd())
        .filter((l) => l.trim() !== "")
        .join("\n");
    return crypto.createHash("md5").update(normalized).digest("hex");
}
class SqlFileWriter {
    baseDir;
    counts = {};
    unchanged = 0;
    updated = 0;
    created = 0;
    constructor(baseDir) {
        this.baseDir = baseDir;
        // Create the output dir if it doesn't exist (don't delete!)
        fs.mkdirSync(baseDir, { recursive: true });
    }
    /** Write a single DDL file (only if changed) */
    write(category, objectName, ddl) {
        const folder = path.join(this.baseDir, category);
        fs.mkdirSync(folder, { recursive: true });
        const filename = `${sanitize(objectName)}.sql`;
        const filepath = path.join(folder, filename);
        const newContent = buildHeader(objectName, category) + ddl.trimEnd() + "\n";
        // Check if file exists and compare content (ignoring header)
        let shouldWrite = true;
        if (fs.existsSync(filepath)) {
            const existingContent = fs.readFileSync(filepath, "utf-8");
            const existingHash = contentHash(existingContent);
            const newHash = contentHash(newContent);
            if (existingHash === newHash) {
                // Content unchanged - skip writing
                shouldWrite = false;
                this.unchanged++;
            }
            else {
                // Content changed - will update
                this.updated++;
            }
        }
        else {
            // New file
            this.created++;
        }
        if (shouldWrite) {
            fs.writeFileSync(filepath, newContent, "utf-8");
        }
        this.counts[category] = (this.counts[category] || 0) + 1;
        return filepath;
    }
    /** Write a combined full dump file (only if changed) */
    writeFull(allDdl) {
        const filepath = path.join(this.baseDir, "_full_dump.sql");
        const header = [
            "-- =============================================================",
            `-- FULL DATABASE DDL DUMP`,
            `-- Extracted: ${new Date().toISOString()}`,
            "-- =============================================================",
            "",
            "",
        ].join("\n");
        const newContent = header + allDdl;
        // Check if file exists and compare content (ignoring header)
        if (fs.existsSync(filepath)) {
            const existingContent = fs.readFileSync(filepath, "utf-8");
            const existingHash = contentHash(existingContent);
            const newHash = contentHash(newContent);
            if (existingHash === newHash) {
                // Content unchanged - skip writing
                return filepath;
            }
        }
        fs.writeFileSync(filepath, newContent, "utf-8");
        return filepath;
    }
    /** Get extraction summary */
    getSummary() {
        return { ...this.counts };
    }
    /** Get change statistics */
    getChangeStats() {
        return {
            created: this.created,
            updated: this.updated,
            unchanged: this.unchanged,
        };
    }
}
exports.SqlFileWriter = SqlFileWriter;
