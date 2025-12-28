/**
 * LSP Diagnostics Feature
 *
 * Converts HQL analysis errors to LSP diagnostics format.
 * Also detects unused imports.
 */

import {
  DiagnosticSeverity,
} from "npm:vscode-languageserver@9.0.1";
import type { Diagnostic } from "npm:vscode-languageserver@9.0.1";
import type { AnalysisResult, AnalysisError } from "../analysis.ts";
import { toLSPRange } from "../utils/position.ts";
import { findUnusedImports } from "../imports/symbol-usage.ts";
import { extractImportsFromAST, findAllImportsViaAST } from "../imports/ast-import-adapter.ts";
import type { SExp } from "../../src/s-exp/types.ts";

/**
 * Convert analysis result to LSP diagnostics
 */
export function getDiagnostics(analysis: AnalysisResult): Diagnostic[] {
  return analysis.errors.map(errorToDiagnostic);
}

/**
 * Convert a single analysis error to an LSP diagnostic
 */
function errorToDiagnostic(error: AnalysisError): Diagnostic {
  return {
    severity: severityToLSP(error.severity),
    range: toLSPRange(error.range),
    message: error.message,
    code: error.code,
    source: "hql",
  };
}

/**
 * Convert HQL severity to LSP DiagnosticSeverity
 */
function severityToLSP(severity: 1 | 2 | 3 | 4): DiagnosticSeverity {
  switch (severity) {
    case 1:
      return DiagnosticSeverity.Error;
    case 2:
      return DiagnosticSeverity.Warning;
    case 3:
      return DiagnosticSeverity.Information;
    case 4:
      return DiagnosticSeverity.Hint;
    default:
      return DiagnosticSeverity.Error;
  }
}

/**
 * Detect unused imports in a document and return diagnostics
 *
 * @param content - Document text content
 * @param filePath - File path for error reporting
 * @param ast - Optional pre-parsed AST to avoid re-parsing
 */
export function getUnusedImportDiagnostics(
  content: string,
  filePath: string,
  ast?: SExp[] | null
): Diagnostic[] {
  // Extract imports - use pre-parsed AST if available to avoid re-parsing
  const imports = ast
    ? extractImportsFromAST(ast, content)
    : findAllImportsViaAST(content, filePath);

  const unusedImports = findUnusedImports(content, imports);

  return unusedImports.map((unused) => ({
    severity: DiagnosticSeverity.Warning,
    range: unused.range,
    message: `'${unused.symbolName}' is imported but never used`,
    code: "unused-import",
    source: "hql",
    data: {
      symbolName: unused.symbolName,
      originalName: unused.originalName,
      isNamespace: unused.isNamespace,
      importLine: unused.importLine,
      modulePath: unused.modulePath,
    },
  }));
}
