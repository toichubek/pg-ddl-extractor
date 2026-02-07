import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";

// ─── Types ────────────────────────────────────────────────────────

interface DiffItem {
  category: string;
  object: string;
  status: "only_dev" | "only_prod" | "modified";
  devFile?: string;
  prodFile?: string;
  diff?: string[];
}

interface DiffSummary {
  total_dev: number;
  total_prod: number;
  only_dev: number;
  only_prod: number;
  modified: number;
  identical: number;
  items: DiffItem[];
}

// ─── Helpers ──────────────────────────────────────────────────────

function getCategories(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort();
}

function getSqlFiles(dir: string): Map<string, string> {
  const files = new Map<string, string>();
  if (!fs.existsSync(dir)) return files;
  for (const f of fs.readdirSync(dir)) {
    if (f.endsWith(".sql")) {
      files.set(f, path.join(dir, f));
    }
  }
  return files;
}

function fileHash(filepath: string): string {
  const content = stripHeader(fs.readFileSync(filepath, "utf-8"));
  // Normalize: trim each line, remove empty lines, so whitespace-only diffs don't count
  const normalized = content
    .split("\n")
    .map((l) => l.trimEnd())
    .filter((l) => l.trim() !== "")
    .join("\n");
  return crypto.createHash("md5").update(normalized).digest("hex");
}

/** Strip the auto-generated header (timestamps etc) so we compare only DDL */
function stripHeader(content: string): string {
  const lines = content.split("\n");
  const start = lines.findIndex((l) => !l.startsWith("-- ") && l.trim() !== "");
  return start >= 0 ? lines.slice(start).join("\n").trim() : content.trim();
}

/** Normalize a line for comparison: trim trailing whitespace */
function normalizeLine(line: string): string {
  return line.trimEnd();
}

/**
 * LCS-based diff — finds actual insertions/deletions/changes
 * between dev and prod, ignoring whitespace-only differences
 */
function lineDiff(devPath: string, prodPath: string): string[] {
  const devLines = stripHeader(fs.readFileSync(devPath, "utf-8")).split("\n");
  const prodLines = stripHeader(fs.readFileSync(prodPath, "utf-8")).split("\n");

  const devNorm = devLines.map(normalizeLine);
  const prodNorm = prodLines.map(normalizeLine);

  // Build LCS table
  const m = devNorm.length;
  const n = prodNorm.length;

  // For very large files, fall back to simpler approach
  if (m * n > 5_000_000) {
    return simpleDiff(devNorm, prodNorm);
  }

  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (devNorm[i - 1] === prodNorm[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }
  }

  // Backtrack to find diff
  const changes: string[] = [];
  let i = m;
  let j = n;

  interface DiffEntry {
    type: "dev" | "prod" | "context";
    lineNum: number;
    text: string;
  }

  const rawDiff: DiffEntry[] = [];

  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && devNorm[i - 1] === prodNorm[j - 1]) {
      rawDiff.push({ type: "context", lineNum: i, text: devNorm[i - 1] });
      i--;
      j--;
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      rawDiff.push({ type: "prod", lineNum: j, text: prodNorm[j - 1] });
      j--;
    } else {
      rawDiff.push({ type: "dev", lineNum: i, text: devNorm[i - 1] });
      i--;
    }
  }

  rawDiff.reverse();

  // Format output: group changes with minimal context
  const CONTEXT_LINES = 2;
  const diffEntries = rawDiff.filter((d) => d.type !== "context");

  if (diffEntries.length === 0) return [];

  // Find which context lines are near changes
  const showLines = new Set<number>();
  for (let idx = 0; idx < rawDiff.length; idx++) {
    if (rawDiff[idx].type !== "context") {
      // Mark surrounding context lines
      for (
        let c = Math.max(0, idx - CONTEXT_LINES);
        c <= Math.min(rawDiff.length - 1, idx + CONTEXT_LINES);
        c++
      ) {
        showLines.add(c);
      }
    }
  }

  let lastShown = -1;
  for (let idx = 0; idx < rawDiff.length; idx++) {
    if (!showLines.has(idx)) continue;

    if (lastShown >= 0 && idx - lastShown > 1) {
      changes.push("  ...");
    }

    const entry = rawDiff[idx];
    if (entry.type === "dev") {
      changes.push(`- DEV  [${entry.lineNum}]: ${entry.text}`);
    } else if (entry.type === "prod") {
      changes.push(`+ PROD [${entry.lineNum}]: ${entry.text}`);
    } else {
      changes.push(`       [${entry.lineNum}]: ${entry.text}`);
    }

    lastShown = idx;
  }

  return changes;
}

