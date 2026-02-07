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
const dotenv = __importStar(require("dotenv"));
const pg_1 = require("pg");
const commander_1 = require("commander");
const config_1 = require("./config");
const tunnel_1 = require("./tunnel");
dotenv.config();
async function buildDepGraph(client) {
    // Get all tables
    const { rows: tables } = await client.query(`
    SELECT schemaname || '.' || tablename AS full_name
    FROM pg_tables
    WHERE schemaname NOT IN ('pg_catalog', 'information_schema', 'pg_toast')
    ORDER BY schemaname, tablename;
  `);
    // Get all FK dependencies
    const { rows: fks } = await client.query(`
    SELECT
      tc.table_schema || '.' || tc.table_name AS from_table,
      ccu.table_schema || '.' || ccu.table_name AS to_table,
      tc.constraint_name,
      string_agg(DISTINCT kcu.column_name, ', ' ORDER BY kcu.column_name) AS columns,
      string_agg(DISTINCT ccu.column_name, ', ' ORDER BY ccu.column_name) AS ref_columns
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu
      ON kcu.constraint_name = tc.constraint_name AND kcu.constraint_schema = tc.constraint_schema
    JOIN information_schema.constraint_column_usage ccu
      ON ccu.constraint_name = tc.constraint_name AND ccu.constraint_schema = tc.constraint_schema
    WHERE tc.constraint_type = 'FOREIGN KEY'
      AND tc.table_schema NOT IN ('pg_catalog', 'information_schema', 'pg_toast')
    GROUP BY tc.table_schema, tc.table_name, ccu.table_schema, ccu.table_name, tc.constraint_name
    ORDER BY tc.table_schema, tc.table_name;
  `);
    return {
        tables: tables.map((t) => t.full_name),
        dependencies: fks.map((fk) => ({
            from: fk.from_table,
            to: fk.to_table,
            constraint: fk.constraint_name,
            columns: fk.columns,
            refColumns: fk.ref_columns,
        })),
    };
}
function formatConsole(graph) {
    const lines = [];
    lines.push("═══════════════════════════════════════════════════════════");
    lines.push("  Schema Dependency Graph");
    lines.push("═══════════════════════════════════════════════════════════");
    lines.push("");
    lines.push(`  Tables: ${graph.tables.length}`);
    lines.push(`  Foreign Keys: ${graph.dependencies.length}`);
    lines.push("");
    if (graph.dependencies.length === 0) {
        lines.push("  No foreign key dependencies found.");
        lines.push("");
        lines.push("═══════════════════════════════════════════════════════════");
        return lines.join("\n");
    }
    // Group by source table
    const bySource = new Map();
    for (const dep of graph.dependencies) {
        if (!bySource.has(dep.from))
            bySource.set(dep.from, []);
        bySource.get(dep.from).push(dep);
    }
    // Find root tables (no FK pointing to them) and leaf tables (no FKs from them)
    const referencedTables = new Set(graph.dependencies.map((d) => d.to));
    const referencingTables = new Set(graph.dependencies.map((d) => d.from));
    const rootTables = graph.tables.filter((t) => !referencingTables.has(t) && referencedTables.has(t));
    const leafTables = graph.tables.filter((t) => referencingTables.has(t) && !referencedTables.has(t));
    const isolatedTables = graph.tables.filter((t) => !referencingTables.has(t) && !referencedTables.has(t));
    if (rootTables.length > 0) {
        lines.push("  📌 Root tables (referenced but no FKs):");
        for (const t of rootTables)
            lines.push(`     ${t}`);
        lines.push("");
    }
    if (leafTables.length > 0) {
        lines.push("  🍃 Leaf tables (have FKs but not referenced):");
        for (const t of leafTables)
            lines.push(`     ${t}`);
        lines.push("");
    }
    lines.push("  🔗 Dependencies:");
    lines.push("  " + "─".repeat(55));
    for (const [source, deps] of bySource) {
        lines.push(`  ${source}`);
        for (const dep of deps) {
            lines.push(`    → ${dep.to} (${dep.columns} → ${dep.refColumns})`);
        }
    }
    lines.push("");
    if (isolatedTables.length > 0) {
        lines.push(`  📦 Isolated tables (no FK relations): ${isolatedTables.length}`);
        for (const t of isolatedTables.slice(0, 10))
            lines.push(`     ${t}`);
        if (isolatedTables.length > 10)
            lines.push(`     ... and ${isolatedTables.length - 10} more`);
        lines.push("");
    }
    lines.push("═══════════════════════════════════════════════════════════");
    return lines.join("\n");
}
function formatMermaid(graph) {
    const lines = [];
    lines.push("erDiagram");
    for (const dep of graph.dependencies) {
        const from = dep.from.replace(".", "_");
        const to = dep.to.replace(".", "_");
        lines.push(`  ${from} }|--|| ${to} : "${dep.constraint}"`);
    }
    // Add isolated tables
    const connectedTables = new Set([
        ...graph.dependencies.map((d) => d.from),
        ...graph.dependencies.map((d) => d.to),
    ]);
    for (const t of graph.tables) {
        if (!connectedTables.has(t)) {
            lines.push(`  ${t.replace(".", "_")} {`);
            lines.push("  }");
        }
    }
    return lines.join("\n");
}
function formatDot(graph) {
    const lines = [];
    lines.push("digraph schema_deps {");
    lines.push('  rankdir=LR;');
    lines.push('  node [shape=box, style=filled, fillcolor="#e8f4fd", fontname="Helvetica"];');
    lines.push('  edge [fontsize=10, fontname="Helvetica"];');
    lines.push("");
    for (const dep of graph.dependencies) {
        const from = `"${dep.from}"`;
        const to = `"${dep.to}"`;
        lines.push(`  ${from} -> ${to} [label="${dep.columns}"];`);
    }
    lines.push("}");
    return lines.join("\n");
}
/**
 * Topological sort — gives a safe creation/migration order.
 */
