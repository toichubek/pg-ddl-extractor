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
const dotenv = __importStar(require("dotenv"));
const commander_1 = require("commander");
dotenv.config();
function searchFiles(dir, pattern, category, ignoreCase) {
    const results = [];
    if (!fs.existsSync(dir))
        return results;
    const categories = fs
        .readdirSync(dir, { withFileTypes: true })
        .filter((d) => d.isDirectory() && d.name !== "data" && d.name !== "reports")
        .map((d) => d.name);
    const regex = new RegExp(pattern, ignoreCase ? "i" : "");
    for (const cat of categories) {
        if (category && cat !== category)
            continue;
        const catDir = path.join(dir, cat);
        if (!fs.existsSync(catDir))
            continue;
        const files = fs.readdirSync(catDir).filter((f) => f.endsWith(".sql"));
        for (const file of files) {
            const filepath = path.join(catDir, file);
            const content = fs.readFileSync(filepath, "utf-8");
            const lines = content.split("\n");
            for (let i = 0; i < lines.length; i++) {
                if (regex.test(lines[i])) {
                    results.push({
                        file: filepath,
                        category: cat,
                        object: file.replace(".sql", ""),
                        lineNumber: i + 1,
                        line: lines[i].trimEnd(),
                    });
                }
            }
        }
    }
    return results;
}
function parseArgs() {
    commander_1.program
        .name("pg-ddl-search")
        .description("Search across extracted SQL files")
        .version("1.0.0")
        .argument("<pattern>", "Search pattern (regex supported)")
        .option("--sql-dir <path>", "Path to SQL directory")
        .option("--env <environment>", "Environment to search (e.g. dev, stage, prod)", "dev")
        .option("--category <category>", "Limit search to a category (tables, functions, etc.)")
        .option("-i, --ignore-case", "Case-insensitive search")
        .parse(process.argv);
    const args = commander_1.program.args;
    if (args.length === 0) {
        console.error("❌ Please provide a search pattern");
        process.exit(1);
    }
    return {
        pattern: args[0],
        options: commander_1.program.opts(),
    };
}
function main() {
    const { pattern, options } = parseArgs();
    const sqlRoot = options.sqlDir
        ? path.resolve(options.sqlDir)
        : process.env.SQL_OUTPUT_DIR
            ? path.resolve(process.env.SQL_OUTPUT_DIR)
            : path.resolve(__dirname, "..", "..", "sql");
    const env = options.env || "dev";
    const searchDir = path.join(sqlRoot, env);
    if (!fs.existsSync(searchDir)) {
        console.error(`❌ Directory not found: ${searchDir}`);
        console.error(`   Run: pg-ddl-extract --env ${env}`);
        process.exit(1);
    }
    console.log(`\n🔍 Searching "${pattern}" in sql/${env}/`);
    if (options.category) {
        console.log(`   Category: ${options.category}`);
    }
    console.log("");
    const results = searchFiles(searchDir, pattern, options.category, options.ignoreCase);
    if (results.length === 0) {
        console.log("  No matches found.\n");
        return;
    }
    // Group by category and object
    const grouped = new Map();
    for (const result of results) {
        const key = `${result.category}/${result.object}`;
        if (!grouped.has(key))
            grouped.set(key, []);
        grouped.get(key).push(result);
    }
    for (const [key, matches] of grouped) {
        const [cat, obj] = key.split("/");
        console.log(`  📄 [${cat}] ${obj} (${matches.length} match${matches.length > 1 ? "es" : ""})`);
        for (const m of matches.slice(0, 5)) {
            // Highlight the match in the line
            const highlightedLine = options.ignoreCase
                ? m.line.replace(new RegExp(pattern, "gi"), (match) => `\x1b[33m${match}\x1b[0m`)
                : m.line.replace(new RegExp(pattern, "g"), (match) => `\x1b[33m${match}\x1b[0m`);
            console.log(`     L${m.lineNumber}: ${highlightedLine}`);
        }
        if (matches.length > 5) {
            console.log(`     ... and ${matches.length - 5} more matches`);
        }
        console.log("");
    }
    console.log(`  Total: ${results.length} match${results.length > 1 ? "es" : ""} in ${grouped.size} file${grouped.size > 1 ? "s" : ""}\n`);
}
main();
