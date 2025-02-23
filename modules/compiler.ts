// modules/compiler.ts

import "./stdlib.ts";
import { parse } from "./parser.ts";
import { Env, baseEnv } from "./env.ts";
import { evaluateAsync } from "./eval.ts";
import { HQLValue, makeNil } from "./type.ts";
import {
  join,
  dirname,
  basename,
  extname,
  resolve,
  relative,
  realPathSync
} from "../platform/platform.ts";
import { bundleHql } from "./bundler.ts";
import { exportHql, getHqlModule } from "./export.ts";

/**
 * Determine the project root.
 * We assume that this file is in <projectRoot>/modules/,
 * so the project root is one level up from the "modules" folder.
 */
const projectRoot = dirname(dirname(new URL(import.meta.url).pathname));

/**
 * Core function to compile HQL source into a JS module string.
 * If outputPath is provided, relative paths are computed from its directory.
 *
 * @param source         The HQL source code.
 * @param inputPath      The original path of the HQL file.
 * @param outputPath     (Optional) The target output file path.
 * @param skipEvaluation If true, do not execute non-definition code.
 * @returns A Promise that resolves to a JS module string.
 */
export async function compile(
  source: string,
  inputPath: string,
  skipEvaluation: boolean = false,
  outputPath: string | undefined = undefined
): Promise<string> {
  const exportsMap: Record<string, HQLValue> = {};
  const forms = parse(source);
  const env = new Env({}, baseEnv);
  env.exports = exportsMap;

  // Get the absolute real path for the input.
  const realInput = realPathSync(inputPath);
  
  let runtimeImport: string;
  let inputRel: string;
  
  if (outputPath !== undefined) {
    // Compute paths relative to the output directory.
    const outDir = dirname(outputPath);
    // Assume the HQL runtime is compiled to "hql.js" at the project root.
    const runtimeAbsolute = realPathSync("hql.js");
    runtimeImport = relative(outDir, runtimeAbsolute);
    if (!runtimeImport.startsWith(".")) {
      runtimeImport = "./" + runtimeImport;
    }
    inputRel = relative(outDir, realInput);
    if (!inputRel.startsWith(".")) {
      inputRel = "./" + inputRel;
    }
  } else {
    // Legacy behavior: use absolute runtime URL.
    runtimeImport = "file://" + realPathSync("hql.ts");
    inputRel = inputPath;
  }
  
  // Evaluate all forms if not skipping evaluation.
  if (!skipEvaluation) {
    for (const form of forms) {
      await evaluateAsync(form, env, realInput);
    }
  } else {
    // Partial evaluation: scan only for definitions.
    for (const form of forms) {
      if (form.type === "list" && form.value.length > 0) {
        const head = form.value[0];
        if (head.type === "symbol") {
          let exportName: string | undefined;
          if (
            head.name === "def" ||
            head.name === "defsync" ||
            head.name === "defmacro" ||
            head.name === "defn" ||
            head.name === "defx" ||
            head.name === "defenum"
          ) {
            const nameSym = form.value[1];
            if (nameSym && nameSym.type === "symbol") {
              exportName = nameSym.name;
            }
          } else if (head.name === "export") {
            const exportNameAst = form.value[1];
            if (exportNameAst && exportNameAst.type === "string") {
              exportName = exportNameAst.value;
            }
          }
          if (exportName) {
            exportsMap[exportName] = makeNil();
          }
        }
      }
    }
  }
  
  const names = Object.keys(exportsMap);
  
  let code = `import { exportHqlModules, getHqlModule } from "${runtimeImport}";\n\n`;
  code += `const _exports = await exportHqlModules("${inputRel}");\n\n`;
  
  for (const name of names) {
    const val = exportsMap[name];
    const isFn = val && val.type === "function";
    if (isFn) {
      const typed = (val as any).typed;
      const isSync = (val as any).isSync;
      if (typed) {
        code += `
export async function ${name}(...args) {
  const fn = getHqlModule("${name}", _exports);
  return await fn(...args);
}\n`;
      } else {
        if (isSync) {
          code += `
export function ${name}(...args) {
  const fn = getHqlModule("${name}", _exports);
  return fn(...args);
}\n`;
        } else {
          code += `
export async function ${name}(...args) {
  const fn = getHqlModule("${name}", _exports);
  return await fn(...args);
}\n`;
        }
      }
    } else {
      code += `
export const ${name} = getHqlModule("${name}", _exports);\n`;
    }
  }
  
  return code;
}

/**
 * New compileBundle function – compiles an entry HQL file into a self-contained JS module.
 * It bundles the entire HQL code (with dependencies) inline so that no file I/O is needed at runtime.
 *
 * @param entryPath The entry HQL file path (or already bundled code).
 * @param outputPath (Optional) The absolute path of the output JS module.
 * @returns A Promise that resolves to the generated JS module code.
 */
export async function compileBundle(entryPath: string, outputPath?: string): Promise<string> {
  // Check if entryPath is a file.
  let isFile = true;
  try {
    await Deno.stat(entryPath);
  } catch {
    isFile = false;
  }
  // If it is a file, bundle it; otherwise assume entryPath is already bundled code.
  const bundled = isFile ? await bundleHql(entryPath) : entryPath;

  // For bundled code, we don’t need to compute a relative input identifier;
  // we use a fixed virtual file name.
  const inputRel = "bundle.hql.js";

  // Evaluate the bundled code at compile time to obtain exports.
  const exportsMap = await exportHql(bundled, "bundle.hql");
  const names = Object.keys(exportsMap);

  // Use the fixed runtime URL.
  const runtimeImport = "jsr:@boraseoksoon/hql@0.0.2";

  // Generate the final JS module.
  let code = `import { exportHql, getHqlModule } from "${runtimeImport}";\n\n`;
  // Inline the bundled HQL code as a JSON string literal.
  code += `const bundled_hql = ${JSON.stringify(bundled)};\n`;
  // At runtime, evaluate the bundled code.
  code += `const _exports = await exportHql(bundled_hql, "bundle.hql");\n\n`;

  // Generate wrappers for each export.
  for (const name of names) {
    const mod = exportsMap[name];
    if (mod && mod.type === "function") {
      const isSync = (mod as any).isSync;
      if (isSync) {
        code += `export function ${name}(...args) {\n  const fn = getHqlModule("${name}", _exports);\n  return fn(...args);\n}\n\n`;
      } else {
        code += `export async function ${name}(...args) {\n  const fn = getHqlModule("${name}", _exports);\n  return await fn(...args);\n}\n\n`;
      }
    } else {
      code += `export const ${name} = getHqlModule("${name}", _exports);\n\n`;
    }
  }

  return code;
}

/**
 * Helper to compute a relative path from one directory to a target.
 * Ensures that the returned path starts with "./" or "../" as needed.
 */
function makeRelativePath(fromDir: string, toPath: string): string {
  let rel = relative(fromDir, toPath);
  if (!rel.startsWith(".") && !rel.startsWith("/")) {
    rel = "./" + rel;
  }
  return rel;
}