#!/usr/bin/env deno run -A

import { run as hqlRun, runFile } from "../../mod.ts";
import { globalLogger as logger, Logger } from "../src/logger.ts";
import { initializeRuntime } from "../src/common/runtime-initializer.ts";
import { createTempDir } from "../src/common/hql-cache-tracker.ts";
import {
  applyCliOptions,
  CliOptions,
  parseCliOptions,
  parseLogNamespaces,
  parseNonOptionArgs,
} from "./utils/cli-options.ts";
import {
  getArgs as platformGetArgs,
  exists as platformExists,
} from "../src/platform/platform.ts";

// Import the enhanced error handling system
import {
  enrichErrorWithContext,
  initializeErrorSystem,
  runWithErrorHandling,
  setErrorContext,
  updateErrorConfig,
} from "../src/common/error-system.ts";

import { hasHelpFlag } from "./utils/common-helpers.ts";

// Constants
const FILE_EXTENSIONS = [".hql", ".js", ".ts"] as const;
const PRINT_COMMAND_PREFIXES = new Set([
  "(print ",
  "(print(",
  "(println ",
  "(console.log",
] as const);

/**
 * Print CLI usage information
 */
function printHelp(): void {
  console.error(
    "Usage: deno run -A cli/run.ts <target.hql|target.js> [options]",
  );
  console.error("       deno run -A cli/run.ts '<expression>' [options]");
  console.error("\nOptions:");
  console.error(
    "  --verbose             Enable verbose logging and enhanced error formatting",
  );
  console.error("  --time                Show performance timing information");
  console.error(
    "  --log <namespaces>    Filter logging to specified namespaces",
  );
  console.error(
    "  --print               Print final JS output without executing",
  );
  console.error(
    "  --debug               Show detailed debug information and stack traces",
  );
  console.error("  --help, -h            Display this help message");
  console.error("\nExamples:");
  console.error("  deno run -A cli/run.ts '(+ 1 1)'        # Auto-prints: 2");
  console.error("  deno run -A cli/run.ts '(* 5 6)'        # Auto-prints: 30");
  console.error("  deno run -A cli/run.ts hello.hql        # Run file");
}

/**
 * Detect if input is an HQL expression or a file path
 */
function isExpression(input: string): boolean {
  // S-expressions start with '('
  if (input.trim().startsWith("(")) {
    return true;
  }

  // Known file extensions are files
  if (FILE_EXTENSIONS.some(ext => input.endsWith(ext))) {
    return false;
  }

  // Default to expression
  return true;
}

/**
 * Find end of first S-expression using depth tracking
 * Returns -1 if not found or malformed
 */
function findFirstExpressionEnd(expression: string): number {
  let depth = 0;

  for (let i = 0; i < expression.length; i++) {
    const char = expression[i];

    if (char === "(") {
      depth++;
    } else if (char === ")") {
      depth--;

      // Found matching close paren
      if (depth === 0) {
        return i;
      }

      // Unbalanced - more closing than opening
      if (depth < 0) {
        return -1;
      }
    }
  }

  // Unclosed expression
  return -1;
}

/**
 * Check if expression is a single S-expression (no other code after)
 */
function isSingleExpression(expression: string): boolean {
  const firstExprEnd = findFirstExpressionEnd(expression);

  // Malformed or incomplete
  if (firstExprEnd === -1) {
    return false;
  }

  const afterFirst = expression.slice(firstExprEnd + 1).trim();

  // Nothing meaningful after first expression
  return afterFirst === "" || afterFirst.startsWith(";");
}

/**
 * Determine if expression should auto-print its result
 * Only auto-prints single S-expressions without explicit print
 */
function shouldAutoPrint(expression: string): boolean {
  const trimmed = expression.trim();

  // Must be an S-expression
  if (!trimmed.startsWith("(")) {
    return false;
  }

  // Don't auto-print if already has print command
  for (const prefix of PRINT_COMMAND_PREFIXES) {
    if (trimmed.startsWith(prefix)) {
      return false;
    }
  }

  // Only auto-print single expressions
  return isSingleExpression(trimmed);
}

/**
 * Function to execute an HQL file or expression with enhanced error handling
 */
async function executeHql(
  options: CliOptions,
  input: string,
  isExpr: boolean,
): Promise<void> {
  if (options.verbose) {
    logger.setEnabled(true);
  }

  setErrorContext(input, undefined);

  try {
    let result: unknown;

    if (isExpr) {
      // Execute inline expression
      logger.debug(`Executing expression: ${input.slice(0, 50)}...`);
      result = await hqlRun(input);

      // Auto-print single expressions if they don't already print
      if (shouldAutoPrint(input) && result !== undefined) {
        console.log(result);
      }
    } else {
      // Execute file
      logger.debug(`Executing file: ${input}`);

      // Check if file exists first
      if (!await platformExists(input)) {
        throw new Error(`File not found: ${input}`);
      }

      result = await runFile(input, {
        verbose: options.verbose,
      });
    }
  } catch (error) {
    const enrichedError = await enrichErrorWithContext(error as Error, input);
    throw enrichedError;
  }
}

/**
 * Main entry point for the HQL CLI
 */
export async function run(args: string[] = platformGetArgs()): Promise<number> {
  // Parse options early to configure error system
  const cliOptions = parseCliOptions(args);

  // Initialize error system with debug flag if present
  initializeErrorSystem({
    debug: cliOptions.debug,
    verboseErrors: cliOptions.verbose,
  });

  // Run the main function with enhanced error handling
  return await runWithErrorHandling(async () => {
    await initializeRuntime();

    if (hasHelpFlag(args)) {
      printHelp();
      return 0;
    }

    const namespaces = parseLogNamespaces(args);

    if (namespaces.length) {
      Logger.allowedNamespaces = namespaces;
      console.log(`Logging restricted to namespaces: ${namespaces.join(", ")}`);
    }

    const positional = parseNonOptionArgs(args);
    if (!positional.length) {
      printHelp();
      return 1;
    }

    applyCliOptions(cliOptions);

    // Update error config based on debug flag
    if (args.includes("--debug")) {
      cliOptions.debug = true;
      updateErrorConfig({ debug: true, showInternalErrors: true });
      console.log("Debug mode enabled - showing extended error information");
    }

    logger.startTiming("run", "Total Processing");

    const runDir = await createTempDir("run");

    logger.log({
      text: `Created temporary directory: ${runDir}`,
      namespace: "cli",
    });

    const input = positional[0];

    // Detect if input is an expression or file path
    const isExpr = isExpression(input);

    if (isExpr) {
      logger.log({
        text: `Detected expression input`,
        namespace: "cli",
      });
    } else {
      logger.log({
        text: `Detected file input: ${input}`,
        namespace: "cli",
      });
    }

    await executeHql(cliOptions, input, isExpr);

    logger.endTiming("run", "Total Processing");

    return 0;
  }, {
    debug: cliOptions.debug,
    exitOnError: true,
    currentFile: parseNonOptionArgs(args)[0], // Pass the current file for context
  });
}

if (import.meta.main) {
  run();
}