/** Fallback for very large files — compare unique lines only */
function simpleDiff(devLines: string[], prodLines: string[]): string[] {
  const changes: string[] = [];
  const prodSet = new Set(prodLines);
  const devSet = new Set(devLines);

  const onlyDev = devLines.filter((l, i) => l.trim() && !prodSet.has(l));
  const onlyProd = prodLines.filter((l, i) => l.trim() && !devSet.has(l));

  // Deduplicate for display
  const uniqueOnlyDev = [...new Set(onlyDev)];
  const uniqueOnlyProd = [...new Set(onlyProd)];

  if (uniqueOnlyDev.length > 0) {
    changes.push("  Lines only in DEV:");
    for (const line of uniqueOnlyDev.slice(0, 30)) {
      changes.push(`- DEV: ${line}`);
    }
    if (uniqueOnlyDev.length > 30) {
      changes.push(`  ... and ${uniqueOnlyDev.length - 30} more`);
    }
  }

  if (uniqueOnlyProd.length > 0) {
    if (changes.length > 0) changes.push("");
    changes.push("  Lines only in PROD:");
    for (const line of uniqueOnlyProd.slice(0, 30)) {
      changes.push(`+ PROD: ${line}`);
    }
    if (uniqueOnlyProd.length > 30) {
      changes.push(`  ... and ${uniqueOnlyProd.length - 30} more`);
    }
  }

  return changes;
}

// ─── Main Comparator ──────────────────────────────────────────────

export function compareDdl(sqlRoot: string): DiffSummary {
  const devDir = path.join(sqlRoot, "dev");
  const prodDir = path.join(sqlRoot, "prod");

  if (!fs.existsSync(devDir)) throw new Error(`DEV folder not found: ${devDir}`);
  if (!fs.existsSync(prodDir)) throw new Error(`PROD folder not found: ${prodDir}`);

  const allCategories = [...new Set([...getCategories(devDir), ...getCategories(prodDir)])].sort();

  const items: DiffItem[] = [];
  let totalDev = 0;
  let totalProd = 0;
  let identical = 0;

  for (const category of allCategories) {
    const devFiles = getSqlFiles(path.join(devDir, category));
    const prodFiles = getSqlFiles(path.join(prodDir, category));

    totalDev += devFiles.size;
    totalProd += prodFiles.size;

    const allObjects = [...new Set([...devFiles.keys(), ...prodFiles.keys()])].sort();

    for (const obj of allObjects) {
      const inDev = devFiles.has(obj);
      const inProd = prodFiles.has(obj);

      if (inDev && !inProd) {
        items.push({
          category,
          object: obj.replace(".sql", ""),
          status: "only_dev",
          devFile: devFiles.get(obj),
        });
      } else if (!inDev && inProd) {
        items.push({
          category,
          object: obj.replace(".sql", ""),
          status: "only_prod",
          prodFile: prodFiles.get(obj),
        });
      } else if (inDev && inProd) {
        const devHash = fileHash(devFiles.get(obj)!);
        const prodHash = fileHash(prodFiles.get(obj)!);

        if (devHash !== prodHash) {
          items.push({
            category,
            object: obj.replace(".sql", ""),
            status: "modified",
            devFile: devFiles.get(obj),
            prodFile: prodFiles.get(obj),
            diff: lineDiff(devFiles.get(obj)!, prodFiles.get(obj)!),
          });
        } else {
          identical++;
        }
      }
    }
  }

  return {
    total_dev: totalDev,
    total_prod: totalProd,
    only_dev: items.filter((i) => i.status === "only_dev").length,
    only_prod: items.filter((i) => i.status === "only_prod").length,
    modified: items.filter((i) => i.status === "modified").length,
    identical,
    items,
  };
}

// ─── Compare two arbitrary directories ────────────────────────────

