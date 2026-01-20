#!/usr/bin/env -S deno run --allow-read
/**
 * SSOT (Single Source of Truth) Enforcement Script
 *
 * Validates that the codebase adheres to SSOT principles:
 * 1. Console usage only in logger.ts and log.ts
 * 2. Fetch calls only in http-client.ts and providers/
 * 3. Deno.* calls only in src/platform/
 * 4. Raw Error throws are minimized (warning only)
 *
 * See docs/SSOT-CONTRACT.md for full documentation.
 */

import { walk } from "jsr:@std/fs/walk";
import { join, relative } from "jsr:@std/path";

// ============================================================================
// Console Allowlist (Permanent Special Cases)
// ============================================================================
// Files that legitimately need direct console access for technical reasons.
// See docs/SSOT-CONTRACT.md for details on each exception.

const CONSOLE_ALLOWLIST = [
  // Bootstrap guard: typeof console !== "undefined" check
  "src/common/known-identifiers.ts",
  // Crash handler: intentionally hooks console.error for error reporting
  "src/common/runtime-error-handler.ts",
  // Stringified runtime helper: cannot use imports in stringified code
  "src/common/runtime-helper-impl.ts",
  // DEBUG-gated: console.log only when HLVM_DEBUG_ERROR=1
  "src/hql/transpiler/pipeline/source-map-support.ts",
];

// ============================================================================
// Rule Definitions
// ============================================================================

interface Rule {
  name: string;
  pattern: RegExp;
  allowedPaths: string[];
  excludePatterns: RegExp[];
  message: string;
  severity: "error" | "warn";
}

