// Public API exports
export { SqlFileWriter, ObjectCategory } from "./writer";
export { DdlExtractor, ExtractionFilters } from "./extractor";
export { getDbConfig } from "./config";
export { getSshConfig, createSshTunnel } from "./tunnel";
export {
  compareDdl,
  compareDdlDirs,
  compareMultiEnv,
  formatConsoleReport,
  formatMarkdownReport,
  formatHtmlReport,
  formatMultiEnvReport,
} from "./compare";
export {
  generateMigration,
  generateRollback,
  saveMigration,
  saveRollback,
  formatMigrationSql,
  formatRollbackSql,
  printMigrationSummary,
  printDryRun,
  interactiveReview,
} from "./migration-generator";

export { SchemaLinter, printLintReport } from "./linter";
export { DataExtractor } from "./data-extractor";
export { DocsGenerator, formatDocsMarkdown, formatDocsMermaid } from "./docs-generator";
export { loadRcConfig, mergeWithCliOptions } from "./rc-config";

// Re-export types
export type { Client } from "pg";
export type { LintResult, LintIssue, LintSeverity } from "./linter";
