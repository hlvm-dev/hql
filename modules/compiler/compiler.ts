// compiler.ts
import "../stdlib.ts"
import { parse } from "../parser.ts";
import { Env, baseEnv } from "../env.ts";
import { evaluateAsync } from "../eval.ts";
import { HQLValue } from "../type.ts";

// Compute the absolute URL for your HQL runtime.
// This assumes "hql.ts" is in the project root.
const absoluteHqlRuntime = "file://" + Deno.realPathSync("hql.ts");

/**
 * Compiles HQL source code into a JS module string.
 *
 * @param source    The HQL source code.
 * @param inputPath The original path of the HQL file.
 * @returns A Promise that resolves to a JavaScript module string.
 */
export async function compileHQL(source: string, inputPath: string): Promise<string> {
  const exportsMap: Record<string, HQLValue> = {};
  const forms = parse(source);
  const env = new Env({}, baseEnv);
  env.exports = exportsMap;

  const realInput = Deno.realPathSync(inputPath);
  // Evaluate forms so that exported symbols are populated.
  for (const form of forms) {
    console.log("Real Input Path:", realInput);
    await evaluateAsync(form, env, realInput);
  }

  const names = Object.keys(exportsMap);

  // Generate code that imports the runtime using the absolute URL.
  let code = `import { runHQLFile, getExport } from "${absoluteHqlRuntime}";\n\n`;
  code += `const _exports = await runHQLFile("${inputPath}");\n\n`;

  for (const name of names) {
    const val = exportsMap[name];
    const isFn = val && val.type === "function";
    if (isFn) {
      if (val.typed) {
        code += `
export async function ${name}(...args) {
  const fn = getExport("${name}", _exports);
  return await fn(...args);
}\n`;
      } else {
        if (val.isSync) {
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
      code += `
export const ${name} = getExport("${name}", _exports);\n`;
    }
  }

  return code;
}
