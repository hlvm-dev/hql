// compiler.ts
import "../stdlib.ts";
import { parse } from "../parser.ts";
import { Env, baseEnv } from "../env.ts";
import { evaluateAsync } from "../eval.ts";
import { HQLValue } from "../type.ts";
import { walk } from "https://deno.land/std@0.170.0/fs/walk.ts";
import { join, dirname } from "https://deno.land/std@0.170.0/path/mod.ts";

// Compute the absolute URL for your HQL runtime.
// This ensures that no matter where the transpiled file is placed,
// it can correctly import from "hql.ts".
const absoluteHqlRuntime = "file://" + Deno.realPathSync("hql.ts");

/**
 * Compiles HQL source code into a JS module string.
 *
 * @param source       The HQL source code.
 * @param inputPath    The original path of the HQL file.
 * @param skipEvaluation  If true, skip evaluating top-level forms (no side effects).
 * @returns A Promise that resolves to a JavaScript module string.
 */
export async function compileHQL(
  source: string,
  inputPath: string,
  skipEvaluation = false
): Promise<string> {
  const realPath = Deno.realPathSync(inputPath);
  const exportsMap: Record<string, HQLValue> = {};
  const forms = parse(source);
  const env = new Env({}, baseEnv);
  env.exports = exportsMap;

  // If skipEvaluation is false, evaluate the forms to populate exports.
  if (!skipEvaluation) {
    for (const form of forms) {
      await evaluateAsync(form, env, realPath);
    }
  }

  // Gather exported names.
  const names = Object.keys(exportsMap);

  // Generate code with an absolute import of "hql.ts"
  let code = `import { runHQLFile, getExport } from "${absoluteHqlRuntime}";\n\n`;
  code += `const _exports = await runHQLFile("${inputPath}");\n\n`;

  for (const name of names) {
    const val = exportsMap[name];
    const isFn = val && val.type === "function";
    if (isFn) {
      const typed = (val as any).typed;
      const isSync = (val as any).isSync;
      if (typed) {
        code += `
export async function ${name}(...args) {
  const fn = getExport("${name}", _exports);
  return await fn(...args);
}\n`;
      } else {
        if (isSync) {
          code += `
export function ${name}(...args) {
  const fn = getExport("${name}", _exports);
  return fn(...args);
}\n`;
        } else {
          code += `
export async function ${name}(...args) {
  const fn = getExport("${name}", _exports);
  return await fn(...args);
}\n`;
        }
      }
    } else {
      // Exporting a non-function
      code += `
export const ${name} = getExport("${name}", _exports);\n`;
    }
  }
  return code;
}

/**
 * Compiles a single HQL file and writes its JS output to outPath.
 */
async function compileFile(filePath: string, outPath: string): Promise<void> {
  const source = await Deno.readTextFile(filePath);
  // We do not skip evaluation here, so side effects are performed.
  const compiled = await compileHQL(source, filePath);
  await Deno.mkdir(dirname(outPath), { recursive: true });
  await Deno.writeTextFile(outPath, compiled);
}

/**
 * Walks through rootDir to find all .hql files, compiles them into the cacheDir,
 * and returns a mapping from the original file URL to the compiled JS file URL.
 */
export async function precompile(
  rootDir: string,
  cacheDir: string,
): Promise<Record<string, string>> {
  const mappings: Record<string, string> = {};

  for await (const entry of walk(rootDir, { exts: [".hql"], includeFiles: true })) {
    const hqlPath = entry.path;
    // Create a relative path from the rootDir.
    const relPath = hqlPath.substring(rootDir.length);
    // Write the compiled file into the cacheDir at the root.
    const outPath = join(cacheDir, relPath) + ".js";

    let needCompile = true;
    try {
      const statHQL = await Deno.stat(hqlPath);
      const statJS = await Deno.stat(outPath);
      if (statJS.mtime && statHQL.mtime && statJS.mtime >= statHQL.mtime) {
        needCompile = false;
      }
    } catch {
      needCompile = true;
    }

    if (needCompile) {
      await compileFile(hqlPath, outPath);
    }

    // Convert file paths to absolute file URLs.
    const absHQL = new URL("file://" + Deno.realPathSync(hqlPath)).href;
    const absJS = new URL("file://" + Deno.realPathSync(outPath)).href;
    mappings[absHQL] = absJS;
  }

  return mappings;
}
