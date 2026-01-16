/**
 * LSP Workspace Module
 *
 * Provides workspace-wide intelligence for cross-file navigation.
 */

export { ProjectIndex } from "./project-index.ts";
export { ImportResolver } from "./import-resolver.ts";
export { ModuleAnalyzer } from "./module-analyzer.ts";
export type { ModuleExport, ModuleInfo } from "./module-analyzer.ts";
export * from "./types.ts";

// Workspace scanning
export { WorkspaceScanner } from "./workspace-scanner.ts";
export type { ScanResult } from "./workspace-scanner.ts";