export function compareDdlDirs(dir1: string, dir2: string): DiffSummary {
  if (!fs.existsSync(dir1)) throw new Error(`Folder not found: ${dir1}`);
  if (!fs.existsSync(dir2)) throw new Error(`Folder not found: ${dir2}`);

  const allCategories = [...new Set([...getCategories(dir1), ...getCategories(dir2)])].sort();

  const items: DiffItem[] = [];
  let total1 = 0;
  let total2 = 0;
  let identical = 0;

  for (const category of allCategories) {
    const files1 = getSqlFiles(path.join(dir1, category));
    const files2 = getSqlFiles(path.join(dir2, category));

    total1 += files1.size;
    total2 += files2.size;

    const allObjects = [...new Set([...files1.keys(), ...files2.keys()])].sort();

    for (const obj of allObjects) {
      const in1 = files1.has(obj);
      const in2 = files2.has(obj);

      if (in1 && !in2) {
        items.push({ category, object: obj.replace(".sql", ""), status: "only_dev", devFile: files1.get(obj) });
      } else if (!in1 && in2) {
        items.push({ category, object: obj.replace(".sql", ""), status: "only_prod", prodFile: files2.get(obj) });
      } else if (in1 && in2) {
        const hash1 = fileHash(files1.get(obj)!);
        const hash2 = fileHash(files2.get(obj)!);
        if (hash1 !== hash2) {
          items.push({
            category,
            object: obj.replace(".sql", ""),
            status: "modified",
            devFile: files1.get(obj),
            prodFile: files2.get(obj),
            diff: lineDiff(files1.get(obj)!, files2.get(obj)!),
          });
        } else {
          identical++;
        }
      }
    }
  }

  return {
    total_dev: total1,
    total_prod: total2,
    only_dev: items.filter((i) => i.status === "only_dev").length,
    only_prod: items.filter((i) => i.status === "only_prod").length,
    modified: items.filter((i) => i.status === "modified").length,
    identical,
    items,
  };
}

// ─── Multi-environment Compare ────────────────────────────────────

export interface MultiEnvResult {
  envs: string[];
  pairs: {
    env1: string;
    env2: string;
    identical: number;
    onlyFirst: number;
    onlySecond: number;
    modified: number;
    total1: number;
    total2: number;
  }[];
}

export function compareMultiEnv(sqlRoot: string, envNames: string[]): MultiEnvResult {
  const pairs: MultiEnvResult["pairs"] = [];

  for (let i = 0; i < envNames.length; i++) {
    for (let j = i + 1; j < envNames.length; j++) {
      const dir1 = path.join(sqlRoot, envNames[i]);
      const dir2 = path.join(sqlRoot, envNames[j]);

      const summary = compareDdlDirs(dir1, dir2);
      pairs.push({
        env1: envNames[i],
        env2: envNames[j],
        identical: summary.identical,
        onlyFirst: summary.only_dev,
        onlySecond: summary.only_prod,
        modified: summary.modified,
        total1: summary.total_dev,
        total2: summary.total_prod,
      });
    }
  }

  return { envs: envNames, pairs };
}

export function formatMultiEnvReport(result: MultiEnvResult): string {
  const lines: string[] = [];

  lines.push("═══════════════════════════════════════════════════════════");
  lines.push("  Multi-Environment DDL Comparison");
  lines.push(`  Environments: ${result.envs.join(", ")}`);
  lines.push(`  Generated: ${new Date().toISOString().slice(0, 19)}`);
  lines.push("═══════════════════════════════════════════════════════════");
  lines.push("");

  // Matrix header
  const colWidth = 14;
  const header = "".padEnd(colWidth) + result.envs.map((e) => e.padStart(colWidth)).join("");
  lines.push(header);
  lines.push("─".repeat(colWidth * (result.envs.length + 1)));

  // Build diff matrix
  const matrix: Record<string, Record<string, string>> = {};
  for (const env of result.envs) {
    matrix[env] = {};
    matrix[env][env] = "—";
  }

  for (const pair of result.pairs) {
    const total = pair.onlyFirst + pair.onlySecond + pair.modified;
    const label = total === 0 ? "✅ sync" : `${total} diffs`;
    matrix[pair.env1][pair.env2] = label;
    matrix[pair.env2][pair.env1] = label;
  }

  for (const env1 of result.envs) {
    const row = env1.padEnd(colWidth) + result.envs.map((env2) => (matrix[env1][env2] || "").padStart(colWidth)).join("");
    lines.push(row);
  }

  lines.push("");

  // Detailed pair comparisons
  for (const pair of result.pairs) {
    const totalDiffs = pair.onlyFirst + pair.onlySecond + pair.modified;

    lines.push("───────────────────────────────────────────────────────────");
    lines.push(`  ${pair.env1.toUpperCase()} vs ${pair.env2.toUpperCase()}`);
    lines.push("───────────────────────────────────────────────────────────");
    lines.push(`    ${pair.env1} objects: ${pair.total1}`);
    lines.push(`    ${pair.env2} objects: ${pair.total2}`);
    lines.push(`    ✅ Identical: ${pair.identical}`);
    lines.push(`    🔄 Modified:  ${pair.modified}`);
    lines.push(`    🟢 Only ${pair.env1}: ${pair.onlyFirst}`);
    lines.push(`    🔴 Only ${pair.env2}: ${pair.onlySecond}`);

    if (totalDiffs === 0) {
      lines.push(`    🎉 Environments are in sync!`);
    }

    lines.push("");
  }

  lines.push("═══════════════════════════════════════════════════════════");

  return lines.join("\n");
}

