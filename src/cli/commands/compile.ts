/**
 * HQL Compile Command
 * Compiles HQL to JavaScript or native binary (wrapping Deno compile)
 */

import { transpileCLI } from "../../bundler.ts";
import {
  exit as platformExit,
  resolve,
  dirname,
  basename,
} from "../../platform/platform.ts";
import { hasHelpFlag, getPositionalArgs } from "../utils/common-helpers.ts";
import { parseCliOptions, applyCliOptions } from "../utils/cli-options.ts";
import { ensureDenoAvailable } from "../utils/toolchain.ts";

/**
 * Target mapping from friendly names to Deno compile targets
 */
const TARGET_MAP: Record<string, string | undefined> = {
  "js": undefined,       // JavaScript output (no deno compile)
  "native": undefined,   // Current platform (no --target flag for deno compile)
  "linux": "x86_64-unknown-linux-gnu",
  "macos": "aarch64-apple-darwin",        // ARM64 (M1/M2/M3/M4) - primary
  "macos-intel": "x86_64-apple-darwin",   // x86_64 (Intel) - legacy
  "windows": "x86_64-pc-windows-msvc",
};

/**
 * All binary targets for --target all
 */
const ALL_BINARY_TARGETS = ["linux", "macos", "macos-intel", "windows"];

/**
 * Valid friendly target names for help display
 */
const FRIENDLY_TARGETS = ["js", "native", "all", "linux", "macos", "macos-intel", "windows"];

/**
 * Compile options parsed from CLI args
 */
interface CompileOptions {
  inputFile: string;
  target: string;
  outputPath?: string;
  verbose?: boolean;
  showTiming?: boolean;
  debug?: boolean;
}

/**
 * Display compile command help
 */
export function showCompileHelp(): void {
  console.log(`
HQL Compile - Compile HQL to JavaScript or native binary

USAGE:
  hql compile <file.hql> [options]

OPTIONS:
  --target <target>     Compilation target (default: js)
                        js          - JavaScript output
                        native      - Binary for current platform
                        all         - All platforms (linux, macos, macos-intel, windows)
                        linux       - Linux x86_64 binary
                        macos       - macOS ARM64 binary (M1/M2/M3/M4)
                        macos-intel - macOS x86_64 binary (Intel)
                        windows     - Windows x86_64 binary
  -o, --output <path>   Output file path (or directory for --target all)
  --verbose, -v         Enable verbose logging
  --time                Show performance timing
  --debug               Show detailed error information
  --help, -h            Show this help message

EXAMPLES:
  hql compile app.hql                     # Compile to JavaScript
  hql compile app.hql --target native     # Compile to native binary
  hql compile app.hql --target all        # Compile for ALL platforms
  hql compile app.hql --target linux      # Cross-compile to Linux
  hql compile app.hql --target native -o myapp  # Custom output name

CROSS-COMPILATION:
  Cross-compilation targets (linux, macos, windows) require Deno to download
  the appropriate toolchain on first use.
`);
}

/**
 * Parse --target flag from args
 */
function parseTarget(args: string[]): string {
  const targetIndex = args.findIndex(arg => arg === "--target" || arg === "-t");
  if (targetIndex !== -1 && args[targetIndex + 1]) {
    return args[targetIndex + 1];
  }
  return "js"; // Default to JavaScript output
}

/**
 * Parse -o/--output flag from args
 */
function parseOutput(args: string[]): string | undefined {
  const outputIndex = args.findIndex(arg => arg === "--output" || arg === "-o");
  if (outputIndex !== -1 && args[outputIndex + 1]) {
    return args[outputIndex + 1];
  }
  return undefined;
}

/**
 * Parse compile options from CLI args
 */
function parseCompileOptions(args: string[]): CompileOptions {
  const positional = getPositionalArgs(args);
  const cliOptions = parseCliOptions(args);

  const inputFile = positional[0];
  if (!inputFile) {
    console.error("Error: No input file specified");
    showCompileHelp();
    platformExit(1);
  }

  const target = parseTarget(args);
  const outputPath = parseOutput(args);

  return {
    inputFile,
    target,
    outputPath,
    verbose: cliOptions.verbose,
    showTiming: cliOptions.showTiming,
    debug: cliOptions.debug,
  };
}

/**
 * Map friendly target name to Deno compile target
 */
function mapTarget(target: string): string | undefined {
  // If it's a friendly name, map it
  if (target in TARGET_MAP) {
    return TARGET_MAP[target];
  }
  // Otherwise pass through as-is (for advanced users specifying full Deno targets)
  return target;
}

/**
 * Derive output filename from input
 */
function deriveOutputName(inputFile: string, target: string): string {
  const baseName = basename(inputFile).replace(/\.(hql|js|ts)$/, "");

  if (target === "js") {
    return baseName + ".js";
  }

  if (target === "all") {
    // For "all", we return the base name; platform suffix added later
    return baseName;
  }

  // For binary targets
  if (target === "windows" || target.includes("windows")) {
    return baseName + ".exe";
  }

  return baseName;
}

/**
 * Get output filename for a specific platform when using --target all
 */
function deriveOutputNameForPlatform(baseName: string, target: string): string {
  const suffix = target === "windows" ? ".exe" : "";
  return `${baseName}-${target}${suffix}`;
}

/**
 * Safely remove a temporary file
 */
