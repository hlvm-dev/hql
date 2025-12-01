// deno-lint-ignore-file no-explicit-any
/**
 * Shared helpers for unit tests
 * These tests run in-process using the HQL API directly
 */

import hql, { type RunOptions } from "../../../mod.ts";
import { dirname, fromFileUrl, join } from "../../../src/platform/platform.ts";

// Get the directory containing the shared helpers
const sharedDir = dirname(fromFileUrl(import.meta.url));

/**
 * Resolve fixture paths relative to the _shared/fixtures directory
 */
function resolveFixturePath(code: string): string {
  return code.replace(
    /["']\.\/fixtures\//g,
    (match) => {
      const quote = match[0];
      return `${quote}${join(sharedDir, "fixtures")}/`;
    },
  );
}

/**
 * Run HQL code and return the result
 */
export async function run(
  code: string,
  options?: RunOptions,
): Promise<any> {
  const resolvedCode = resolveFixturePath(code);
  return await hql.run(resolvedCode, options);
}

/**
 * Transpile HQL code and return the JavaScript output
 */
export async function transpile(
  code: string,
  options?: Record<string, unknown>,
): Promise<string> {
  const result = await hql.transpile(code, options);
  return typeof result === "string" ? result : result.code;
}

// Re-export hql for direct access
export { hql };
