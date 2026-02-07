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
const pkg = require("../package.json");
const docs_generator_1 = require("./docs-generator");
const cli_utils_1 = require("./cli-utils");
function parseArgs() {
    commander_1.program
        .name("pg-ddl-docs")
        .description("Generate documentation from PostgreSQL database schema")
        .version(pkg.version)
        .option("--env <environment>", "Environment name (e.g. dev, stage, prod)", "dev")
        .option("--host <host>", "Database host")
        .option("--port <port>", "Database port")
        .option("--database <database>", "Database name")
        .option("--user <user>", "Database user")
        .option("--password <password>", "Database password")
        .option("--output <path>", "Output directory for documentation")
        .option("--format <format>", "Output format: markdown (default)", "markdown")
        .option("--diagram", "Include Mermaid ERD diagram")
        .parse(process.argv);
    return commander_1.program.opts();
}
// ─── Main ─────────────────────────────────────────────────────────
async function main() {
    const options = parseArgs();
    const env = options.env || "dev";
    console.log("═══════════════════════════════════════════════════════════");
    console.log(`  PostgreSQL Schema Documentation Generator`);
    console.log(`  Environment: ${env.toUpperCase()}`);
    console.log("═══════════════════════════════════════════════════════════");
    await (0, cli_utils_1.runWithConnection)(options, async (client) => {
        console.log("📝 Generating documentation...\n");
        const generator = new docs_generator_1.DocsGenerator(client);
        const doc = await generator.generate();
        // Determine output directory (default: sql/docs/)
        const outputDir = options.output
            ? path.resolve(options.output)
            : process.env.SQL_OUTPUT_DIR
                ? path.resolve(process.env.SQL_OUTPUT_DIR, "docs")
                : path.resolve(__dirname, "..", "..", "sql", "docs");
        fs.mkdirSync(outputDir, { recursive: true });
        // Generate markdown
        const markdown = (0, docs_generator_1.formatDocsMarkdown)(doc);
        const mdPath = path.join(outputDir, `schema_${env}.md`);
        fs.writeFileSync(mdPath, markdown, "utf-8");
        console.log(`  📄 Markdown: ${mdPath}`);
        // Generate diagram if requested
        if (options.diagram) {
            const mermaid = (0, docs_generator_1.formatDocsMermaid)(doc);
            const diagramPath = path.join(outputDir, `erd_${env}.md`);
            fs.writeFileSync(diagramPath, `# ERD Diagram: ${doc.dbName}\n\n${mermaid}\n`, "utf-8");
            console.log(`  📊 Diagram:  ${diagramPath}`);
        }
        // Print summary
        let totalTables = 0;
        let totalViews = 0;
        let totalFunctions = 0;
        for (const schema of doc.schemas) {
            totalTables += schema.tables.length;
            totalViews += schema.views.length;
            totalFunctions += schema.functions.length;
        }
        console.log("");
        console.log("═══════════════════════════════════════════════════════════");
        console.log("  ✅ Documentation generated!");
        console.log("═══════════════════════════════════════════════════════════");
        console.log(`  Schemas:   ${doc.schemas.length}`);
        console.log(`  Tables:    ${totalTables}`);
        console.log(`  Views:     ${totalViews}`);
        console.log(`  Functions: ${totalFunctions}`);
        console.log("═══════════════════════════════════════════════════════════");
    });
}
main();
