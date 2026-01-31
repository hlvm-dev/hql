/**
 * Export HQL tokenizer to the macOS GUI Monaco bundle.
 *
 * Usage:
 *   deno run -A scripts/export-hql-tokenizer.ts [outPath]
 */

const root = Deno.cwd();
const sourcePath = `${root}/src/common/hql-tokenizer.ts`;
const defaultOutPath = `${root}/../HLVM/HLVM/Shared/Presentation/HlvmPlayground/CodeEditor/Monaco/modules/hql-tokenizer.js`;
const outPath = Deno.args[0] || defaultOutPath;

import ts from "typescript";

const source = await Deno.readTextFile(sourcePath);
const transpiled = ts.transpileModule(source, {
  compilerOptions: {
    target: ts.ScriptTarget.ES2019,
    module: ts.ModuleKind.ESNext,
  },
}).outputText;

const withoutExports = transpiled
  .replace(/export\s+(function|const|let|var|class)\s/g, "$1 ")
  .replace(/export\s*\{[^}]*\};?\s*/g, "")
  .replace(/export\s+default\s+/g, "");
const header = `// Auto-generated from ${sourcePath}\n// Do not edit by hand. Regenerate via scripts/export-hql-tokenizer.ts\n`;
const wrapper = `${header}(function (global) {\n${withoutExports}\n  global.HqlTokenizer = { tokenizeHql, firstMeaningfulToken, isHqlDelimiter, isHqlPrefix };\n})(typeof window !== "undefined" ? window : globalThis);\n`;

await Deno.writeTextFile(outPath, wrapper);
console.log(`✅ Wrote HQL tokenizer to ${outPath}`);
