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
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const commander_1 = require("commander");
const child_process_1 = require("child_process");
function getGitLog(sqlDir, limit) {
    const entries = [];
    try {
        // Get git log for the sql directory with file changes
        const logOutput = (0, child_process_1.execFileSync)("git", ["log", `--pretty=format:%H|%ai|%an|%s`, "--name-status", "-n", String(limit), "--", sqlDir], { encoding: "utf-8", maxBuffer: 10 * 1024 * 1024 }).trim();
        if (!logOutput)
            return entries;
        const commits = logOutput.split("\n\n");
        for (const commit of commits) {
            const lines = commit.trim().split("\n");
            if (lines.length === 0 || !lines[0].includes("|"))
                continue;
            const [hash, date, author, ...messageParts] = lines[0].split("|");
            const message = messageParts.join("|");
            const files = [];
            for (let i = 1; i < lines.length; i++) {
                const line = lines[i].trim();
                if (!line)
                    continue;
                const parts = line.split("\t");
                if (parts.length >= 2) {
                    files.push({
                        status: parts[0],
                        file: parts[1],
                    });
                }
            }
            if (files.length > 0) {
                entries.push({
                    date: date.slice(0, 10),
                    hash: hash.slice(0, 7),
                    author,
                    message,
                    files,
                });
            }
        }
    }
    catch {
        // Not a git repo or git not available
    }
    return entries;
}
function categorizeFile(file) {
    // Parse sql/dev/tables/public.users.sql -> category=tables, object=public.users
    const parts = file.split("/");
    const categories = [
        "schemas", "tables", "functions", "views", "materialized_views",
        "sequences", "triggers", "types", "indexes", "data",
    ];
    for (let i = 0; i < parts.length - 1; i++) {
        if (categories.includes(parts[i])) {
            const object = parts[i + 1]?.replace(".sql", "") || "";
            return { category: parts[i], object };
        }
    }
    return null;
}
function formatConsoleChangelog(entries) {
    const lines = [];
    lines.push("═══════════════════════════════════════════════════════════");
    lines.push("  Schema Changelog");
    lines.push("═══════════════════════════════════════════════════════════");
    lines.push("");
    if (entries.length === 0) {
        lines.push("  No schema changes found in Git history.");
        lines.push("");
        lines.push("═══════════════════════════════════════════════════════════");
        return lines.join("\n");
    }
    const statusIcon = {
        A: "🆕",
        M: "🔄",
        D: "🗑️",
        R: "📝",
    };
    for (const entry of entries) {
        lines.push(`  ${entry.date} [${entry.hash}] ${entry.author}`);
        lines.push(`  ${entry.message}`);
        const byCategory = new Map();
        for (const f of entry.files) {
            const parsed = categorizeFile(f.file);
            if (parsed) {
                if (!byCategory.has(parsed.category))
                    byCategory.set(parsed.category, []);
                byCategory.get(parsed.category).push({ status: f.status, object: parsed.object });
            }
        }
        for (const [category, items] of byCategory) {
            for (const item of items) {
                const icon = statusIcon[item.status] || "📄";
                const action = item.status === "A" ? "added" :
                    item.status === "M" ? "modified" :
                        item.status === "D" ? "deleted" : "changed";
                lines.push(`    ${icon} [${category}] ${item.object} (${action})`);
            }
        }
        lines.push("");
    }
    lines.push("═══════════════════════════════════════════════════════════");
    return lines.join("\n");
}
function formatMarkdownChangelog(entries) {
    const lines = [];
    lines.push("# Schema Changelog");
    lines.push("");
    lines.push(`Generated: ${new Date().toISOString().slice(0, 19)}`);
    lines.push("");
    if (entries.length === 0) {
        lines.push("No schema changes found in Git history.");
        return lines.join("\n");
    }
    const statusLabel = {
        A: "Added",
        M: "Modified",
        D: "Deleted",
        R: "Renamed",
    };
    // Group by date
    const byDate = new Map();
    for (const entry of entries) {
        if (!byDate.has(entry.date))
            byDate.set(entry.date, []);
        byDate.get(entry.date).push(entry);
    }
    for (const [date, dayEntries] of byDate) {
        lines.push(`## ${date}`);
        lines.push("");
        for (const entry of dayEntries) {
            lines.push(`### ${entry.message} (\`${entry.hash}\`)`);
            lines.push("");
            lines.push(`*by ${entry.author}*`);
            lines.push("");
            for (const f of entry.files) {
                const parsed = categorizeFile(f.file);
                if (parsed) {
                    const action = statusLabel[f.status] || "Changed";
                    lines.push(`- **${action}** \`[${parsed.category}]\` ${parsed.object}`);
                }
            }
            lines.push("");
        }
    }
    return lines.join("\n");
}
function parseArgs() {
    commander_1.program
        .name("pg-ddl-changelog")
        .description("Generate schema changelog from Git history")
        .version("1.0.0")
        .option("--sql-dir <path>", "Path to SQL directory")
        .option("--env <environment>", "Environment filter (dev, prod)")
        .option("--limit <number>", "Max number of commits to show", "20")
        .option("--output <path>", "Output file path")
        .option("--markdown", "Output as Markdown format")
        .parse(process.argv);
    return commander_1.program.opts();
}
function main() {
    const options = parseArgs();
    const sqlRoot = options.sqlDir
        ? path.resolve(options.sqlDir)
        : process.env.SQL_OUTPUT_DIR
            ? path.resolve(process.env.SQL_OUTPUT_DIR)
            : path.resolve(__dirname, "..", "..", "sql");
    const searchDir = options.env ? path.join(sqlRoot, options.env) : sqlRoot;
    if (!fs.existsSync(searchDir)) {
        console.error(`❌ Directory not found: ${searchDir}`);
        process.exit(1);
    }
    const limit = parseInt(options.limit || "20", 10);
    const entries = getGitLog(searchDir, limit);
    let output;
    if (options.markdown) {
        output = formatMarkdownChangelog(entries);
    }
    else {
        output = formatConsoleChangelog(entries);
    }
    if (options.output) {
        fs.writeFileSync(options.output, output, "utf-8");
        console.log(`📋 Changelog saved to: ${options.output}`);
    }
    else {
        console.log(output);
    }
}
main();
