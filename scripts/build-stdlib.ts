#!/usr/bin/env -S deno run -A
/**
 * build-stdlib.ts — Transpile stdlib.hql → self-hosted.js
 *
 * Pipeline:
 *   stdlib.hql ──transpile──▶ raw JS ──post-process──▶ self-hosted.js
 *
 * Post-processing:
 *   1. Rewrite import path: "./js/core.js" → "./core.js"
 *   2. Remove 'use strict' (redundant in ES modules)
 *   3. Add missing runtime imports (first, rest, cons, seq, etc.)
 *   4. Clean export statement (remove core.js re-exports)
 *   5. Remove sourceMappingURL
 *   6. Prepend @ts-nocheck + auto-generated header
 *   7. Append _QMARK_ predicate alias re-exports
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

// Runtime helpers from core.js that the transpiler treats as globals.
// These are used in the generated code but not emitted as imports by the transpiler.
const CORE_RUNTIME_IMPORTS = [
  "first", "rest", "cons", "seq", "range",
  "__hql_lazy_seq", "__hql_hash_map",
];

// Runtime imports from seq-protocol.js that the transpiler treats as globals.
const SEQ_PROTOCOL_RUNTIME_IMPORTS = [
  "reduced", "isReduced",
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

  // Save current self-hosted.js — the transpiler imports stdlib at startup,
  // so we must not corrupt the working copy during transpilation.
  const backupPath = OUTPUT_JS + ".bak";
  try {
    await Deno.copyFile(OUTPUT_JS, backupPath);
  } catch {
    // No existing file to back up — first build
  }

  console.log("Transpiling...");
  let result;
  try {
    result = await transpile(source, {
      baseDir: STDLIB_DIR,
      currentFile: STDLIB_HQL,
      typeCheck: false,
      showTypeWarnings: false,
    });
  } catch (err) {
    // Restore backup on transpilation failure
    try { await Deno.copyFile(backupPath, OUTPUT_JS); } catch { /* no backup */ }
    throw err;
  }

  let code = result.code;

  // ── Post-process 1: Rewrite import paths ──
  // The transpiler produces paths relative to stdlib.hql's location:
  //   import { ... } from "./js/core.js"
  // But self-hosted.js lives inside js/, so we need:
  //   import { ... } from "./core.js"
  code = code.replace(
    /from\s+["']\.\/js\/core\.js["']/g,
    'from "./core.js"'
  );
  code = code.replace(
    /from\s+["']\.\/js\/internal\/seq-protocol\.js["']/g,
    'from "./internal/seq-protocol.js"'
  );
  code = code.replace(
    /from\s+["']\.\/js\/stdlib\.js["']/g,
    'from "./core.js"'
  );

  // ── Post-process 2: Remove 'use strict' (redundant in ES modules) ──
  code = code.replace(/^'use strict';\n?/m, "");

  // ── Post-process 2b: Extract function names for .d.ts generation ──
  // The transpiler emits `let take, drop, ...;` for mutually-recursive functions.
  // JS files can't have TypeScript annotations, so we generate a companion .d.ts.
  const letLineMatch = code.match(/^let ([\w, ]+);$/m);
  const selfHostedNames = letLineMatch
    ? letLineMatch[1].split(",").map((n: string) => n.trim()).filter(Boolean)
    : [];

  // ── Post-process 3: Add missing runtime imports from core.js ──
  // The transpiler treats first/rest/cons/seq/__hql_lazy_seq/etc. as globals
  // (they're injected by the runtime prelude). For self-hosted.js, we need
  // explicit imports since it runs as a standalone ES module.
  code = code.replace(
    /^(import\s*\{)([^}]+)(\}\s*from\s*"\.\/core\.js"\s*;)/m,
    (_match, open, names, close) => {
      const existing = names.split(",").map((n: string) => n.trim()).filter(Boolean);
      const toAdd = CORE_RUNTIME_IMPORTS.filter(n => !existing.includes(n));
      const allNames = [...toAdd, ...existing];
      return `${open} ${allNames.join(", ")} ${close}`;
    },
  );

  // ── Post-process 3b: Add missing runtime imports from seq-protocol.js ──
  code = code.replace(
    /^(import\s*\{)([^}]+)(\}\s*from\s*"\.\/internal\/seq-protocol\.js"\s*;)/m,
    (_match: string, open: string, names: string, close: string) => {
      const existing = names.split(",").map((n: string) => n.trim()).filter(Boolean);
      const toAdd = SEQ_PROTOCOL_RUNTIME_IMPORTS.filter(n => !existing.includes(n));
      const allNames = [...existing, ...toAdd];
      return `${open} ${allNames.join(", ")} ${close}`;
    },
  );

  // ── Post-process 4: Replace export with complete let-declared names ──
  // The transpiler's export block may be incomplete (missing some defn names).
  // Generate the export from the let-declared names, which IS complete.
  const letMatch = code.match(/^let (.+);$/m);
  if (letMatch) {
    // Strip `: Function` type annotations to get bare names
    const letNames = letMatch[1].split(",")
      .map((n: string) => n.replace(/:.*/, "").trim())
      .filter(Boolean);
    const exportLine = `export { ${letNames.join(", ")} };`;
    // Replace the transpiler's export block (or append if missing)
    if (/^export\s*\{[^}]+\}\s*;/m.test(code)) {
      code = code.replace(/^export\s*\{[^}]+\}\s*;/m, exportLine);
    } else {
      code += "\n" + exportLine + "\n";
    }
  }

  // ── Post-process 5: Replace _QMARK_ identifiers with original names ──
  // The transpiler sanitizes `nil?` → `nil_QMARK_`, but these aliases are
  // only re-exported (not local variables). Replace with the actual function
  // name so the code references the declared `let` variable.
  // Note: QMARK alias exports are appended later, so no risk of replacing those.
  for (const [originalName, qmarkAlias] of QMARK_ALIASES) {
    code = code.replaceAll(qmarkAlias, originalName);
  }

  // ── Post-process 5b: Remove sourceMappingURL (not useful for generated file) ──
  code = code.replace(/^\/\/# sourceMappingURL=.*$/m, "");

  // ── Post-process 6: Prepend header with @ts-self-types ──
  code = `// @ts-self-types="./self-hosted.d.ts"\n` + HEADER + "\n" + code;

  // ── Post-process 7: Append _QMARK_ alias re-exports ──
  const aliasLines = QMARK_ALIASES
    .map(([src, alias]) => `export { ${src} as ${alias} };`)
    .join("\n");
  code += `\n// Lisp-style predicate aliases (with ? suffix)\n`;
  code += `// These map \`nil?\` -> \`nil_QMARK_\` via sanitizeIdentifier\n`;
  code += aliasLines + "\n";

  // ── Generate companion .d.ts for type safety ──
  const OUTPUT_DTS = OUTPUT_JS.replace(/\.js$/, ".d.ts");
  const dtsLines = [
    "// AUTO-GENERATED from stdlib.hql — DO NOT EDIT",
    "// Provides type declarations for self-hosted.js",
    "",
    ...selfHostedNames.map(name => `export declare function ${name}(...args: any[]): any;`),
    "",
    // QMARK aliases
    ...QMARK_ALIASES.map(([src, alias]) => `export { ${src} as ${alias} };`),
    "",
  ];
  await Deno.writeTextFile(OUTPUT_DTS, dtsLines.join("\n"));

  // Write to temp file first, then rename (atomic — avoids corrupting self-hosted.js on error)
  const tmpFile = OUTPUT_JS + ".tmp";
  await Deno.writeTextFile(tmpFile, code);
  await Deno.rename(tmpFile, OUTPUT_JS);

  // Clean up backup
  try { await Deno.remove(backupPath); } catch { /* no backup */ }

  // Count exported functions for reporting
  const fnCount = (code.match(/^\([\w]+ = function /gm) || []).length;
  const aliasCount = QMARK_ALIASES.length;
  console.log(`Written: ${OUTPUT_JS}`);
  console.log(`Functions: ${fnCount} self-hosted + ${aliasCount} predicate aliases`);
  console.log("Done.");
}

main().catch((err) => {
  console.error("stdlib build failed:", err);
  Deno.exit(1);
});
