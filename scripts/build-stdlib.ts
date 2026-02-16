#!/usr/bin/env -S deno run -A
/**
 * build-stdlib.ts — Transpile stdlib.hql → self-hosted.js
 *
 * Pipeline:
 *   stdlib.hql ──transpile──▶ raw JS ──post-process──▶ self-hosted.js
 *
 * Post-processing:
 *   1. Rewrite import path: "./js/stdlib.js" → "./core.js"
 *      (avoids circular: self-hosted → stdlib/index → self-hosted)
 *   2. Prepend auto-generated DO NOT EDIT header
 *   3. Append _QMARK_ predicate alias re-exports
 *
 * Usage:
 *   deno run -A scripts/build-stdlib.ts
 *   deno task stdlib:build
 */

import { transpile } from "../src/hql/transpiler/index.ts";
import { resolve, dirname, fromFileUrl } from "https://deno.land/std@0.220.0/path/mod.ts";

const SCRIPT_DIR = dirname(fromFileUrl(import.meta.url));
const PROJECT_ROOT = resolve(SCRIPT_DIR, "..");
const STDLIB_DIR = resolve(PROJECT_ROOT, "src/hql/lib/stdlib");
const STDLIB_HQL = resolve(STDLIB_DIR, "stdlib.hql");
const OUTPUT_JS = resolve(STDLIB_DIR, "js/self-hosted.js");

// _QMARK_ predicate aliases that map Lisp-style `?` predicates to JS names
const QMARK_ALIASES: [string, string][] = [
  // Type predicates
  ["isNil", "nil_QMARK_"],
  ["isNumber", "number_QMARK_"],
  ["isString", "string_QMARK_"],
  ["isBoolean", "boolean_QMARK_"],
  ["isArray", "array_QMARK_"],
  ["isObject", "object_QMARK_"],
  ["isFunction", "fn_QMARK_"],
  ["isEmpty", "empty_QMARK_"],
  // Numeric predicates
  ["isZero", "zero_QMARK_"],
  ["isEven", "even_QMARK_"],
  ["isOdd", "odd_QMARK_"],
  ["isPositive", "pos_QMARK_"],
  ["isNegative", "neg_QMARK_"],
  // Collection predicates
  ["every", "every_QMARK_"],
  ["some", "some_QMARK_"],
];

const HEADER = `\
// ===========================================================================
// AUTO-GENERATED — DO NOT EDIT
// ===========================================================================
// This file is generated from stdlib.hql by: deno task stdlib:build
// To modify stdlib functions, edit stdlib.hql and re-run the build.
// Generated: ${new Date().toISOString()}
// ===========================================================================
`;

async function main() {
  console.log("Reading stdlib.hql...");
  const source = await Deno.readTextFile(STDLIB_HQL);

  console.log("Transpiling...");
  const result = await transpile(source, {
    baseDir: STDLIB_DIR,
    currentFile: STDLIB_HQL,
  });

  let code = result.code;

  // Post-process 1: Rewrite import path to avoid circular dependency
  // The transpiler will produce: import { ... } from "./js/stdlib.js"
  // We need: import { ... } from "./core.js"
  code = code.replace(
    /from\s+["']\.\/js\/stdlib\.js["']/g,
    'from "./core.js"'
  );

  // Post-process 2: Prepend header
  code = HEADER + "\n" + code;

  // Post-process 3: Append _QMARK_ alias re-exports
  const aliasLines = QMARK_ALIASES
    .map(([source, alias]) => `export { ${source} as ${alias} };`)
    .join("\n");

  code += `\n// Lisp-style predicate aliases (with ? suffix)\n`;
  code += `// These map \`nil?\` -> \`nil_QMARK_\` via sanitizeIdentifier\n`;
  code += aliasLines + "\n";

  // Write output
  await Deno.writeTextFile(OUTPUT_JS, code);

  // Count exported functions for reporting
  const exportCount = (code.match(/export\s+(function|const|{)/g) || []).length;
  console.log(`Written: ${OUTPUT_JS}`);
  console.log(`Exports: ~${exportCount} declarations`);
  console.log("Done.");
}

main().catch((err) => {
  console.error("stdlib build failed:", err);
  Deno.exit(1);
});
