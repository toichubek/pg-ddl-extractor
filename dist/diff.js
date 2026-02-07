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
const compare_1 = require("./compare");
// ─── Load .env ────────────────────────────────────────────────────
dotenv.config();
function parseArgs() {
    commander_1.program
        .name("pg-ddl-diff")
        .description("Compare dev and prod PostgreSQL schemas")
        .version("1.0.0")
        .option("--report", "Generate markdown and HTML reports")
        .option("--side-by-side", "Generate side-by-side HTML diff report")
        .option("--sql-dir <path>", "Path to SQL directory (default: ../../sql)")
        .option("--dev <path>", "Path to dev schema directory")
        .option("--prod <path>", "Path to prod schema directory")
        .option("--envs <environments>", "Compare multiple environments (comma-separated, e.g. dev,staging,prod)")
        .parse(process.argv);
    return commander_1.program.opts();
}
// ─── Main ─────────────────────────────────────────────────────────
function main() {
    const options = parseArgs();
    // Determine SQL root directory
    const sqlRoot = options.sqlDir
        ? path.resolve(options.sqlDir)
        : process.env.SQL_OUTPUT_DIR
            ? path.resolve(process.env.SQL_OUTPUT_DIR)
            : path.resolve(__dirname, "..", "..", "sql");
    if (!fs.existsSync(sqlRoot)) {
        console.error(`❌ sql/ folder not found at: ${sqlRoot}`);
        console.error("   Run extract:dev and extract:prod first.");
        process.exit(1);
    }
    try {
        // Multi-environment comparison
        if (options.envs) {
            const envNames = options.envs.split(",").map((e) => e.trim());
            if (envNames.length < 2) {
                console.error("❌ --envs requires at least 2 environments");
                process.exit(1);
            }
            // Verify all directories exist
            for (const env of envNames) {
                const dir = path.join(sqlRoot, env);
                if (!fs.existsSync(dir)) {
                    console.error(`❌ sql/${env}/ not found. Run: pg-ddl-extract --env ${env}`);
                    process.exit(1);
                }
            }
            const result = (0, compare_1.compareMultiEnv)(sqlRoot, envNames);
            console.log((0, compare_1.formatMultiEnvReport)(result));
            return;
        }
        // Standard two-environment comparison
        const devDir = options.dev ? path.resolve(options.dev) : path.join(sqlRoot, "dev");
        const prodDir = options.prod ? path.resolve(options.prod) : path.join(sqlRoot, "prod");
        if (!fs.existsSync(devDir)) {
            console.error("❌ sql/dev/ not found. Run: npm run extract:dev");
            process.exit(1);
        }
        if (!fs.existsSync(prodDir)) {
            console.error("❌ sql/prod/ not found. Run: npm run extract:prod");
            process.exit(1);
        }
        const summary = options.dev || options.prod
            ? (0, compare_1.compareDdlDirs)(devDir, prodDir)
            : (0, compare_1.compareDdl)(sqlRoot);
        // Always print to console
        console.log((0, compare_1.formatConsoleReport)(summary));
        // Optionally save reports (markdown + HTML)
        if (options.report || options.sideBySide) {
            const reportDir = path.join(sqlRoot, "reports");
            fs.mkdirSync(reportDir, { recursive: true });
            const timestamp = new Date().toISOString().slice(0, 10);
            if (options.report) {
                const mdPath = path.join(reportDir, `diff_${timestamp}.md`);
                fs.writeFileSync(mdPath, (0, compare_1.formatMarkdownReport)(summary), "utf-8");
                const htmlPath = path.join(reportDir, `diff_${timestamp}.html`);
                fs.writeFileSync(htmlPath, (0, compare_1.formatHtmlReport)(summary), "utf-8");
                console.log(`\n📄 Markdown: ${mdPath}`);
                console.log(`🌐 HTML:     ${htmlPath}`);
            }
            if (options.sideBySide) {
                const sbsPath = path.join(reportDir, `diff_${timestamp}_side-by-side.html`);
                fs.writeFileSync(sbsPath, (0, compare_1.formatSideBySideHtml)(summary), "utf-8");
                console.log(`\n📊 Side-by-side: ${sbsPath}`);
                console.log(`\n   Open in browser: open ${sbsPath}`);
            }
            else {
                console.log(`\n   Open in browser: open ${path.join(reportDir, `diff_${timestamp}.html`)}`);
            }
        }
    }
    catch (err) {
        console.error(`❌ ${err.message}`);
        process.exit(1);
    }
}
main();