async function cleanupTempFile(filePath: string): Promise<void> {
  try {
    await Deno.remove(filePath);
  } catch {
    // Ignore cleanup errors
  }
}

/**
 * Invoke Deno compile on the transpiled JavaScript
 */
async function invokeDenoCompile(
  jsFile: string,
  target: string,
  outputPath: string,
  verbose: boolean
): Promise<void> {
  const denoBinary = await ensureDenoAvailable();
  const denoTarget = mapTarget(target);

  // Build deno compile args
  const args = ["compile", "--allow-all"];

  // Add target flag if not native (native uses current platform)
  if (denoTarget && target !== "native") {
    args.push("--target", denoTarget);
  }

  // Add output flag
  args.push("--output", outputPath);

  // Add the JavaScript file to compile
  args.push(jsFile);

  if (verbose) {
    console.log(`[compile] Invoking: ${denoBinary} ${args.join(" ")}`);
  }

  // Execute deno compile
  const cmd = new Deno.Command(denoBinary, {
    args,
    stdout: "piped",
    stderr: "piped",
  });

  const result = await cmd.output();

  if (!result.success) {
    const stderr = new TextDecoder().decode(result.stderr);
    throw new Error(`Compilation to ${target} failed.\n${stderr}`);
  }

  const stdout = new TextDecoder().decode(result.stdout);
  if (stdout.trim()) {
    console.log(stdout);
  }
}

/**
 * Compile for all platforms
 */
async function compileForAllPlatforms(
  jsFile: string,
  baseName: string,
  outputDir: string,
  verbose: boolean
): Promise<string[]> {
  const outputs: string[] = [];
  const errors: string[] = [];

  console.log(`\nCompiling for ${ALL_BINARY_TARGETS.length} platforms...`);

  for (const target of ALL_BINARY_TARGETS) {
    const outputName = deriveOutputNameForPlatform(baseName, target);
    const outputPath = resolve(outputDir, outputName);

    console.log(`  [${target}] Creating binary...`);

    try {
      await invokeDenoCompile(jsFile, target, outputPath, verbose);
      outputs.push(outputPath);
      console.log(`  [${target}] Done: ${outputName}`);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      errors.push(`${target}: ${msg}`);
      console.error(`  [${target}] Failed: ${msg}`);
    }
  }

  if (errors.length > 0 && outputs.length === 0) {
    throw new Error(`All platform compilations failed:\n${errors.join("\n")}`);
  }

  return outputs;
}

/**
 * Main compile command
 */
export async function compileCommand(args: string[]): Promise<void> {
  // Handle help flag
  if (hasHelpFlag(args)) {
    showCompileHelp();
    platformExit(0);
  }

  // Parse options
  const options = parseCompileOptions(args);

  // Validate target
  const target = options.target;
  const isFriendlyTarget = FRIENDLY_TARGETS.includes(target);
  const isDenoTarget = target.includes("-") && target.includes("unknown");

  if (!isFriendlyTarget && !isDenoTarget) {
    console.error(`Unknown target '${target}'.`);
    console.error(`Valid targets: ${FRIENDLY_TARGETS.join(", ")}`);
    console.error("Or use a full Deno target like: x86_64-unknown-linux-gnu");
    platformExit(1);
  }

  // Apply CLI options for logging
  applyCliOptions({
    verbose: options.verbose,
    showTiming: options.showTiming,
    debug: options.debug,
  });

  const resolvedInput = resolve(options.inputFile);
  const inputDir = dirname(resolvedInput);

  // Determine output path/directory
  const outputName = options.outputPath || deriveOutputName(options.inputFile, target);
  const outputPath = resolve(outputName);

  if (options.verbose) {
    console.log(`[compile] Input: ${resolvedInput}`);
    console.log(`[compile] Target: ${target}`);
    console.log(`[compile] Output: ${outputPath}`);
  }

  // Step 1: Transpile HQL to JavaScript
  console.log(`Compiling ${options.inputFile}...`);

  const jsOutputPath = target === "js"
    ? outputPath
    : resolve(inputDir, `.hql-compile-temp-${Date.now()}.js`);

  try {
    await transpileCLI(resolvedInput, jsOutputPath, {
      verbose: options.verbose,
      showTiming: options.showTiming,
    });

    // Step 2: Handle different target types
    if (target === "js") {
      console.log(`JavaScript output: ${outputPath}`);
    } else if (target === "all") {
      // Compile for all platforms
      const baseName = options.outputPath || basename(options.inputFile).replace(/\.(hql|js|ts)$/, "");
      const outputDir = dirname(outputPath);
      const outputs = await compileForAllPlatforms(jsOutputPath, baseName, outputDir, options.verbose ?? false);
      await cleanupTempFile(jsOutputPath);

      console.log(`\nCreated ${outputs.length} binaries:`);
      for (const out of outputs) {
        console.log(`  - ${basename(out)}`);
      }
    } else {
      // Single platform target
      console.log(`Creating ${target} binary...`);
      await invokeDenoCompile(jsOutputPath, target, outputPath, options.verbose ?? false);
      await cleanupTempFile(jsOutputPath);
      console.log(`Binary created: ${outputPath}`);
    }
  } catch (error) {
    if (target !== "js") {
      await cleanupTempFile(jsOutputPath);
    }
    throw error;
  }
}
