/**
 * LSP Diagnostics Feature
 *
 * Converts HQL analysis errors to LSP diagnostics format.
 */

import {
  DiagnosticSeverity,
} from "npm:vscode-languageserver@9.0.1";
import type { Diagnostic } from "npm:vscode-languageserver@9.0.1";
import type { AnalysisResult, AnalysisError } from "../analysis.ts";
import { toLSPRange } from "../utils/position.ts";

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
