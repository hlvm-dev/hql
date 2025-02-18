// compiler.ts
import "../stdlib.ts";
import { parse } from "../parser.ts";
import { Env, baseEnv } from "../env.ts";
import { evaluateAsync } from "../eval.ts";
import { HQLValue } from "../type.ts";

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