// ─── Report Formatters ────────────────────────────────────────────

export function formatConsoleReport(summary: DiffSummary): string {
  const lines: string[] = [];

  lines.push("═══════════════════════════════════════════════════════════");
  lines.push("  DEV vs PROD — DDL Comparison Report");
  lines.push(`  Generated: ${new Date().toISOString().slice(0, 19)}`);
  lines.push("═══════════════════════════════════════════════════════════");
  lines.push("");
  lines.push(`  DEV objects:  ${summary.total_dev}`);
  lines.push(`  PROD objects: ${summary.total_prod}`);
  lines.push("");
  lines.push(`  ✅ Identical:  ${summary.identical}`);
  lines.push(`  🔄 Modified:   ${summary.modified}`);
  lines.push(`  🟢 Only DEV:   ${summary.only_dev}`);
  lines.push(`  🔴 Only PROD:  ${summary.only_prod}`);
  lines.push("");

  // ── Only in DEV ──
  const onlyDev = summary.items.filter((i) => i.status === "only_dev");
  if (onlyDev.length > 0) {
    lines.push("───────────────────────────────────────────────────────────");
    lines.push("  🟢 EXISTS ONLY IN DEV (not yet in prod)");
    lines.push("───────────────────────────────────────────────────────────");
    for (const item of onlyDev) {
      lines.push(`    [${item.category}] ${item.object}`);
    }
    lines.push("");
  }

  // ── Only in PROD ──
  const onlyProd = summary.items.filter((i) => i.status === "only_prod");
  if (onlyProd.length > 0) {
    lines.push("───────────────────────────────────────────────────────────");
    lines.push("  🔴 EXISTS ONLY IN PROD (missing in dev)");
    lines.push("───────────────────────────────────────────────────────────");
    for (const item of onlyProd) {
      lines.push(`    [${item.category}] ${item.object}`);
    }
    lines.push("");
  }

  // ── Modified ──
  const modified = summary.items.filter((i) => i.status === "modified");
  if (modified.length > 0) {
    lines.push("───────────────────────────────────────────────────────────");
    lines.push("  🔄 MODIFIED (different between dev and prod)");
    lines.push("───────────────────────────────────────────────────────────");
    for (const item of modified) {
      lines.push(`\n    [${item.category}] ${item.object}`);
      if (item.diff && item.diff.length > 0) {
        const maxDiffLines = 20;
        const showLines = item.diff.slice(0, maxDiffLines);
        for (const d of showLines) {
          lines.push(`      ${d}`);
        }
        if (item.diff.length > maxDiffLines) {
          lines.push(`      ... and ${item.diff.length - maxDiffLines} more differences`);
        }
      }
    }
    lines.push("");
  }

  if (summary.only_dev === 0 && summary.only_prod === 0 && summary.modified === 0) {
    lines.push("  🎉 DEV and PROD are perfectly in sync!");
    lines.push("");
  }

  lines.push("═══════════════════════════════════════════════════════════");

  return lines.join("\n");
}

