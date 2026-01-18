// deno-lint-ignore-file no-explicit-any
/**
 * Shared Test Helpers - Single Source of Truth
 *
 * All unit tests should import helper functions from here to avoid duplication.
 */
import hql, { type RunOptions } from "../../mod.ts";
import { getPlatform } from "../../src/platform/platform.ts";
import { transpileToJavascript } from "../../src/hql/transpiler/hql-transpiler.ts";
import { generateTypeScript } from "../../src/hql/transpiler/pipeline/ir-to-typescript.ts";
import { transformToIR } from "../../src/hql/transpiler/pipeline/hql-ast-to-hql-ir.ts";
import { parse } from "../../src/hql/transpiler/pipeline/parser.ts";
import { initializeRuntimeHelpers } from "../../src/common/runtime-helpers.ts";

const path = () => getPlatform().path;
const dirname = (p: string) => path().dirname(p);
const fromFileUrl = (url: string | URL) => path().fromFileUrl(url);
const join = (...paths: string[]) => path().join(...paths);

// GLOBAL FIX: Disable AI auto-start for ALL unit tests that use this helper.
// This prevents "Leaks detected" errors caused by the runtime spawning background processes.
Deno.env.set("HLVM_DISABLE_AI_AUTOSTART", "1");

// Get the directory containing the test files
const testDir = dirname(fromFileUrl(import.meta.url));

// Resolve fixture paths relative to test directory
function resolveFixturePath(code: string): string {
  // Replace relative fixture paths with absolute paths
  return code.replace(
    /["']\.\/test\/fixtures\//g,
    (match) => {
      const quote = match[0];
      return `${quote}${join(testDir, "fixtures")}/`;
    },
  );
}

// ============================================================================
// Core HQL Execution Helpers
// ============================================================================

/**
 * Run HQL code and return the result.
 * This is the primary way to execute HQL in tests.
 */
export async function run(
  code: string,
  options?: RunOptions,
): Promise<any> {
  // Resolve any fixture paths in the code
  const resolvedCode = resolveFixturePath(code);
  return await hql.run(resolvedCode, options);
}

/**
 * Transpile HQL code to JavaScript.
 * Returns the generated JavaScript code as a string.
 */
export async function transpile(code: string): Promise<string> {
  const result = await transpileToJavascript(code);
  return result.code.trim();
}

/**
 * Transpile and evaluate HQL code.
 * Useful for testing code generation without running through the full runtime.
 */
export async function evalHql(code: string): Promise<unknown> {
  // Ensure runtime helpers (like __hql_trampoline) are available in global scope
  initializeRuntimeHelpers();
  const js = await transpile(code);
  return eval(js);
}

// ============================================================================
// TypeScript Generation Helpers
// ============================================================================

/**
 * Convert HQL code to TypeScript.
 * Used for testing TypeScript type generation.
 */
export function hqlToTypeScript(hql: string): string {
  const ast = parse(hql);
  const ir = transformToIR(ast, "/tmp");
  const result = generateTypeScript(ir, {});
  return result.code;
}

// ============================================================================
// Console Capture Helpers
// ============================================================================

/**
 * Capture console output during async execution.
 * Safely restores console methods even on error.
 *
 * @param fn - Async function to execute while capturing
 * @param channels - Which console channels to capture (default: ['log', 'error'])
 * @returns Object with result, stdout, stderr, and warnings
 */
export async function captureConsole<T>(
  fn: () => Promise<T>,
  channels: ("log" | "warn" | "error")[] = ["log", "error"],
): Promise<{ result: T; stdout: string; stderr: string; warnings: string }> {
  const originalLog = console.log;
  const originalError = console.error;
  const originalWarn = console.warn;

  const logs: string[] = [];
  const errors: string[] = [];
  const warnings: string[] = [];

  if (channels.includes("log")) {
    console.log = (...args: unknown[]) => {
      logs.push(
        args.map((a) => (typeof a === "string" ? a : Deno.inspect(a))).join(
          " ",
        ),
      );
    };
  }
  if (channels.includes("error")) {
    console.error = (...args: unknown[]) => {
      errors.push(args.map(String).join(" "));
    };
  }
  if (channels.includes("warn")) {
    console.warn = (...args: unknown[]) => {
      warnings.push(args.map(String).join(" "));
    };
  }

  try {
    const result = await fn();
    return {
      result,
      stdout: logs.join("\n"),
      stderr: errors.join("\n"),
      warnings: warnings.join("\n"),
    };
  } finally {
    console.log = originalLog;
    console.error = originalError;
    console.warn = originalWarn;
  }
}
