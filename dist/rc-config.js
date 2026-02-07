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
exports.loadRcConfig = loadRcConfig;
exports.mergeWithCliOptions = mergeWithCliOptions;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
// ─── Config Loader ────────────────────────────────────────────
const CONFIG_FILENAMES = [
    ".pg-ddl-extractor.json",
    ".pg-ddl-extractor.yml",
    ".pg-ddl-extractor.yaml",
    "pg-ddl-extractor.config.json",
];
function loadRcConfig(startDir) {
    const searchDir = startDir || process.cwd();
    for (const filename of CONFIG_FILENAMES) {
        const filepath = path.join(searchDir, filename);
        if (fs.existsSync(filepath)) {
            try {
                const content = fs.readFileSync(filepath, "utf-8");
                if (filename.endsWith(".json")) {
                    return JSON.parse(content);
                }
                // Simple YAML-like parser for basic config
                if (filename.endsWith(".yml") || filename.endsWith(".yaml")) {
                    return parseSimpleYaml(content);
                }
            }
            catch (err) {
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
function parseSimpleYaml(content) {
    const result = {};
    const lines = content.split("\n");
    const stack = [{ indent: -1, obj: result, key: "" }];
    for (const rawLine of lines) {
        const line = rawLine.replace(/\r$/, "");
        // Skip empty lines and comments
        if (line.trim() === "" || line.trim().startsWith("#"))
            continue;
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
        if (colonIdx === -1)
            continue;
        const key = trimmed.slice(0, colonIdx).trim();
        const rawValue = trimmed.slice(colonIdx + 1).trim();
        if (rawValue === "" || rawValue === "|") {
            // Nested object or upcoming array
            parent[key] = {};
            stack.push({ indent, obj: parent, key });
        }
        else {
            parent[key] = parseValue(rawValue);
        }
    }
    return result;
}
function parseValue(raw) {
    // Remove quotes
    if ((raw.startsWith('"') && raw.endsWith('"')) || (raw.startsWith("'") && raw.endsWith("'"))) {
        return raw.slice(1, -1);
    }
    // Boolean
    if (raw === "true")
        return true;
    if (raw === "false")
        return false;
    // Number
    const num = Number(raw);
    if (!isNaN(num) && raw !== "")
        return num;
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
function mergeWithCliOptions(rcConfig, cliOptions) {
    const merged = { ...cliOptions };
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