export function formatMarkdownReport(summary: DiffSummary): string {
  const lines: string[] = [];

  lines.push("# DEV vs PROD — DDL Comparison Report");
  lines.push("");
  lines.push(`Generated: ${new Date().toISOString().slice(0, 19)}`);
  lines.push("");
  lines.push("## Summary");
  lines.push("");
  lines.push("| Metric | Count |");
  lines.push("|--------|-------|");
  lines.push(`| DEV objects | ${summary.total_dev} |`);
  lines.push(`| PROD objects | ${summary.total_prod} |`);
  lines.push(`| ✅ Identical | ${summary.identical} |`);
  lines.push(`| 🔄 Modified | ${summary.modified} |`);
  lines.push(`| 🟢 Only in DEV | ${summary.only_dev} |`);
  lines.push(`| 🔴 Only in PROD | ${summary.only_prod} |`);
  lines.push("");

  const onlyDev = summary.items.filter((i) => i.status === "only_dev");
  if (onlyDev.length > 0) {
    lines.push("## 🟢 Only in DEV");
    lines.push("");
    lines.push("| Category | Object |");
    lines.push("|----------|--------|");
    for (const item of onlyDev) {
      lines.push(`| ${item.category} | ${item.object} |`);
    }
    lines.push("");
  }

  const onlyProd = summary.items.filter((i) => i.status === "only_prod");
  if (onlyProd.length > 0) {
    lines.push("## 🔴 Only in PROD");
    lines.push("");
    lines.push("| Category | Object |");
    lines.push("|----------|--------|");
    for (const item of onlyProd) {
      lines.push(`| ${item.category} | ${item.object} |`);
    }
    lines.push("");
  }

  const modified = summary.items.filter((i) => i.status === "modified");
  if (modified.length > 0) {
    lines.push("## 🔄 Modified");
    lines.push("");
    for (const item of modified) {
      lines.push(`### [${item.category}] ${item.object}`);
      lines.push("");
      if (item.diff && item.diff.length > 0) {
        lines.push("```diff");
        for (const d of item.diff.slice(0, 30)) {
          lines.push(d);
        }
        if (item.diff.length > 30) {
          lines.push(`... and ${item.diff.length - 30} more lines`);
        }
        lines.push("```");
      }
      lines.push("");
    }
  }

  if (summary.only_dev === 0 && summary.only_prod === 0 && summary.modified === 0) {
    lines.push("## 🎉 DEV and PROD are perfectly in sync!");
    lines.push("");
  }

  return lines.join("\n");
}

