/**
 * Log API - SSOT for all logging operations
 *
 * This module provides a unified logging interface that wraps the globalLogger.
 * All logging in the codebase should go through this API.
 *
 * Categories:
 * - Diagnostics (log.debug/info/warn/error) - Controlled by verbose flag
 * - User Output (log.raw.*) - Direct console output for CLI results
 *
 * SSOT: This is registered on globalThis.log for REPL access.
 */

import { globalLogger, Logger } from "../../logger.ts";

/**
 * Namespaced log interface for scoped logging
 */
export interface NamespacedLog {
  debug(message: string): void;
  info(message: string): void;
  warn(message: string): void;
  error(message: string, error?: unknown): void;
}

/**
 * Log API interface - SSOT for all logging
 */
export interface LogApi {
  // Diagnostics (filtered by verbose flag)
  debug(message: string, ...args: unknown[]): void;
  info(message: string, ...args: unknown[]): void;
  warn(message: string, ...args: unknown[]): void;
  error(message: string, error?: unknown): void;

  // Namespaced logging
  ns(namespace: string): NamespacedLog;

  // Control
  setVerbose(enabled: boolean): void;
  readonly verbose: boolean;

  // Configure namespace filtering
  setNamespaces(namespaces: string[]): void;

  // Raw output (for intentional CLI output - ALLOWED BYPASS)
  // Use these when you need to output user-facing results
  raw: {
    log(...args: unknown[]): void;
    error(...args: unknown[]): void;
    warn(...args: unknown[]): void;
    table(data: unknown): void;
    clear(): void;
  };
}

/**
 * Format message with optional arguments
 */
function formatMessage(message: string, args: unknown[]): string {
  if (args.length === 0) return message;

  // Simple interpolation: replace %s, %d, %j with args
  let result = message;
  let argIndex = 0;

  result = result.replace(/%[sdj]/g, (match) => {
    if (argIndex >= args.length) return match;
    const arg = args[argIndex++];

    switch (match) {
      case "%s":
        return String(arg);
      case "%d":
        return Number(arg).toString();
      case "%j":
        try {
          return JSON.stringify(arg);
        } catch {
          return "[Circular]";
        }
      default:
        return match;
    }
  });

  // Append any remaining args
  if (argIndex < args.length) {
    const remaining = args.slice(argIndex).map((a) =>
      typeof a === "object" ? JSON.stringify(a) : String(a)
    ).join(" ");
    result += " " + remaining;
  }

  return result;
}

/**
 * Create a namespaced log instance
 */
function createNamespacedLog(namespace: string): NamespacedLog {
  return {
    debug: (message: string) => globalLogger.debug(message, namespace),
    info: (message: string) => globalLogger.info(message, namespace),
    warn: (message: string) => globalLogger.warn(message, namespace),
    error: (message: string, error?: unknown) => globalLogger.error(message, error, namespace),
  };
}

/**
 * Log API implementation
 */
export const log: LogApi = {
  debug(message: string, ...args: unknown[]): void {
    globalLogger.debug(formatMessage(message, args));
  },

  info(message: string, ...args: unknown[]): void {
    globalLogger.info(formatMessage(message, args));
  },

  warn(message: string, ...args: unknown[]): void {
    globalLogger.warn(formatMessage(message, args));
  },

  error(message: string, error?: unknown): void {
    globalLogger.error(message, error);
  },

  ns(namespace: string): NamespacedLog {
    return createNamespacedLog(namespace);
  },

  setVerbose(enabled: boolean): void {
    globalLogger.setEnabled(enabled);
  },

  get verbose(): boolean {
    return globalLogger.enabled;
  },

  setNamespaces(namespaces: string[]): void {
    Logger.setAllowedNamespaces(namespaces);
  },

  // Raw output - direct console access for intentional CLI output
  // This is an ALLOWED BYPASS per SSOT-CONTRACT.md
  raw: {
    log(...args: unknown[]): void {
      console.log(...args);
    },
    error(...args: unknown[]): void {
      console.error(...args);
    },
    warn(...args: unknown[]): void {
      console.warn(...args);
    },
    table(data: unknown): void {
      console.table(data);
    },
    clear(): void {
      console.clear();
    },
  },
};

export default log;
