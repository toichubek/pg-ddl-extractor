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
const compare_1 = require("./compare");
// ─── Parse CLI args ───────────────────────────────────────────────
function parseArgs() {
    const args = process.argv.slice(2);
    return {
        report: args.includes("--report"),
    };
}
// ─── Main ─────────────────────────────────────────────────────────
function main() {
    const { report } = parseArgs();
    // sql/ lives at ../../sql relative to this script (extract-db/src/)
    const sqlRoot = path.resolve(__dirname, "..", "..", "sql");
    if (!fs.existsSync(sqlRoot)) {
        console.error(`❌ sql/ folder not found at: ${sqlRoot}`);
        console.error("   Run extract:dev and extract:prod first.");
        process.exit(1);
    }
    const devDir = path.join(sqlRoot, "dev");
    const prodDir = path.join(sqlRoot, "prod");
    if (!fs.existsSync(devDir)) {
        console.error("❌ sql/dev/ not found. Run: npm run extract:dev");
        process.exit(1);
    }
    if (!fs.existsSync(prodDir)) {
        console.error("❌ sql/prod/ not found. Run: npm run extract:prod");
        process.exit(1);
    }
    try {
        const summary = (0, compare_1.compareDdl)(sqlRoot);
        // Always print to console
        console.log((0, compare_1.formatConsoleReport)(summary));
        // Optionally save reports (markdown + HTML)
        if (report) {
            const reportDir = path.join(sqlRoot, "reports");
            fs.mkdirSync(reportDir, { recursive: true });
            const timestamp = new Date().toISOString().slice(0, 10);
            const mdPath = path.join(reportDir, `diff_${timestamp}.md`);
            fs.writeFileSync(mdPath, (0, compare_1.formatMarkdownReport)(summary), "utf-8");
            const htmlPath = path.join(reportDir, `diff_${timestamp}.html`);
            fs.writeFileSync(htmlPath, (0, compare_1.formatHtmlReport)(summary), "utf-8");
            console.log(`\n📄 Markdown: ${mdPath}`);
            console.log(`🌐 HTML:     ${htmlPath}`);
            console.log(`\n   Open in browser: open ${htmlPath}`);
        }
    }
    catch (err) {
        console.error(`❌ ${err.message}`);
        process.exit(1);
    }
}
main();
