// modules/compiler/compiler.ts
import "../stdlib.ts";
import { parse } from "../parser.ts";
import { Env, baseEnv } from "../env.ts";
import { evaluateAsync } from "../eval.ts";
import { HQLValue, makeNil } from "../type.ts";

// Compute the absolute URL for your HQL runtime.
// This ensures that no matter where the transpiled file is placed,
// it can correctly import from "hql.ts".
const absoluteHqlRuntime = "file://" + Deno.realPathSync("hql.ts");

/**
 * Compiles HQL source code into a JS module string.
 *
 * @param source         The HQL source code.
 * @param inputPath      The original path of the HQL file.
 * @param skipEvaluation If true, perform a “partial” evaluation where only
 *                       top-level definition forms are scanned (their initializers
 *                       are not run) so that side-effect code does NOT execute.
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
  // Attach our exports map so that definitions can register their names.
  env.exports = exportsMap;

  if (!skipEvaluation) {
    // Full evaluation: run every form (and side effects occur).
    for (const form of forms) {
      await evaluateAsync(form, env, realPath);
    }
  } else {
    // PARTIAL EVALUATION:
    // Scan the AST for top-level definition forms (def, defsync, defmacro,
    // defn, defx, defenum) and register their names in env.exports with a dummy value.
    for (const form of forms) {
      if (form.type === "list" && form.value.length > 0) {
        const head = form.value[0];
        if (head.type === "symbol") {
          const name = head.name;
          if (
            name === "def" ||
            name === "defsync" ||
            name === "defmacro" ||
            name === "defn" ||
            name === "defx" ||
            name === "defenum"
          ) {
            // For a definition form, assume the second element is the symbol name.
            const defName = form.value[1];
            if (defName && defName.type === "symbol") {
              if (env.exports) {
                env.exports[defName.name] = makeNil();
              }
              env.set(defName.name, makeNil());
            }
          } else if (name === "export") {
            // For export forms, the first argument is a string literal.
            const exportNameAst = form.value[1];
            if (exportNameAst && exportNameAst.type === "string") {
              if (env.exports) {
                env.exports[exportNameAst.value] = makeNil();
              }
            }
          }
          // Other forms (like print, plain function calls, etc.) are skipped.
        }
      }
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
      code += `
export const ${name} = getExport("${name}", _exports);\n`;
    }
  }
  return code;
}
