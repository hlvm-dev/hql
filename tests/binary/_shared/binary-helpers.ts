/**
 * Shared helpers for binary tests
 * These tests run the HQL CLI as a subprocess (compiled binary or deno run)
 */

import { assertEquals, assertStringIncludes } from "https://deno.land/std@0.218.0/assert/mod.ts";

// Path to CLI entry point
const CLI_PATH = new URL("../../../src/cli/cli.ts", import.meta.url).pathname;

// Binary test mode: set HQL_TEST_BINARY=1 for genuine binary testing
// Default: quick mode using deno run (same code path, faster)
export const USE_BINARY = Deno.env.get("HQL_TEST_BINARY") === "1";

// Cross-platform binary path
const IS_WINDOWS = Deno.build.os === "windows";
const TEMP_DIR = (Deno.env.get(IS_WINDOWS ? "TEMP" : "TMPDIR") || (IS_WINDOWS ? "C:\\Temp" : "/tmp")).replace(/[\/\\]$/, "");
const BINARY_NAME = IS_WINDOWS ? "hql-test-binary.exe" : "hql-test-binary";
export const BINARY_PATH = IS_WINDOWS ? `${TEMP_DIR}\\${BINARY_NAME}` : `${TEMP_DIR}/${BINARY_NAME}`;

// Track compilation state with mutex to prevent race conditions
let binaryCompiled = false;
let compilationPromise: Promise<void> | null = null;

/**
 * Command execution result
 */
