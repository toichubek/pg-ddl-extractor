import * as fs from "fs";
import * as path from "path";

// ─── Types ────────────────────────────────────────────────────

export interface RcConfig {
  defaults?: {
    env?: string;
    output?: string;
  };
  environments?: Record<
    string,
    {
      host?: string;
      port?: number;
      database?: string;
      user?: string;
      password?: string;
    }
  >;
  extract?: {
    schema?: string[];
    excludeSchema?: string[];
    tables?: string[];
    excludeTables?: string[];
    withData?: string[];
    maxRows?: number;
  };
  migration?: {
    withRollback?: boolean;
    interactive?: boolean;
  };
  lint?: {
    rules?: Record<string, boolean>;
  };
}

// ─── Config Loader ────────────────────────────────────────────

const CONFIG_FILENAMES = [
  ".pg-ddl-extractor.json",
  ".pg-ddl-extractor.yml",
  ".pg-ddl-extractor.yaml",
  "pg-ddl-extractor.config.json",
];

export function loadRcConfig(startDir?: string): RcConfig | null {
  const searchDir = startDir || process.cwd();

  for (const filename of CONFIG_FILENAMES) {
    const filepath = path.join(searchDir, filename);
    if (fs.existsSync(filepath)) {
      try {
        const content = fs.readFileSync(filepath, "utf-8");

        if (filename.endsWith(".json")) {
          return JSON.parse(content) as RcConfig;
        }

        // Simple YAML-like parser for basic config
        if (filename.endsWith(".yml") || filename.endsWith(".yaml")) {
          return parseSimpleYaml(content);
        }
      } catch (err: any) {
        console.error(`⚠️  Error reading config file ${filepath}: ${err.message}`);
        return null;
      }
    }
  }

  return null;
}

/**
 * Simple YAML parser for flat/nested config.
 * Supports basic key: value, nested objects, and arrays with "- item" syntax.
 */
function parseSimpleYaml(content: string): RcConfig {
  const result: any = {};
  const lines = content.split("\n");
  const stack: { indent: number; obj: any; key: string }[] = [{ indent: -1, obj: result, key: "" }];

  for (const rawLine of lines) {
    const line = rawLine.replace(/\r$/, "");

    // Skip empty lines and comments
    if (line.trim() === "" || line.trim().startsWith("#")) continue;

    const indent = line.search(/\S/);
    const trimmed = line.trim();

    // Pop stack to find parent
    while (stack.length > 1 && stack[stack.length - 1].indent >= indent) {
      stack.pop();
    }

    const parent = stack[stack.length - 1].obj;

    // Array item
    if (trimmed.startsWith("- ")) {
      const value = trimmed.slice(2).trim();
      const parentKey = stack[stack.length - 1].key;
      if (parentKey && Array.isArray(parent[parentKey])) {
        parent[parentKey].push(parseValue(value));
      }
      continue;
    }

    // Key-value pair
    const colonIdx = trimmed.indexOf(":");
    if (colonIdx === -1) continue;

    const key = trimmed.slice(0, colonIdx).trim();
    const rawValue = trimmed.slice(colonIdx + 1).trim();

    if (rawValue === "" || rawValue === "|") {
      // Nested object or upcoming array
      parent[key] = {};
      stack.push({ indent, obj: parent, key });
    } else {
      parent[key] = parseValue(rawValue);
    }
  }

  return result as RcConfig;
}

function parseValue(raw: string): any {
  // Remove quotes
  if ((raw.startsWith('"') && raw.endsWith('"')) || (raw.startsWith("'") && raw.endsWith("'"))) {
    return raw.slice(1, -1);
  }

  // Boolean
  if (raw === "true") return true;
  if (raw === "false") return false;

  // Number
  const num = Number(raw);
  if (!isNaN(num) && raw !== "") return num;

  // Array inline [a, b, c]
  if (raw.startsWith("[") && raw.endsWith("]")) {
    return raw
      .slice(1, -1)
      .split(",")
      .map((s) => parseValue(s.trim()));
  }

  return raw;
}

/**
 * Merge RC config with CLI options. CLI options take precedence.
 */
export function mergeWithCliOptions(
  rcConfig: RcConfig,
  cliOptions: Record<string, any>
): Record<string, any> {
  const merged: Record<string, any> = { ...cliOptions };

  // Apply defaults only if CLI option is not set
  if (rcConfig.defaults) {
    if (!merged.env && rcConfig.defaults.env) {
      merged.env = rcConfig.defaults.env;
    }
    if (!merged.output && rcConfig.defaults.output) {
      merged.output = rcConfig.defaults.output;
    }
  }

  // Apply extract filters if not overridden by CLI
  if (rcConfig.extract) {
    if (!merged.schema && rcConfig.extract.schema) {
      merged.schema = rcConfig.extract.schema.join(",");
    }
    if (!merged.excludeSchema && rcConfig.extract.excludeSchema) {
      merged.excludeSchema = rcConfig.extract.excludeSchema.join(",");
    }
    if (!merged.tables && rcConfig.extract.tables) {
      merged.tables = rcConfig.extract.tables.join(",");
    }
    if (!merged.excludeTables && rcConfig.extract.excludeTables) {
      merged.excludeTables = rcConfig.extract.excludeTables.join(",");
    }
    if (!merged.withData && rcConfig.extract.withData) {
      merged.withData = rcConfig.extract.withData.join(",");
    }
    if (!merged.maxRows && rcConfig.extract.maxRows) {
      merged.maxRows = String(rcConfig.extract.maxRows);
    }
  }

  // Apply migration settings if not overridden
  if (rcConfig.migration) {
    if (merged.withRollback === undefined && rcConfig.migration.withRollback) {
      merged.withRollback = rcConfig.migration.withRollback;
    }
    if (merged.interactive === undefined && rcConfig.migration.interactive) {
      merged.interactive = rcConfig.migration.interactive;
    }
  }

  return merged;
}