function topologicalOrder(graph) {
    const adj = new Map();
    const inDegree = new Map();
    for (const t of graph.tables) {
        adj.set(t, []);
        inDegree.set(t, 0);
    }
    for (const dep of graph.dependencies) {
        adj.get(dep.to).push(dep.from);
        inDegree.set(dep.from, (inDegree.get(dep.from) || 0) + 1);
    }
    const queue = [];
    for (const [t, deg] of inDegree) {
        if (deg === 0)
            queue.push(t);
    }
    const ordered = [];
    while (queue.length > 0) {
        queue.sort();
        const current = queue.shift();
        ordered.push(current);
        for (const neighbor of adj.get(current) || []) {
            const newDeg = (inDegree.get(neighbor) || 0) - 1;
            inDegree.set(neighbor, newDeg);
            if (newDeg === 0)
                queue.push(neighbor);
        }
    }
    // If cyclic, add remaining tables
    for (const t of graph.tables) {
        if (!ordered.includes(t))
            ordered.push(t);
    }
    return ordered;
}
function parseArgs() {
    commander_1.program
        .name("pg-ddl-deps")
        .description("Show schema dependency graph and creation order")
        .version("1.0.0")
        .option("--env <environment>", "Environment (dev or prod)", "dev")
        .option("--host <host>", "Database host")
        .option("--port <port>", "Database port")
        .option("--database <database>", "Database name")
        .option("--user <user>", "Database user")
        .option("--password <password>", "Database password")
        .option("--output <path>", "Output file path")
        .option("--mermaid", "Output as Mermaid ERD diagram")
        .option("--dot", "Output as Graphviz DOT format")
        .option("--order", "Show topological creation order")
        .parse(process.argv);
    return commander_1.program.opts();
}
async function main() {
    const options = parseArgs();
    const env = options.env || "dev";
    const sshConfig = (0, tunnel_1.getSshConfig)(env);
    let tunnel = null;
    let pgConfig = options.host || options.database || options.user
        ? {
            host: options.host || "localhost",
            port: options.port ? parseInt(options.port, 10) : 5432,
            database: options.database,
            user: options.user,
            password: options.password || "",
            connectionTimeoutMillis: 10000,
            query_timeout: 30000,
        }
        : (0, config_1.getDbConfig)(env);
    if (sshConfig) {
        try {
            tunnel = await (0, tunnel_1.createSshTunnel)(sshConfig);
            pgConfig = { ...pgConfig, host: "127.0.0.1", port: tunnel.localPort };
        }
        catch (err) {
            console.error(`❌ SSH tunnel failed: ${err.message}`);
            process.exit(1);
        }
    }
    const client = new pg_1.Client(pgConfig);
    try {
        await client.connect();
        const graph = await buildDepGraph(client);
        if (options.mermaid) {
            const output = formatMermaid(graph);
            if (options.output) {
                fs.writeFileSync(options.output, output, "utf-8");
                console.log(`📊 Mermaid diagram saved to: ${options.output}`);
            }
            else {
                console.log(output);
            }
        }
        else if (options.dot) {
            const output = formatDot(graph);
            if (options.output) {
                fs.writeFileSync(options.output, output, "utf-8");
                console.log(`📊 DOT graph saved to: ${options.output}`);
            }
            else {
                console.log(output);
            }
        }
        else if (options.order) {
            const ordered = topologicalOrder(graph);
            console.log("═══════════════════════════════════════════════════════════");
            console.log("  Safe Table Creation Order (topological sort)");
            console.log("═══════════════════════════════════════════════════════════");
            console.log("");
            for (let i = 0; i < ordered.length; i++) {
                console.log(`  ${String(i + 1).padStart(3)}. ${ordered[i]}`);
            }
            console.log("");
            console.log("═══════════════════════════════════════════════════════════");
        }
        else {
            console.log(formatConsole(graph));
        }
    }
    catch (err) {
        console.error(`\n❌ Error: ${err.message}`);
        process.exit(1);
    }
    finally {
        await client.end();
        if (tunnel)
            await tunnel.close();
    }
}
main();