export interface CommandResult {
  success: boolean;
  code: number;
  stdout: string;
  stderr: string;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// BINARY COMPILATION
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * Compile the HQL binary (only when USE_BINARY mode is enabled)
 * Uses mutex pattern to ensure only one compilation happens even with parallel tests
 */
export async function ensureBinaryCompiled(): Promise<void> {
  if (!USE_BINARY || binaryCompiled) return;
  if (compilationPromise) {
    await compilationPromise;
    return;
  }

  compilationPromise = (async () => {
    console.log("Compiling HQL binary for genuine binary testing...");
    const cmd = new Deno.Command("deno", {
      args: ["compile", "-A", "--output", BINARY_PATH, CLI_PATH],
      stdout: "piped",
      stderr: "piped",
    });

    const { success, stderr } = await cmd.output();
    if (!success) {
      compilationPromise = null;
      throw new Error(`Failed to compile binary: ${new TextDecoder().decode(stderr)}`);
    }

    binaryCompiled = true;
    console.log("Binary compiled: " + BINARY_PATH);
  })();

  await compilationPromise;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// ASSERTION HELPERS (DRY)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/** Assert command succeeded */
export function assertSuccess(result: CommandResult, message?: string): void {
  assertEquals(result.success, true, message || result.stderr);
}

/** Assert output contains expected string */
export function assertOutput(result: CommandResult, expected: string): void {
  assertStringIncludes(result.stdout, expected);
}

/** Assert command succeeded and output contains expected string */
export function assertSuccessWithOutput(result: CommandResult, expected: string): void {
  assertSuccess(result);
  assertOutput(result, expected);
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// TEST WRAPPER (reduces boilerplate)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * Create a binary test with standard options
 * Reduces boilerplate: sanitizeResources/sanitizeOps are always false for subprocess tests
 */
export function binaryTest(name: string, fn: () => Promise<void>): void {
  Deno.test({ name, sanitizeResources: false, sanitizeOps: false, fn });
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// CLI EXECUTION
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/** Internal: Execute CLI with given args */
async function executeCLI(args: string[]): Promise<CommandResult> {
  await ensureBinaryCompiled();

  const cmd = USE_BINARY
    ? new Deno.Command(BINARY_PATH, { args, stdout: "piped", stderr: "piped" })
    : new Deno.Command("deno", { args: ["run", "-A", CLI_PATH, ...args], stdout: "piped", stderr: "piped" });

  const output = await cmd.output();
  return {
    success: output.success,
    code: output.code,
    stdout: new TextDecoder().decode(output.stdout),
    stderr: new TextDecoder().decode(output.stderr),
  };
}

/**
 * Run CLI with raw args (for --version, --help without subcommand)
 */
export function runRawCLI(args: string[]): Promise<CommandResult> {
  return executeCLI(args);
}

/**
 * Run a CLI command and return the result
 * @param command - The CLI command (compile, run, init, repl, publish)
 * @param args - Arguments to pass to the command
 */
export function runCLI(command: string, args: string[] = []): Promise<CommandResult> {
  return executeCLI([command, ...args]);
}

/**
 * Run an HQL expression and return the result
 * Shorthand for: runCLI("run", [expression])
 */
export async function runExpression(expression: string): Promise<CommandResult> {
  return runCLI("run", [expression]);
}

/**
 * Compile HQL code to JavaScript and return the output
 */
export async function transpileCode(hqlCode: string): Promise<{ js: string; result: CommandResult }> {
  return withTempDir(async (dir) => {
    const inputPath = `${dir}/test.hql`;
    const outputPath = `${dir}/test.js`;

    await Deno.writeTextFile(inputPath, hqlCode);
    const result = await runCLI("compile", [inputPath, "-o", outputPath]);

    let js = "";
    if (result.success) {
      try {
        js = await Deno.readTextFile(outputPath);
      } catch {
        // File might not exist if compilation failed
      }
    }

    return { js, result };
  });
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// COMPILE AND RUN (DRY - shared implementation)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/** Run a command and return result */
async function executeCommand(program: string, args: string[]): Promise<CommandResult> {
  const cmd = new Deno.Command(program, { args, stdout: "piped", stderr: "piped" });
  const output = await cmd.output();
  return {
    success: output.success,
    code: output.code,
    stdout: new TextDecoder().decode(output.stdout),
    stderr: new TextDecoder().decode(output.stderr),
  };
}

/** Compile HQL to JS and run with specified runtime */
async function compileAndRunWith(
  hqlCode: string,
  runtime: "node" | "deno"
): Promise<CommandResult> {
  return withTempDir(async (dir) => {
    const inputPath = `${dir}/test.hql`;
    const outputPath = `${dir}/test.js`;

    await Deno.writeTextFile(inputPath, hqlCode);
    const compileResult = await runCLI("compile", [inputPath, "-o", outputPath]);

    if (!compileResult.success) return compileResult;

    return runtime === "node"
      ? executeCommand("node", [outputPath])
      : executeCommand("deno", ["run", outputPath]);
  });
}

/** Compile HQL to JS and run the output with Node.js */
export function transpileAndRunWithNode(hqlCode: string): Promise<CommandResult> {
  return compileAndRunWith(hqlCode, "node");
}

/** Compile HQL to JS and run the output with Deno */
export function transpileAndRunWithDeno(hqlCode: string): Promise<CommandResult> {
  return compileAndRunWith(hqlCode, "deno");
}

/**
 * Execute a function with a temporary directory, cleaning up afterwards
 */
export async function withTempDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const tempDir = await Deno.makeTempDir({ prefix: "hql-test-" });
  try {
    return await fn(tempDir);
  } finally {
    try {
      await Deno.remove(tempDir, { recursive: true });
    } catch {
      // Ignore cleanup errors
    }
  }
}

/**
 * Create a temporary HQL project with hql.json
 */
export async function withTempProject<T>(
  fn: (dir: string) => Promise<T>,
  options?: { name?: string; version?: string; entry?: string }
): Promise<T> {
  return withTempDir(async (dir) => {
    const hqlJson = {
      name: options?.name || "test-project",
      version: options?.version || "0.0.1",
      exports: options?.entry || "./mod.hql",
    };
    await Deno.writeTextFile(`${dir}/hql.json`, JSON.stringify(hqlJson, null, 2));
    return fn(dir);
  });
}

export { CLI_PATH };
