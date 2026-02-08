import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";

/** Object categories mapped to folder names */
export type ObjectCategory =
  | "schemas"
  | "tables"
  | "functions"
  | "views"
  | "materialized_views"
  | "sequences"
  | "triggers"
  | "types"
  | "indexes";

/** Sanitize a name for safe filesystem usage */
function sanitize(name: string): string {
  return name.replace(/[^\w.\-]/g, "_");
}

/** Build the header comment for each .sql file */
function buildHeader(objectName: string, category: string): string {
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
function contentHash(content: string): string {
  const normalized = content
    .split("\n")
    .filter((l) => !l.startsWith("-- Extracted:"))
    .map((l) => l.trimEnd())
    .filter((l) => l.trim() !== "")
    .join("\n");
  return crypto.createHash("md5").update(normalized).digest("hex");
}

export class SqlFileWriter {
  private baseDir: string;
  private counts: Record<string, number> = {};
  private unchanged: number = 0;
  private updated: number = 0;
  private created: number = 0;

  constructor(baseDir: string) {
    this.baseDir = baseDir;
    // Create the output dir if it doesn't exist (don't delete!)
    fs.mkdirSync(baseDir, { recursive: true });
  }

  /** Write a single DDL file (only if changed) */
  write(category: ObjectCategory, objectName: string, ddl: string): string {
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
      } else {
        // Content changed - will update
        this.updated++;
      }
    } else {
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
  writeFull(allDdl: string): string {
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
  getSummary(): Record<string, number> {
    return { ...this.counts };
  }

  /** Get change statistics */
  getChangeStats(): { created: number; updated: number; unchanged: number } {
    return {
      created: this.created,
      updated: this.updated,
      unchanged: this.unchanged,
    };
  }
}
