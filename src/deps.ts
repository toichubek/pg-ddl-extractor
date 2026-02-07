import * as fs from "fs";
import { program } from "commander";
const pkg = require("../package.json");
import { Client } from "pg";
import { DbCliOptions, runWithConnection } from "./cli-utils";

interface Dependency {
  from: string;
  to: string;
  constraint: string;
  columns: string;
  refColumns: string;
}

interface DepGraph {
  tables: string[];
  dependencies: Dependency[];
}

interface CliOptions extends DbCliOptions {
  output?: string;
  mermaid?: boolean;
  dot?: boolean;
  order?: boolean;
}

async function buildDepGraph(client: Client): Promise<DepGraph> {
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
    tables: tables.map((t: { full_name: string }) => t.full_name),
    dependencies: fks.map((fk: { from_table: string; to_table: string; constraint_name: string; columns: string; ref_columns: string }) => ({
      from: fk.from_table,
      to: fk.to_table,
      constraint: fk.constraint_name,
      columns: fk.columns,
      refColumns: fk.ref_columns,
    })),
  };
}

function formatConsole(graph: DepGraph): string {
  const lines: string[] = [];

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
  const bySource = new Map<string, Dependency[]>();
  for (const dep of graph.dependencies) {
    if (!bySource.has(dep.from)) bySource.set(dep.from, []);
    bySource.get(dep.from)!.push(dep);
  }

  // Find root tables (no FK pointing to them) and leaf tables (no FKs from them)
  const referencedTables = new Set(graph.dependencies.map((d) => d.to));
  const referencingTables = new Set(graph.dependencies.map((d) => d.from));
  const rootTables = graph.tables.filter((t) => !referencingTables.has(t) && referencedTables.has(t));
  const leafTables = graph.tables.filter((t) => referencingTables.has(t) && !referencedTables.has(t));
  const isolatedTables = graph.tables.filter((t) => !referencingTables.has(t) && !referencedTables.has(t));

  if (rootTables.length > 0) {
    lines.push("  📌 Root tables (referenced but no FKs):");
    for (const t of rootTables) lines.push(`     ${t}`);
    lines.push("");
  }

  if (leafTables.length > 0) {
    lines.push("  🍃 Leaf tables (have FKs but not referenced):");
    for (const t of leafTables) lines.push(`     ${t}`);
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
    for (const t of isolatedTables.slice(0, 10)) lines.push(`     ${t}`);
    if (isolatedTables.length > 10) lines.push(`     ... and ${isolatedTables.length - 10} more`);
    lines.push("");
  }

  lines.push("═══════════════════════════════════════════════════════════");
  return lines.join("\n");
}

function formatMermaid(graph: DepGraph): string {
  const lines: string[] = [];
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

function formatDot(graph: DepGraph): string {
  const lines: string[] = [];
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
function topologicalOrder(graph: DepGraph): string[] {
  const adj = new Map<string, string[]>();
  const inDegree = new Map<string, number>();

  for (const t of graph.tables) {
    adj.set(t, []);
    inDegree.set(t, 0);
  }

  for (const dep of graph.dependencies) {
    adj.get(dep.to)!.push(dep.from);
    inDegree.set(dep.from, (inDegree.get(dep.from) || 0) + 1);
  }

  const queue: string[] = [];
  for (const [t, deg] of inDegree) {
    if (deg === 0) queue.push(t);
  }

  const ordered: string[] = [];
  while (queue.length > 0) {
    queue.sort();
    const current = queue.shift()!;
    ordered.push(current);

    for (const neighbor of adj.get(current) || []) {
      const newDeg = (inDegree.get(neighbor) || 0) - 1;
      inDegree.set(neighbor, newDeg);
      if (newDeg === 0) queue.push(neighbor);
    }
  }

  // If cyclic, add remaining tables
  for (const t of graph.tables) {
    if (!ordered.includes(t)) ordered.push(t);
  }

  return ordered;
}

function parseArgs(): CliOptions {
  program
    .name("pg-ddl-deps")
    .description("Show schema dependency graph and creation order")
    .version(pkg.version)
    .option("--env <environment>", "Environment name (e.g. dev, stage, prod)", "dev")
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

  return program.opts<CliOptions>();
}

async function main(): Promise<void> {
  const options = parseArgs();

  await runWithConnection(options, async (client) => {
    const graph = await buildDepGraph(client);

    if (options.mermaid) {
      const output = formatMermaid(graph);
      if (options.output) {
        fs.writeFileSync(options.output, output, "utf-8");
        console.log(`📊 Mermaid diagram saved to: ${options.output}`);
      } else {
        console.log(output);
      }
    } else if (options.dot) {
      const output = formatDot(graph);
      if (options.output) {
        fs.writeFileSync(options.output, output, "utf-8");
        console.log(`📊 DOT graph saved to: ${options.output}`);
      } else {
        console.log(output);
      }
    } else if (options.order) {
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
    } else {
      console.log(formatConsole(graph));
    }
  });
}

main();
