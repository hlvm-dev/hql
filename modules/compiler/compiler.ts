// modules/compiler/compiler.ts
import "../stdlib.ts";
import { parse } from "../parser.ts";
import { Env, baseEnv } from "../env.ts";
import { evaluateAsync } from "../eval.ts";
import { HQLValue, makeNil } from "../type.ts";

// Compute the absolute URL for your HQL runtime.
// This assumes "hql.ts" is in the project root.
const absoluteHqlRuntime = "file://" + Deno.realPathSync("hql.ts");

/**
 * Compiles HQL source code into a JS module string.
 *
 * @param source         The HQL source code.
 * @param inputPath      The original path of the HQL file.
 * @param skipEvaluation If true, do not execute any non-definition code. Instead,
 *                       scan the AST for top-level export definitions and record their
 *                       names in the exports map. (This prevents side effects from running.)
 * @returns A Promise that resolves to a JavaScript module string.
 */
export async function compileHQL(
  source: string,
  inputPath: string,
  skipEvaluation: boolean = false
): Promise<string> {
  const exportsMap: Record<string, HQLValue> = {};
  const forms = parse(source);
  const env = new Env({}, baseEnv);
  env.exports = exportsMap;

  const realInput = Deno.realPathSync(inputPath);

  if (!skipEvaluation) {
    // Full evaluation: run every form so that exports are set and side effects occur.
    for (const form of forms) {
      await evaluateAsync(form, env, realInput);
    }
  } else {
    // Partial evaluation: do NOT evaluate any form.
    // Instead, scan the AST for forms that define/export symbols and record them.
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

  // Generate JS module code that will, at runtime, fully evaluate the HQL file.
  // (That is, it imports the runtime and calls runHQLFile on the original file.)
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
      code += `
export const ${name} = getExport("${name}", _exports);\n`;
    }
  }
  return code;
}
