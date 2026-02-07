import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";
import { Client } from "pg";

interface SnapshotMeta {
  timestamp: string;
  database: string;
  hash: string;
  objectHashes: Record<string, string>;
}

/**
 * Manages incremental snapshots by tracking per-object hashes.
 * On subsequent runs, only objects whose hash changed are re-extracted.
 */
export class SnapshotManager {
  private metaFile: string;
  private meta: SnapshotMeta | null = null;

  constructor(outputDir: string) {
    this.metaFile = path.join(outputDir, ".snapshot-meta.json");
    this.load();
  }

  /** Load existing snapshot metadata */
  private load(): void {
    if (fs.existsSync(this.metaFile)) {
      try {
        this.meta = JSON.parse(fs.readFileSync(this.metaFile, "utf-8"));
      } catch {
        this.meta = null;
      }
    }
  }

  /** Get last snapshot timestamp */
  getLastTimestamp(): string | null {
    return this.meta?.timestamp || null;
  }

  /** Check if an object has changed since the last snapshot */
  hasChanged(objectKey: string, currentHash: string): boolean {
    if (!this.meta) return true;
    return this.meta.objectHashes[objectKey] !== currentHash;
  }

  /** Save snapshot metadata */
  save(database: string, objectHashes: Record<string, string>): void {
    const allValues = Object.values(objectHashes).sort().join("");
    const hash = crypto.createHash("md5").update(allValues).digest("hex");

    const meta: SnapshotMeta = {
      timestamp: new Date().toISOString(),
      database,
      hash,
      objectHashes,
    };

    const dir = path.dirname(this.metaFile);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(this.metaFile, JSON.stringify(meta, null, 2), "utf-8");
    this.meta = meta;
  }

  /** Get a summary of changes */
  getChangeSummary(newHashes: Record<string, string>): {
    added: string[];
    modified: string[];
    removed: string[];
    unchanged: string[];
  } {
    const added: string[] = [];
    const modified: string[] = [];
    const removed: string[] = [];
    const unchanged: string[] = [];

    const oldHashes = this.meta?.objectHashes || {};

    // Check new objects
    for (const [key, hash] of Object.entries(newHashes)) {
      if (!(key in oldHashes)) {
        added.push(key);
      } else if (oldHashes[key] !== hash) {
        modified.push(key);
      } else {
        unchanged.push(key);
      }
    }

    // Check removed objects
    for (const key of Object.keys(oldHashes)) {
      if (!(key in newHashes)) {
        removed.push(key);
      }
    }

    return { added, modified, removed, unchanged };
  }
}

/**
 * Query per-object hashes from the database.
 * Each object gets a hash based on its DDL definition.
 */
export async function getObjectHashes(client: Client): Promise<Record<string, string>> {
  const hashes: Record<string, string> = {};

  // Tables
  const { rows: tables } = await client.query(`
    SELECT
      schemaname || '.' || tablename AS obj_key,
      md5(string_agg(
        c.column_name || ':' || c.data_type || ':' || c.is_nullable || ':' || COALESCE(c.column_default, ''),
        '|' ORDER BY c.ordinal_position
      )) AS obj_hash
    FROM pg_tables t
    JOIN information_schema.columns c
      ON c.table_schema = t.schemaname AND c.table_name = t.tablename
    WHERE t.schemaname NOT IN ('pg_catalog', 'information_schema', 'pg_toast')
    GROUP BY t.schemaname, t.tablename;
  `);
  for (const r of tables) {
    hashes[`tables/${r.obj_key}`] = r.obj_hash;
  }

  // Functions
  const { rows: funcs } = await client.query(`
    SELECT
      n.nspname || '.' || p.proname AS obj_key,
      md5(pg_get_functiondef(p.oid)) AS obj_hash
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname NOT IN ('pg_catalog', 'information_schema', 'pg_toast');
  `);
  for (const r of funcs) {
    hashes[`functions/${r.obj_key}`] = r.obj_hash;
  }

  // Views
  const { rows: views } = await client.query(`
    SELECT
      schemaname || '.' || viewname AS obj_key,
      md5(definition) AS obj_hash
    FROM pg_views
    WHERE schemaname NOT IN ('pg_catalog', 'information_schema', 'pg_toast');
  `);
  for (const r of views) {
    hashes[`views/${r.obj_key}`] = r.obj_hash;
  }

  // Materialized views
  const { rows: matviews } = await client.query(`
    SELECT
      schemaname || '.' || matviewname AS obj_key,
      md5(definition) AS obj_hash
    FROM pg_matviews
    WHERE schemaname NOT IN ('pg_catalog', 'information_schema', 'pg_toast');
  `);
  for (const r of matviews) {
    hashes[`materialized_views/${r.obj_key}`] = r.obj_hash;
  }

  // Triggers
  const { rows: triggers } = await client.query(`
    SELECT
      trigger_schema || '.' || trigger_name AS obj_key,
      md5(string_agg(action_timing || event_manipulation || action_statement, '|' ORDER BY event_manipulation)) AS obj_hash
    FROM information_schema.triggers
    WHERE trigger_schema NOT IN ('pg_catalog', 'information_schema', 'pg_toast')
    GROUP BY trigger_schema, trigger_name;
  `);
  for (const r of triggers) {
    hashes[`triggers/${r.obj_key}`] = r.obj_hash;
  }

  // Indexes
  const { rows: indexes } = await client.query(`
    SELECT
      schemaname || '.' || indexname AS obj_key,
      md5(indexdef) AS obj_hash
    FROM pg_indexes
    WHERE schemaname NOT IN ('pg_catalog', 'information_schema', 'pg_toast')
      AND indexname NOT IN (
        SELECT constraint_name FROM information_schema.table_constraints
        WHERE constraint_type IN ('PRIMARY KEY', 'UNIQUE')
      );
  `);
  for (const r of indexes) {
    hashes[`indexes/${r.obj_key}`] = r.obj_hash;
  }

  // Sequences
  const { rows: seqs } = await client.query(`
    SELECT
      sequence_schema || '.' || sequence_name AS obj_key,
      md5(start_value || increment || minimum_value || maximum_value || cycle_option) AS obj_hash
    FROM information_schema.sequences
    WHERE sequence_schema NOT IN ('pg_catalog', 'information_schema', 'pg_toast');
  `);
  for (const r of seqs) {
    hashes[`sequences/${r.obj_key}`] = r.obj_hash;
  }

  // Types (enum)
  const { rows: types } = await client.query(`
    SELECT
      n.nspname || '.' || t.typname AS obj_key,
      md5(COALESCE(string_agg(e.enumlabel, '|' ORDER BY e.enumsortorder), '')) AS obj_hash
    FROM pg_type t
    JOIN pg_namespace n ON n.oid = t.typnamespace
    LEFT JOIN pg_enum e ON e.enumtypid = t.oid
    WHERE n.nspname NOT IN ('pg_catalog', 'information_schema', 'pg_toast')
      AND (t.typtype = 'e' OR (t.typtype = 'c' AND EXISTS(
        SELECT 1 FROM pg_class c WHERE c.oid = t.typrelid AND c.relkind = 'c'
      )))
    GROUP BY n.nspname, t.typname;
  `);
  for (const r of types) {
    hashes[`types/${r.obj_key}`] = r.obj_hash;
  }

  return hashes;
}
