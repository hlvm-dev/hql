/**
 * HQL Ink REPL - Type Definitions (minimal)
 */

/** Evaluation result from HQL/JS */
export interface EvalResult {
  success: boolean;
  value?: unknown;
  error?: Error;
  suppressOutput?: boolean;
}
