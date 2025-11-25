#!/usr/bin/env deno run -A

import { transpileCLI } from "../bundler.ts";
import { globalLogger as logger } from "../logger.ts";
import {
  applyCliOptions,
  type CliOptions,
  parseCliOptions,
  parseNonOptionArgs,
} from "./utils/cli-options.ts";
import { initializeRuntime } from "../common/runtime-initializer.ts";
import {
  exit as platformExit,
  getArgs as platformGetArgs,
  readTextFile as platformReadTextFile,
  resolve,
} from "../platform/platform.ts";

// Import the enhanced error handling system
import {
  enrichErrorWithContext,
  initializeErrorSystem,
  runWithErrorHandling,
  setErrorContext,
  updateErrorConfig,
} from "../common/error-system.ts";
import { hasHelpFlag, hasFlag, getPositionalArgs } from "./utils/common-helpers.ts";

/**
 * Utility to time async phases and log durations
 */
async function timed<T>(
  category: string,
  label: string,
  fn: () => Promise<T>,
): Promise<T> {
  logger.startTiming(category, label);
  try {
    return await fn();
  } finally {
    logger.endTiming(category, label);
  }
}

/**
 * Display CLI usage
 */
function printHelp(): void {
  console.error(
    `Usage: deno run -A cli/transpile.ts <input.hql|input.js> [output.js] [options]`,
  );
  console.error("\nOptions:");
  console.error("  --run             Execute the transpiled output");
  console.error("  --verbose, -v     Enable verbose logging");
  console.error("  --time            Show timing for each phase");
  console.error(
    "  --print           Print JS to stdout instead of writing to file",
  );
  console.error(
    "  --debug           Show detailed error information and stack traces",
  );
  console.error("  --help, -h        Show this help message");
  console.error("\nExamples:");
  console.error("  deno run -A cli/transpile.ts src/file.hql");
  console.error(
    "  deno run -A cli/transpile.ts src/file.hql dist/file.js --time",
  );
  console.error("  deno run -A cli/transpile.ts src/file.hql --print --run");
  console.error("  deno run -A cli/transpile.ts src/file.hql --debug");
}

/**
 * Result of parsing transpile paths
 */
interface TranspilePaths {
  readonly inputPath: string;
  readonly outputPath?: string;
}

/**
 * Validate input path exists
 */
function validateInputPath(inputPath: string | undefined): asserts inputPath is string {
  if (!inputPath) {
    console.error("Error: No input file specified");
    printHelp();
    platformExit(1);
  }
}

/**
 * Parse and validate transpile file paths
 */
function parsePaths(args: string[]): TranspilePaths {
  const positional = getPositionalArgs(args);

  const inputPath = positional[0];
  validateInputPath(inputPath);

  const outputPath = positional.length > 1 ? positional[1] : undefined;

  return { inputPath, outputPath };
}

/**
 * Invoke transpiler with error handling
 */
async function transpile(
  inputPath: string,
  outputPath: string | undefined,
  opts: CliOptions,
): Promise<string> {
  // Only use forceCache for controlling recompilation
  const force = opts.forceCache;

  return await timed("transpile", "Compile", async () => {
    const resolvedInputPath = resolve(inputPath);

    // Register context for error reporting
    setErrorContext(resolvedInputPath, outputPath);

    try {
      // Use direct execution with error handling
      // Skip bundling in compiled binary (esbuild doesn't work there)
      const bundledPath = await transpileCLI(resolvedInputPath, outputPath, {
        verbose: opts.verbose,
        showTiming: opts.showTiming,
        force: force,
        skipBundle: true, // Always skip bundling for transpile command
      });
      // Update context with the actual JS bundle path once known
      setErrorContext(resolvedInputPath, bundledPath);
      return bundledPath;
    } catch (transpileError) {
      // Enrich transpile errors with source context
      const enrichedError = await enrichErrorWithContext(
        transpileError as Error,
        resolvedInputPath,
      );
      throw enrichedError;
    }
  });
}

/**
 * Print bundled JS content
 */
function printJS(bundledPath: string): Promise<void> {
  return timed("transpile", "Output Read", async () => {
    const content = await platformReadTextFile(bundledPath);
    console.log(content);
  });
}

/**
 * Dynamically import and execute the JS file
 */
async function runJS(bundledPath: string): Promise<void> {
  console.log(`Running: ${bundledPath}`);
  return await timed("transpile", "Execute", async () => {
    try {
      await import("file://" + resolve(bundledPath));
    } catch (runError) {
      // In case of runtime errors, enrich them with source context
      // This helps trace error back to the original HQL source
      const enrichedError = await enrichErrorWithContext(runError as Error, bundledPath);
      throw enrichedError;
    }
  });
}

/**
 * Entry point
 */
export async function main(args: string[] = platformGetArgs()): Promise<void> {
  // Parse options early for error system configuration
  const opts = parseCliOptions(args);

  // Initialize error system with debug flag if present
  initializeErrorSystem({
    debug: opts.debug,
    verboseErrors: opts.verbose,
  });

  await runWithErrorHandling(async () => {
    // Handle help flag
    if (hasHelpFlag(args)) {
      printHelp();
      platformExit(0); // Exit with success for help
    }

    // Require at least one argument (input file)
    if (!args.length) {
      printHelp();
      platformExit(1);
    }

    // Initialize runtime early - this will prevent redundant initializations later
    await initializeRuntime();

    // Parse paths
    const { inputPath, outputPath } = parsePaths(args);

    // Configure debug mode
    if (hasFlag(args, "--debug")) {
      opts.debug = true;
      updateErrorConfig({ debug: true, showInternalErrors: true });
      console.log("Debug mode enabled - showing detailed error information");
    }

    applyCliOptions(opts);

    // Log processing info if verbose
    if (opts.verbose) {
      logger.debug(`Processing file: ${inputPath}`);
      if (outputPath) {
        logger.debug(`Output will be written to: ${outputPath}`);
      }
    }

    // Transpile the file
    const bundledPath = await transpile(inputPath, outputPath, opts);

    // Handle output flags
    if (hasFlag(args, "--print")) {
      await printJS(bundledPath);
    }

    if (hasFlag(args, "--run")) {
      await runJS(bundledPath);
    }

    logger.logPerformance("transpile", inputPath.split("/").pop()!);
  }, {
    debug: opts.debug,
    exitOnError: true,
    currentFile: parseNonOptionArgs(args)[0],
  });
}

if (import.meta.main) {
  main();
}
