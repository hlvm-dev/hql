/**
 * CLI option parsing and application utilities
 */
import { parseArgs } from "@std/cli/parse-args";
import { globalLogger } from "../../../logger.ts";
import { platformCwd } from "./platform-helpers.ts";

export type TeammateMode = "in-process" | "tmux" | "auto";

export interface CliOptions {
  verbose?: boolean;
  showTiming?: boolean;
  forceCache?: boolean;
  debug?: boolean;
  teammateMode?: TeammateMode;
}

/**
 * Parse standard CLI flags into a structured options object.
 */
export function parseCliOptions(args: string[]): CliOptions {
  const parsed = parseArgs(args, {
    boolean: ["verbose", "time", "force-cache", "no-force-cache", "no-cache", "debug"],
    string: ["teammate-mode"],
    alias: { v: "verbose" },
  });

  const teammateMode = parsed["teammate-mode"] as string | undefined;
  const validModes: TeammateMode[] = ["in-process", "tmux", "auto"];

  return {
    verbose: parsed.verbose || undefined,
    showTiming: parsed.time || undefined,
    forceCache: parsed["force-cache"]
      ? true
      : (parsed["no-force-cache"] || parsed["no-cache"])
      ? false
      : undefined,
    debug: parsed.debug || undefined,
    teammateMode: teammateMode && validModes.includes(teammateMode as TeammateMode)
      ? teammateMode as TeammateMode
      : undefined,
  };
}

/**
 * Apply CLI options to the global logger.
 */
export function applyCliOptions(options: CliOptions): void {
  globalLogger.setEnabled(Boolean(options.verbose));
  globalLogger.setTimingOptions({ showTiming: Boolean(options.showTiming) });

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
  const parsed = parseArgs(args, {
    string: ["log"],
  });

  if (!parsed.log) return [];
  return parsed.log.split(",").map((ns: string) => ns.trim()).filter((ns: string) =>
    ns.length > 0
  );
}
