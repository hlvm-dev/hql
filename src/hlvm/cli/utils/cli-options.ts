/**
 * CLI option parsing and application utilities
 */
import { globalLogger } from "../../../logger.ts";
import {
  cwd as platformCwd,
  setEnv as platformSetEnv,
} from "../../../platform/platform.ts";

export interface CliOptions {
  verbose?: boolean;
  showTiming?: boolean;
  forceCache?: boolean;
  debug?: boolean;
}

/**
 * Extract positional args (non-options)
 */
export function parseNonOptionArgs(args: string[]): string[] {
  return args.filter((arg) => !arg.startsWith("-"));
}

/**
 * Parse standard CLI flags into a structured options object.
 */
export function parseCliOptions(args: string[]): CliOptions {
  const options: CliOptions = {};

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    switch (arg) {
      case "--verbose":
      case "-v":
        options.verbose = true;
        break;
      case "--time":
        options.showTiming = true;
        break;
      case "--force-cache":
        options.forceCache = true;
        break;
      case "--no-force-cache":
      case "--no-cache":
        options.forceCache = false;
        break;
      case "--debug":
        options.debug = true;
        break;
      default:
        break;
    }
  }

  return options;
}

/**
 * Apply CLI options to the global logger and runtime environment.
 */
export function applyCliOptions(options: CliOptions): void {
  globalLogger.setEnabled(Boolean(options.verbose));
  globalLogger.setTimingOptions({ showTiming: Boolean(options.showTiming) });

  if (options.forceCache !== undefined) {
    platformSetEnv("HLVM_FORCE_REBUILD", options.forceCache ? "1" : "0");
  }

  if (options.forceCache === false && options.verbose) {
    const cachePath = `${platformCwd()}/.hlvm-cache`;
    globalLogger.log({
      text: `Reusing cache at ${cachePath}`,
      namespace: "cli",
    });
  }
}

/**
 * Extract log namespace settings from CLI args
 */
export function parseLogNamespaces(args: string[]): string[] {
  const logIndex = args.findIndex((arg) =>
    arg === "--log" || arg.startsWith("--log=")
  );

  if (logIndex === -1) return [];

  let namespaceArg = "";
  const arg = args[logIndex];

  if (arg.includes("=")) {
    namespaceArg = arg.split("=")[1];
  } else if (args[logIndex + 1] && !args[logIndex + 1].startsWith("-")) {
    namespaceArg = args[logIndex + 1];
  }

  return namespaceArg.split(",").map((ns) => ns.trim()).filter((ns) =>
    ns.length > 0
  );
}
