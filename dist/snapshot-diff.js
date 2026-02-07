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
function getGitDiff(sqlDir, fromRef, toRef) {
    const results = [];
    try {
        const output = (0, child_process_1.execFileSync)("git", ["diff", "--name-status", fromRef, toRef, "--", sqlDir], { encoding: "utf-8", maxBuffer: 10 * 1024 * 1024 }).trim();
        if (!output)
            return results;
        for (const line of output.split("\n")) {
            const parts = line.trim().split("\t");
            if (parts.length < 2)
                continue;
            const statusChar = parts[0];
            const file = parts[parts.length - 1];
            if (!file.endsWith(".sql"))
                continue;
            const fileParts = file.split("/");
            const categories = [
                "schemas", "tables", "functions", "views", "materialized_views",
                "sequences", "triggers", "types", "indexes", "data",
            ];
            let category = "";
            let object = "";
            for (let i = 0; i < fileParts.length - 1; i++) {
                if (categories.includes(fileParts[i])) {
                    category = fileParts[i];
                    object = fileParts[i + 1]?.replace(".sql", "") || "";
                    break;
                }
            }
            if (!category)
                continue;
            const status = statusChar === "A" ? "added" :
                statusChar === "D" ? "deleted" : "modified";
            results.push({ file, category, object, status });
        }
    }
    catch (err) {
        console.error(`❌ Git diff failed: ${err.message}`);
        console.error("   Make sure both refs exist: git log --oneline");
        process.exit(1);
    }
    return results;
}
function printSnapshotDiff(items, fromRef, toRef) {
    console.log("═══════════════════════════════════════════════════════════");
    console.log("  Schema Snapshot Comparison");
    console.log(`  From: ${fromRef}`);
    console.log(`  To:   ${toRef}`);
    console.log("═══════════════════════════════════════════════════════════");
    console.log("");
    const added = items.filter((i) => i.status === "added");
    const modified = items.filter((i) => i.status === "modified");
    const deleted = items.filter((i) => i.status === "deleted");
    console.log(`  🆕 Added:    ${added.length}`);
    console.log(`  🔄 Modified: ${modified.length}`);
    console.log(`  🗑️  Deleted:  ${deleted.length}`);
    console.log("");
    if (items.length === 0) {
        console.log("  🎉 No schema changes between these snapshots!\n");
        console.log("═══════════════════════════════════════════════════════════");
        return;
    }
    // Group by category
    const byCategory = new Map();
    for (const item of items) {
        if (!byCategory.has(item.category))
            byCategory.set(item.category, []);
        byCategory.get(item.category).push(item);
    }
    for (const [category, catItems] of byCategory) {
        console.log(`  📦 ${category}:`);
        for (const item of catItems) {
            const icon = item.status === "added" ? "🆕" :
                item.status === "modified" ? "🔄" : "🗑️";
            console.log(`    ${icon} ${item.object} (${item.status})`);
        }
        console.log("");
    }
    console.log("═══════════════════════════════════════════════════════════");
}
function formatMarkdown(items, fromRef, toRef) {
    const lines = [];
    lines.push("# Schema Snapshot Comparison");
    lines.push("");
    lines.push(`- **From:** \`${fromRef}\``);
    lines.push(`- **To:** \`${toRef}\``);
    lines.push(`- **Generated:** ${new Date().toISOString().slice(0, 19)}`);
    lines.push("");
    const added = items.filter((i) => i.status === "added");
    const modified = items.filter((i) => i.status === "modified");
    const deleted = items.filter((i) => i.status === "deleted");
    lines.push("## Summary");
    lines.push("");
    lines.push(`| Status | Count |`);
    lines.push(`|--------|-------|`);
    lines.push(`| Added | ${added.length} |`);
    lines.push(`| Modified | ${modified.length} |`);
    lines.push(`| Deleted | ${deleted.length} |`);
    lines.push("");
    if (items.length === 0) {
        lines.push("No schema changes between these snapshots.");
        return lines.join("\n");
    }
    lines.push("## Changes");
    lines.push("");
    lines.push("| Category | Object | Status |");
    lines.push("|----------|--------|--------|");
    for (const item of items) {
        lines.push(`| ${item.category} | ${item.object} | ${item.status} |`);
    }
    return lines.join("\n");
}
function parseArgs() {
    commander_1.program
        .name("pg-ddl-snapshot-diff")
        .description("Compare schema snapshots between Git commits or tags")
        .version("1.0.0")
        .requiredOption("--from <ref>", "Git ref to compare from (commit hash, tag, or branch)")
        .requiredOption("--to <ref>", "Git ref to compare to (commit hash, tag, or branch)")
        .option("--sql-dir <path>", "Path to SQL directory")
        .option("--env <environment>", "Environment filter (dev, prod)")
        .option("--output <path>", "Save as Markdown report")
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
    const items = getGitDiff(searchDir, options.from, options.to);
    if (options.output) {
        const md = formatMarkdown(items, options.from, options.to);
        fs.writeFileSync(options.output, md, "utf-8");
        console.log(`📊 Snapshot diff saved to: ${options.output}`);
    }
    else {
        printSnapshotDiff(items, options.from, options.to);
    }
}
main();
