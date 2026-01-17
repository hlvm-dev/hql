#!/usr/bin/env -S deno run --allow-read
/**
 * Enforcement script for Platform Abstraction
 *
 * This script ensures that Deno.* calls are only used within the platform abstraction layer.
 * All other code should use getPlatform() or hlvm global for platform operations.
 *
 * Allowed locations:
 * - src/platform/deno-platform.ts (the implementation)
 * - src/platform/errors.ts (error type references)
 *
 * Excluded from enforcement:
 * - tests/ (test files can use Deno directly)
 * - scripts/ (development scripts can use Deno directly)
 * - vendor/ (third-party code) EXCEPT vendor/repl/src/ (project code)
 *
 * Acceptable exceptions:
 * - Symbol.for("Deno.customInspect") - symbol name strings
 * - Comments mentioning Deno
 */

import { walk } from "jsr:@std/fs/walk";
import { join, relative } from "jsr:@std/path";

const DENO_PATTERN = /\bDeno\./g;

// Paths that are allowed to use Deno.* directly
const ALLOWED_PATHS = [
  "src/platform/deno-platform.ts",
  "src/platform/errors.ts",
];

// Directories to exclude from checking (excluding vendor/repl/src which we DO check)
const EXCLUDED_DIRS = ["tests", "scripts", "node_modules", ".git"];

// Patterns that are acceptable even in non-platform code
const ACCEPTABLE_PATTERNS = [
  /Symbol\.for\("Deno\./, // Symbol names like Deno.customInspect
  /\/\/.*Deno\./, // Comments
  /\/\*[\s\S]*?Deno\.[\s\S]*?\*\//, // Multi-line comments
  /"Deno\./, // String literals
  /'Deno\./, // String literals
  /`[^`]*Deno\.[^`]*`/, // Template literals
];

interface Violation {
  file: string;
  line: number;
  content: string;
}

async function checkFile(filePath: string): Promise<Violation[]> {
  const violations: Violation[] = [];
  const content = await Deno.readTextFile(filePath);
  const lines = content.split("\n");

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Skip if no Deno. reference
    if (!DENO_PATTERN.test(line)) continue;

    // Reset regex lastIndex
    DENO_PATTERN.lastIndex = 0;

    // Check if it matches any acceptable pattern
    const isAcceptable = ACCEPTABLE_PATTERNS.some((pattern) =>
      pattern.test(line)
    );
    if (isAcceptable) continue;

    violations.push({
      file: filePath,
      line: i + 1,
      content: line.trim(),
    });
  }

  return violations;
}

function shouldExclude(relativePath: string): boolean {
  // Exclude vendor/ EXCEPT vendor/repl/src/
  if (relativePath.startsWith("vendor/")) {
    // Include vendor/repl/src/ in checks
    if (relativePath.startsWith("vendor/repl/src/")) {
      return false; // Don't exclude - we want to check this
    }
    return true; // Exclude other vendor/ paths
  }
  return false;
}

async function main() {
  const projectRoot = Deno.cwd();
  const srcDir = join(projectRoot, "src");
  const packagesDir = join(projectRoot, "packages");
  const vendorReplDir = join(projectRoot, "vendor/repl/src");

  const allViolations: Violation[] = [];

  // Check src/ directory
  for await (
    const entry of walk(srcDir, {
      exts: [".ts", ".tsx", ".js"],
      skip: EXCLUDED_DIRS.map((d) => new RegExp(`/${d}/`)),
    })
  ) {
    if (!entry.isFile) continue;

    const relativePath = relative(projectRoot, entry.path);

    // Skip allowed paths
    if (ALLOWED_PATHS.includes(relativePath)) continue;

    // Skip test files
    if (relativePath.includes(".test.") || relativePath.includes("_test.")) {
      continue;
    }

    const violations = await checkFile(entry.path);
    for (const v of violations) {
      allViolations.push({
        ...v,
        file: relativePath,
      });
    }
  }

  // Check packages/ directory
  try {
    for await (
      const entry of walk(packagesDir, {
        exts: [".ts", ".tsx", ".js", ".hql"],
        skip: EXCLUDED_DIRS.map((d) => new RegExp(`/${d}/`)),
      })
    ) {
      if (!entry.isFile) continue;

      const relativePath = relative(projectRoot, entry.path);

      // HQL files shouldn't use Deno directly - they use hlvm global
      if (entry.path.endsWith(".hql")) {
        const content = await Deno.readTextFile(entry.path);
        if (content.includes("js/Deno.") || content.includes("Deno.")) {
          allViolations.push({
            file: relativePath,
            line: 0,
            content: "HQL file uses Deno.* directly - should use hlvm global",
          });
        }
        continue;
      }

      const violations = await checkFile(entry.path);
      for (const v of violations) {
        allViolations.push({
          ...v,
          file: relativePath,
        });
      }
    }
  } catch {
    // packages/ might not exist
  }

  // Check vendor/repl/src/ directory (project code, not third-party)
  try {
    for await (
      const entry of walk(vendorReplDir, {
        exts: [".ts", ".tsx", ".js"],
      })
    ) {
      if (!entry.isFile) continue;

      const relativePath = relative(projectRoot, entry.path);

      // Skip test files
      if (relativePath.includes(".test.") || relativePath.includes("_test.")) {
        continue;
      }

      const violations = await checkFile(entry.path);
      for (const v of violations) {
        allViolations.push({
          ...v,
          file: relativePath,
        });
      }
    }
  } catch {
    // vendor/repl/src/ might not exist
  }

  // Report results
  if (allViolations.length === 0) {
    console.log("✓ Platform abstraction check passed");
    console.log(
      "  All Deno.* calls are properly isolated to src/platform/",
    );
    Deno.exit(0);
  } else {
    console.log("✗ Platform abstraction violations found:\n");
    for (const v of allViolations) {
      console.log(`  ${v.file}:${v.line}`);
      console.log(`    ${v.content}\n`);
    }
    console.log(`\nFound ${allViolations.length} violation(s).`);
    console.log("\nTo fix: Use getPlatform() from src/platform/platform.ts");
    console.log("        or hlvm global for HQL stdlib code.");
    Deno.exit(1);
  }
}

main();
