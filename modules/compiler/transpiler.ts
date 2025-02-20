import { parse } from "../parser.ts";
import { Env, baseEnv } from "../env.ts";
import { evaluateAsync } from "../eval.ts";
import { HQLValue, makeNil } from "../type.ts";
import { dirname } from "https://deno.land/std@0.170.0/path/mod.ts";

// Use a relative import for the runtime.
const runtimeImportPath = "./hql_runtime.js";

/**
 * Legacy function to run an HQL file and return its exports.
 */
export async function runHQLFile(
  path: string,
  targetExports?: Record<string, HQLValue>
): Promise<Record<string, HQLValue>> {
  const exportsMap: Record<string, HQLValue> = targetExports || {};
  const hql = await Deno.readTextFile(path);
  const forms = parse(hql);
  const env = new Env({}, baseEnv);
  env.exports = exportsMap;
  // Use the provided path as fileBase.
  (env as any).fileBase = path;
  for (const f of forms) {
    await evaluateAsync(f, env, path);
  }
  for (const key in env.bindings) {
    if (!exportsMap.hasOwnProperty(key)) {
      exportsMap[key] = env.bindings[key];
    }
  }
  return exportsMap;
}

/**
 * Compiles HQL source into a self-contained JS module string.
 * It embeds the source and calls runHQLFromSource from our runtime (via a relative import).
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
  const fileIdentifier = inputPath;
  
  if (!skipEvaluation) {
    for (const form of forms) {
      await evaluateAsync(form, env, fileIdentifier);
    }
  } else {
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
  let code = `import { runHQLFromSource, getExport } from "${runtimeImportPath}";\n\n`;
  code += `const source = ${JSON.stringify(source)};\n`;
  code += `const _exports = await runHQLFromSource(source);\n\n`;
  
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