// ─── HTML Report ──────────────────────────────────────────────────

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function formatHtmlReport(summary: DiffSummary): string {
  const timestamp = new Date().toISOString().slice(0, 19);
  const totalDiffs = summary.only_dev + summary.only_prod + summary.modified;
  const statusClass = totalDiffs === 0 ? "sync" : "diff";

  const onlyDev = summary.items.filter((i) => i.status === "only_dev");
  const onlyProd = summary.items.filter((i) => i.status === "only_prod");
  const modified = summary.items.filter((i) => i.status === "modified");

  // Group by category for modified items
  const modifiedByCategory = new Map<string, DiffItem[]>();
  for (const item of modified) {
    if (!modifiedByCategory.has(item.category)) {
      modifiedByCategory.set(item.category, []);
    }
    modifiedByCategory.get(item.category)!.push(item);
  }

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>DDL Diff — DEV vs PROD</title>
<style>
  :root {
    --bg: #0d1117;
    --surface: #161b22;
    --border: #30363d;
    --text: #e6edf3;
    --text-muted: #8b949e;
    --green: #3fb950;
    --green-bg: #0d2818;
    --red: #f85149;
    --red-bg: #2d1214;
    --yellow: #d29922;
    --yellow-bg: #2e2416;
    --blue: #58a6ff;
    --blue-bg: #0c2d6b;
  }

  * { margin: 0; padding: 0; box-sizing: border-box; }

  body {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, monospace;
    background: var(--bg);
    color: var(--text);
    padding: 2rem;
    line-height: 1.5;
  }

  .header {
    border-bottom: 1px solid var(--border);
    padding-bottom: 1.5rem;
    margin-bottom: 2rem;
  }

  .header h1 {
    font-size: 1.5rem;
    font-weight: 600;
    margin-bottom: 0.25rem;
  }

  .header .meta {
    color: var(--text-muted);
    font-size: 0.85rem;
  }

  /* ── Summary Cards ── */
  .cards {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
    gap: 1rem;
    margin-bottom: 2rem;
  }

  .card {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 1rem;
    text-align: center;
  }

  .card .number {
    font-size: 2rem;
    font-weight: 700;
    line-height: 1;
  }

  .card .label {
    font-size: 0.8rem;
    color: var(--text-muted);
    margin-top: 0.25rem;
  }

  .card.green .number { color: var(--green); }
  .card.red .number { color: var(--red); }
  .card.yellow .number { color: var(--yellow); }
  .card.blue .number { color: var(--blue); }

  /* ── Sections ── */
  .section {
    margin-bottom: 2rem;
  }

  .section-header {
    font-size: 1.1rem;
    font-weight: 600;
    padding: 0.75rem 1rem;
    border-radius: 8px 8px 0 0;
    border: 1px solid var(--border);
    cursor: pointer;
    user-select: none;
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }

  .section-header:hover {
    opacity: 0.9;
  }

  .section-header.green-header { background: var(--green-bg); border-color: #1a4d2e; }
  .section-header.red-header { background: var(--red-bg); border-color: #4d1f22; }
  .section-header.yellow-header { background: var(--yellow-bg); border-color: #4d3a1a; }

  .section-header .badge {
    background: rgba(255,255,255,0.1);
    padding: 0.15rem 0.5rem;
    border-radius: 10px;
    font-size: 0.75rem;
    margin-left: auto;
  }

  .section-header .arrow {
    transition: transform 0.2s;
    font-size: 0.75rem;
  }

  .section-body {
    border: 1px solid var(--border);
    border-top: none;
    border-radius: 0 0 8px 8px;
    overflow: hidden;
  }

  .section-body.collapsed {
    display: none;
  }

  /* ── Table list ── */
  .obj-table {
    width: 100%;
    border-collapse: collapse;
  }

  .obj-table th {
    text-align: left;
    padding: 0.5rem 1rem;
    background: var(--surface);
    color: var(--text-muted);
    font-size: 0.8rem;
    font-weight: 500;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    border-bottom: 1px solid var(--border);
  }

  .obj-table td {
    padding: 0.5rem 1rem;
    border-bottom: 1px solid var(--border);
    font-size: 0.9rem;
  }

  .obj-table tr:last-child td { border-bottom: none; }
  .obj-table tr:hover td { background: rgba(255,255,255,0.02); }

  .category-badge {
    display: inline-block;
    padding: 0.1rem 0.5rem;
    border-radius: 4px;
    font-size: 0.75rem;
    background: var(--surface);
    border: 1px solid var(--border);
    color: var(--text-muted);
  }

  /* ── Diff blocks ── */
  .diff-item {
    border-bottom: 1px solid var(--border);
    padding: 1rem;
  }

  .diff-item:last-child { border-bottom: none; }

  .diff-item-header {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    margin-bottom: 0.5rem;
    cursor: pointer;
  }

  .diff-item-header .name {
    font-weight: 600;
    font-size: 0.95rem;
  }

  .diff-block {
    background: #0d1117;
    border: 1px solid var(--border);
    border-radius: 6px;
    padding: 0.75rem;
    font-family: 'SF Mono', 'Fira Code', monospace;
    font-size: 0.8rem;
    overflow-x: auto;
    max-height: 400px;
    overflow-y: auto;
  }

  .diff-line {
    white-space: pre;
    padding: 1px 0;
  }

  .diff-line.dev {
    color: var(--green);
    background: rgba(63, 185, 80, 0.08);
  }

  .diff-line.prod {
    color: var(--red);
    background: rgba(248, 81, 73, 0.08);
  }

  .diff-line.ctx {
    color: var(--text-muted);
  }

  .diff-line.sep {
    color: var(--blue);
    padding: 0.25rem 0;
  }

  /* ── Sync banner ── */
  .sync-banner {
    text-align: center;
    padding: 3rem;
    color: var(--green);
    font-size: 1.2rem;
  }

  /* ── Filter ── */
  .filter-bar {
    display: flex;
    gap: 0.5rem;
    margin-bottom: 1.5rem;
    flex-wrap: wrap;
  }

  .filter-btn {
    padding: 0.4rem 0.8rem;
    border-radius: 6px;
    border: 1px solid var(--border);
    background: var(--surface);
    color: var(--text);
    font-size: 0.85rem;
    cursor: pointer;
  }

  .filter-btn:hover { border-color: var(--blue); }
  .filter-btn.active { border-color: var(--blue); background: var(--blue-bg); }
</style>
</head>
<body>

<div class="header">
  <h1>📊 DEV vs PROD — DDL Comparison</h1>
  <div class="meta">Generated: ${timestamp}</div>
</div>

<div class="cards">
  <div class="card blue">
    <div class="number">${summary.total_dev}</div>
    <div class="label">DEV objects</div>
  </div>
  <div class="card blue">
    <div class="number">${summary.total_prod}</div>
    <div class="label">PROD objects</div>
  </div>
  <div class="card green">
    <div class="number">${summary.identical}</div>
    <div class="label">Identical</div>
  </div>
  <div class="card yellow">
    <div class="number">${summary.modified}</div>
    <div class="label">Modified</div>
  </div>
  <div class="card green">
    <div class="number">${summary.only_dev}</div>
    <div class="label">Only DEV</div>
  </div>
  <div class="card red">
    <div class="number">${summary.only_prod}</div>
    <div class="label">Only PROD</div>
  </div>
</div>

${totalDiffs === 0 ? '<div class="sync-banner">🎉 DEV and PROD are perfectly in sync!</div>' : ""}

${
  onlyDev.length > 0
    ? `
<div class="section" id="section-dev">
  <div class="section-header green-header" onclick="toggle('dev')">
    <span class="arrow" id="arrow-dev">▼</span>
    🟢 Only in DEV
    <span class="badge">${onlyDev.length}</span>
  </div>
  <div class="section-body" id="body-dev">
    <table class="obj-table">
      <thead><tr><th>Category</th><th>Object</th></tr></thead>
      <tbody>
        ${onlyDev.map((i) => `<tr><td><span class="category-badge">${escapeHtml(i.category)}</span></td><td>${escapeHtml(i.object)}</td></tr>`).join("\n        ")}
      </tbody>
    </table>
  </div>
</div>`
    : ""
}

${
  onlyProd.length > 0
    ? `
<div class="section" id="section-prod">
  <div class="section-header red-header" onclick="toggle('prod')">
    <span class="arrow" id="arrow-prod">▼</span>
    🔴 Only in PROD
    <span class="badge">${onlyProd.length}</span>
  </div>
  <div class="section-body" id="body-prod">
    <table class="obj-table">
      <thead><tr><th>Category</th><th>Object</th></tr></thead>
      <tbody>
        ${onlyProd.map((i) => `<tr><td><span class="category-badge">${escapeHtml(i.category)}</span></td><td>${escapeHtml(i.object)}</td></tr>`).join("\n        ")}
      </tbody>
    </table>
  </div>
</div>`
    : ""
}

${
  modified.length > 0
    ? `
<div class="section" id="section-modified">
  <div class="section-header yellow-header" onclick="toggle('modified')">
    <span class="arrow" id="arrow-modified">▼</span>
    🔄 Modified
    <span class="badge">${modified.length}</span>
  </div>
  <div class="section-body" id="body-modified">
    ${modified
      .map(
        (item) => `
    <div class="diff-item">
      <div class="diff-item-header">
        <span class="category-badge">${escapeHtml(item.category)}</span>
        <span class="name">${escapeHtml(item.object)}</span>
      </div>
      ${
        item.diff && item.diff.length > 0
          ? `<div class="diff-block">${item.diff
              .slice(0, 50)
              .map((d) => {
                const cls = d.startsWith("- DEV")
                  ? "dev"
                  : d.startsWith("+ PROD")
                    ? "prod"
                    : d.trim() === "..."
                      ? "sep"
                      : "ctx";
                return `<div class="diff-line ${cls}">${escapeHtml(d)}</div>`;
              })
              .join(
                ""
              )}${item.diff.length > 50 ? `<div class="diff-line" style="color:var(--text-muted)">... ${item.diff.length - 50} more lines</div>` : ""}</div>`
          : ""
      }
    </div>`
      )
      .join("")}
  </div>
</div>`
    : ""
}

<script>
function toggle(id) {
  const body = document.getElementById('body-' + id);
  const arrow = document.getElementById('arrow-' + id);
  if (body.classList.contains('collapsed')) {
    body.classList.remove('collapsed');
    arrow.textContent = '▼';
  } else {
    body.classList.add('collapsed');
    arrow.textContent = '▶';
  }
}
</script>
</body>
</html>`;
}