const RULES: Rule[] = [
  {
    name: "console-leak",
    pattern: /\bconsole\.(log|error|warn|debug|info|table|clear)\s*\(/g,
    allowedPaths: [
      "src/logger.ts",
      "src/hlvm/api/log.ts",
      ...CONSOLE_ALLOWLIST,
    ],
    // Note: log.ts uses console.* internally - this is the SSOT implementation
    excludePatterns: [
      /\/\/.*console\./, // Single-line comments
      /^\s*\*.*console\./, // JSDoc content lines (start with *)
      /\/\*[\s\S]*?console\.[\s\S]*?\*\//, // Multi-line comments on same line
      /"[^"]*console\.[^"]*"/, // String literals
      /'[^']*console\.[^']*'/, // String literals
      /`[^`]*console\.[^`]*`/, // Template literals
      /connection\.console\./, // LSP proper logging (connection.console.*)
      /^\s*\(console\./, // S-expression style (HQL code examples)
    ],
    message: "Use globalThis.log instead of console.*",
    severity: "error",
  },
  {
    name: "fetch-leak",
    pattern: /\bfetch\s*\(/g,
    allowedPaths: [
      "src/common/http-client.ts",
    ],
    excludePatterns: [
      /\/\/.*fetch\s*\(/, // Comments
      /\/\*[\s\S]*?fetch[\s\S]*?\*\//, // Multi-line comments
      /"[^"]*fetch[^"]*"/, // String literals
      /'[^']*fetch[^']*'/, // Single-quoted string literals
      /`[^`]*fetch[^`]*`/, // Template literals
      /declare\s+function\s+fetch/, // TypeScript type declarations
    ],
    message: "Use http.* from http-client.ts instead of direct fetch",
    severity: "error",
  },
  {
    name: "deno-leak",
    pattern: /\bDeno\./g,
    allowedPaths: [
      "src/platform/deno-platform.ts",
    ],
    excludePatterns: [
      /Symbol\.for\("Deno\./, // Symbol names
      /\/\/.*Deno\./, // Comments
      /\/\*[\s\S]*?Deno\.[\s\S]*?\*\//, // Multi-line comments
      /"[^"]*Deno\.[^"]*"/, // String literals
      /'[^']*Deno\.[^']*'/, // String literals
      /`[^`]*Deno\.[^`]*`/, // Template literals
    ],
    message: "Use getPlatform() from src/platform/platform.ts",
    severity: "error",
  },
  {
    name: "raw-error",
    pattern: /\bthrow\s+new\s+Error\s*\(/g,
    allowedPaths: [
      // Embedded JavaScript code cannot use TypeScript error types
      "src/hql/embedded-packages.ts",
      // JSDoc examples showing error usage
      "src/hql/transpiler/pipeline/source-map-support.ts",
      "src/hql/transpiler/syntax/function.ts",
      // Runtime JS stdlib files cannot use TypeScript error types
      "src/hql/lib/stdlib/js/",
      // Foundation utility - cannot import error.ts due to circular dependency
      "src/common/utils.ts",
      // Platform layer - cannot import error.ts due to circular dependency
      "src/platform/deno-platform.ts",
    ],
    excludePatterns: [
      /\/\/.*throw\s+new\s+Error/, // Comments
      /\/\*[\s\S]*?throw\s+new\s+Error[\s\S]*?\*\//, // Multi-line comments
      /^\s*\*.*throw\s+new\s+Error/, // JSDoc content lines (start with *)
      /"[^"]*throw\s+new\s+Error[^"]*"/, // String literals (double quotes)
      /'[^']*throw\s+new\s+Error[^']*'/, // String literals (single quotes)
      /`[^`]*throw\s+new\s+Error[^`]*`/, // Template literals
    ],
    message: "Consider using typed errors from src/common/error.ts",
    severity: "warn",
  },
];

// ============================================================================
// Global Exclusions
// ============================================================================

// Directories to exclude from checking
const EXCLUDED_DIRS = [
  "tests",
  "scripts",
  "node_modules",
  ".git",
  "embedded-packages",
  "vendor",
];

// Provider directories are allowed to use fetch directly
const PROVIDER_PATHS = [
  "src/hlvm/providers/",
];

// Stdlib JS files are allowed to use fetch (utility code)
const STDLIB_JS_PATHS = [
  "src/hql/lib/stdlib/js/",
];

// ============================================================================
// Types
// ============================================================================

interface Violation {
  rule: string;
  file: string;
  line: number;
  content: string;
  severity: "error" | "warn";
  message: string;
}

// ============================================================================
// Checking Logic
// ============================================================================

function isInProviderPath(filePath: string): boolean {
  return PROVIDER_PATHS.some((p) => filePath.includes(p));
}

function isInStdlibJsPath(filePath: string): boolean {
  return STDLIB_JS_PATHS.some((p) => filePath.includes(p));
}

function isAllowedPath(filePath: string, rule: Rule): boolean {
  // Check if file is in allowed paths
  // Supports both exact file matches and directory prefixes (ending with /)
  if (rule.allowedPaths.some((p) => {
    if (p.endsWith("/")) {
      // Directory prefix: check if file is inside this directory
      return filePath.includes(p);
    }
    // File path: exact match or suffix match
    return filePath === p || filePath.endsWith(p);
  })) {
    return true;
  }

  // Special case: fetch is allowed in providers and stdlib JS
  if (rule.name === "fetch-leak") {
    if (isInProviderPath(filePath) || isInStdlibJsPath(filePath)) {
      return true;
    }
  }

  // Special case: console is allowed in stdlib JS (runtime utility code)
  if (rule.name === "console-leak" && isInStdlibJsPath(filePath)) {
    return true;
  }

  return false;
}

function checkLine(line: string, rule: Rule): boolean {
  // Reset pattern lastIndex
  rule.pattern.lastIndex = 0;

  // Check if line matches the forbidden pattern
  if (!rule.pattern.test(line)) {
    return false; // No violation
  }

  // Reset again for exclude check
  rule.pattern.lastIndex = 0;

  // Check if it matches any acceptable exclusion pattern
  const isExcluded = rule.excludePatterns.some((pattern) => pattern.test(line));
  if (isExcluded) {
    return false; // Acceptable, no violation
  }

  return true; // Violation found
}

async function checkFile(
  filePath: string,
  relativePath: string,
): Promise<Violation[]> {
  const violations: Violation[] = [];
  const content = await Deno.readTextFile(filePath);
  const lines = content.split("\n");

  for (const rule of RULES) {
    // Skip if file is in allowed paths for this rule
    if (isAllowedPath(relativePath, rule)) {
      continue;
    }

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      if (checkLine(line, rule)) {
        violations.push({
          rule: rule.name,
          file: relativePath,
          line: i + 1,
          content: line.trim().slice(0, 100), // Truncate long lines
          severity: rule.severity,
          message: rule.message,
        });
      }
    }
  }

  return violations;
}

// ============================================================================
// Main
// ============================================================================

async function main() {
  const projectRoot = Deno.cwd();
  const srcDir = join(projectRoot, "src");

  const errors: Violation[] = [];
  const warnings: Violation[] = [];

  // Walk through src/ directory
  for await (
    const entry of walk(srcDir, {
      exts: [".ts", ".tsx", ".js"],
      skip: EXCLUDED_DIRS.map((d) => new RegExp(`/${d}/`)),
    })
  ) {
    if (!entry.isFile) continue;

    const relativePath = relative(projectRoot, entry.path);

    // Skip test files
    if (
      relativePath.includes(".test.") || relativePath.includes("_test.") ||
      relativePath.includes("/test/")
    ) {
      continue;
    }

    const violations = await checkFile(entry.path, relativePath);

    for (const v of violations) {
      if (v.severity === "error") {
        errors.push(v);
      } else {
        warnings.push(v);
      }
    }
  }

  // Report results
  console.log("\n=== SSOT Enforcement Check ===\n");

  if (errors.length > 0) {
    console.log(`\x1b[31m✗ ${errors.length} error(s) found:\x1b[0m\n`);

    // Group by rule
    const byRule = new Map<string, Violation[]>();
    for (const e of errors) {
      const list = byRule.get(e.rule) || [];
      list.push(e);
      byRule.set(e.rule, list);
    }

    for (const [rule, violations] of byRule) {
      console.log(`  \x1b[1m${rule}\x1b[0m (${violations.length}):`);
      for (const v of violations.slice(0, 10)) {
        // Show first 10
        console.log(`    ${v.file}:${v.line}`);
        console.log(`      ${v.content}`);
      }
      if (violations.length > 10) {
        console.log(`    ... and ${violations.length - 10} more`);
      }
      console.log(`    Fix: ${violations[0].message}\n`);
    }
  }

  if (warnings.length > 0) {
    console.log(
      `\x1b[33m⚠ ${warnings.length} warning(s) found:\x1b[0m\n`,
    );

    // Group by rule
    const byRule = new Map<string, Violation[]>();
    for (const w of warnings) {
      const list = byRule.get(w.rule) || [];
      list.push(w);
      byRule.set(w.rule, list);
    }

    for (const [rule, violations] of byRule) {
      console.log(`  \x1b[1m${rule}\x1b[0m (${violations.length}):`);
      for (const v of violations.slice(0, 20)) {
        console.log(`    ${v.file}:${v.line}`);
        console.log(`      ${v.content}`);
      }
      if (violations.length > 20) {
        console.log(`    ... and ${violations.length - 20} more`);
      }
      console.log(`    Consider: ${violations[0].message}\n`);
    }
  }

  // Summary
  console.log("=== Summary ===\n");

  if (errors.length === 0 && warnings.length === 0) {
    console.log("\x1b[32m✓ All SSOT checks passed!\x1b[0m");
    console.log("  See docs/SSOT-CONTRACT.md for details.\n");
    Deno.exit(0);
  } else if (errors.length === 0) {
    console.log("\x1b[32m✓ No errors found.\x1b[0m");
    console.log(`\x1b[33m⚠ ${warnings.length} warnings to review.\x1b[0m\n`);
    console.log("See docs/SSOT-CONTRACT.md for guidance.\n");
    Deno.exit(0); // Warnings don't fail the check
  } else {
    console.log(`\x1b[31m✗ ${errors.length} error(s) must be fixed.\x1b[0m`);
    console.log(`\x1b[33m⚠ ${warnings.length} warnings to review.\x1b[0m\n`);
    console.log("See docs/SSOT-CONTRACT.md for guidance.\n");
    Deno.exit(1);
  }
}

main();
