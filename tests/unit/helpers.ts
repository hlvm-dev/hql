// deno-lint-ignore-file no-explicit-any
import hql, { type RunOptions } from "../../mod.ts";
import { dirname, fromFileUrl, join } from "../../src/platform/platform.ts";

// GLOBAL FIX: Disable AI auto-start for ALL unit tests that use this helper.
// This prevents "Leaks detected" errors caused by the runtime spawning background processes.
Deno.env.set("HQL_DISABLE_AI_AUTOSTART", "1");

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

export async function run(
  code: string,
  options?: RunOptions,
): Promise<any> {
  // Resolve any fixture paths in the code
  const resolvedCode = resolveFixturePath(code);
  return await hql.run(resolvedCode, options);
}