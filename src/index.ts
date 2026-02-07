// Public API exports
export { SqlFileWriter, ObjectCategory } from "./writer";
export { DdlExtractor, ExtractionFilters } from "./extractor";
export { getDbConfig } from "./config";
export { getSshConfig, createSshTunnel } from "./tunnel";
export { compareDdl, formatConsoleReport, formatMarkdownReport, formatHtmlReport } from "./compare";
export {
  generateMigration,
  generateRollback,
  saveMigration,
  saveRollback,
  formatMigrationSql,
  formatRollbackSql,
  printMigrationSummary,
  printDryRun,
} from "./migration-generator";

export { SchemaLinter, printLintReport } from "./linter";

// Re-export types
export type { Client } from "pg";
export type { LintResult, LintIssue, LintSeverity } from "./linter";
