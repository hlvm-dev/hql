/**
 * Common CLI helper functions
 * Shared utilities to avoid duplication across CLI commands
 */

/**
 * Check if args contain help flag
 */
export function hasHelpFlag(args: string[]): boolean {
  return args.includes("--help") || args.includes("-h");
}

/**
 * Check if args contain a specific flag
 */
export function hasFlag(args: string[], flag: string): boolean {
  return args.includes(flag);
}

/**
 * Filter positional arguments (non-flags)
 */
export function getPositionalArgs(args: string[]): string[] {
  return args.filter(arg => !arg.startsWith("-"));
}
