/**
 * Shared helpers for binary tests
 * These tests run the HLVM CLI as a subprocess (compiled binary or deno run)
 */

import { assertEquals, assertStringIncludes } from "https://deno.land/std@0.218.0/assert/mod.ts";

// Path to CLI entry point
export const CLI_PATH = new URL("../../../src/hlvm/cli/cli.ts", import.meta.url).pathname;

// Binary test mode: set HLVM_TEST_BINARY=1 for genuine binary testing
// Default: quick mode using deno run (same code path, faster)
export const USE_BINARY = Deno.env.get("HLVM_TEST_BINARY") === "1";

// Cross-platform binary path
const IS_WINDOWS = Deno.build.os === "windows";
const TEMP_DIR = (Deno.env.get(IS_WINDOWS ? "TEMP" : "TMPDIR") || (IS_WINDOWS ? "C:\\Temp" : "/tmp")).replace(/[\/\\]$/, "");
const BINARY_NAME = IS_WINDOWS ? "hlvm-test-binary.exe" : "hlvm-test-binary";
export const BINARY_PATH = IS_WINDOWS ? `${TEMP_DIR}\\${BINARY_NAME}` : `${TEMP_DIR}/${BINARY_NAME}`;
const COMPILE_LOCK_PATH = `${BINARY_PATH}.lock`;
export const BINARY_TEST_HLVM_DIR = Deno.makeTempDirSync({ prefix: "hlvm-binary-tests-" });

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

export interface CommandOptions {
  cwd?: string;
  env?: Record<string, string>;
}

export function getBinaryTestEnv(overrides: Record<string, string> = {}): Record<string, string> {
  return {
    ...Deno.env.toObject(),
    HLVM_DIR: BINARY_TEST_HLVM_DIR,
    HLVM_DISABLE_AI_AUTOSTART: "1",
    ...overrides,
  };
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// BINARY COMPILATION
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * Compile the HLVM binary (only when USE_BINARY mode is enabled)
 * Uses mutex pattern to ensure only one compilation happens even with parallel tests
 */
export async function ensureBinaryCompiled(): Promise<void> {
  if (!USE_BINARY || binaryCompiled) return;
  if (compilationPromise) {
    await compilationPromise;
    return;
  }

  compilationPromise = (async () => {
    if (await fileExists(BINARY_PATH)) {
      binaryCompiled = true;
      return;
    }

    const lockFile = await tryAcquireCompileLock();
    if (lockFile) {
      try {
        if (!(await fileExists(BINARY_PATH))) {
          console.log("Compiling HLVM binary for genuine binary testing...");
          const cmd = new Deno.Command("deno", {
            args: ["compile", "-A", "--no-check", "--output", BINARY_PATH, CLI_PATH],
            stdout: "piped",
            stderr: "piped",
          });

          const { success, stderr } = await cmd.output();
          if (!success) {
            throw new Error(`Failed to compile binary: ${new TextDecoder().decode(stderr)}`);
          }
          console.log("Binary compiled: " + BINARY_PATH);
        }
      } finally {
        lockFile.close();
        await removeIfExists(COMPILE_LOCK_PATH);
      }
      binaryCompiled = true;
      return;
    }

    await waitForCompiledBinary();
    binaryCompiled = true;
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

/** Assert command succeeded and output contains all expected substrings */
export function assertSuccessWithOutputs(result: CommandResult, ...expected: string[]): void {
  assertSuccess(result);
  expected.forEach((value) => assertOutput(result, value));
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// TEST WRAPPER (reduces boilerplate)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * Create a binary test with standard options
 * Reduces boilerplate: sanitizeResources/sanitizeOps are always false for subprocess tests
 */
export function binaryTest(name: string, fn: () => void | Promise<void>): void {
  Deno.test({ name, sanitizeResources: false, sanitizeOps: false, fn });
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// CLI EXECUTION
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/** Internal: Execute CLI with given args */
async function executeCLI(args: string[], options?: CommandOptions): Promise<CommandResult> {
  await ensureBinaryCompiled();

  const cmd = USE_BINARY
    ? new Deno.Command(BINARY_PATH, {
        args,
        cwd: options?.cwd,
        env: getBinaryTestEnv(options?.env),
        stdout: "piped",
        stderr: "piped",
      })
    : new Deno.Command("deno", {
        args: ["run", "-A", CLI_PATH, ...args],
        cwd: options?.cwd,
        env: getBinaryTestEnv(options?.env),
        stdout: "piped",
        stderr: "piped",
      });

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
export function runCLI(
  command: string,
  args: string[] = [],
  options?: CommandOptions,
): Promise<CommandResult> {
  return executeCLI([command, ...args], options);
}

/**
 * Run an HQL expression and return the result
 * Shorthand for: runCLI("run", [expression])
 */
export function runExpression(
  expression: string,
  options?: CommandOptions,
): Promise<CommandResult> {
  return runCLI("run", [expression], options);
}

/**
 * Compile HQL code to JavaScript and return the output
 */
export function transpileCode(hqlCode: string): Promise<{ js: string; result: CommandResult }> {
  return withTempDir(async (dir) => {
    const inputPath = `${dir}/test.hql`;
    const outputPath = `${dir}/test.js`;

    await Deno.writeTextFile(inputPath, hqlCode);
    const result = await runCLI("hql", ["compile", inputPath, "-o", outputPath]);

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
function compileAndRunWith(
  hqlCode: string,
  runtime: "node" | "deno"
): Promise<CommandResult> {
  return withTempDir(async (dir) => {
    const inputPath = `${dir}/test.hql`;
    const outputPath = `${dir}/test.js`;

    await Deno.writeTextFile(inputPath, hqlCode);
    const compileResult = await runCLI("hql", ["compile", inputPath, "-o", outputPath]);

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

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// TEMP DIRECTORY HELPERS
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * Create a temporary directory, run callback, and clean up.
 */
export async function withTempDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await Deno.makeTempDir({ prefix: "hlvm-binary-test-" });
  try {
    return await fn(dir);
  } finally {
    await Deno.remove(dir, { recursive: true }).catch(() => {});
  }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// LOCK FILE HELPERS
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

async function tryAcquireCompileLock(): Promise<Deno.FsFile | null> {
  try {
    return await Deno.open(COMPILE_LOCK_PATH, { write: true, createNew: true });
  } catch {
    return null;
  }
}

async function waitForCompiledBinary(): Promise<void> {
  for (let i = 0; i < 120; i++) {
    if (await fileExists(BINARY_PATH)) return;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error(`Timed out waiting for compiled binary at ${BINARY_PATH}`);
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await Deno.stat(path);
    return true;
  } catch {
    return false;
  }
}

async function removeIfExists(path: string): Promise<void> {
  try {
    await Deno.remove(path);
  } catch {
    // ignore
  }
}
