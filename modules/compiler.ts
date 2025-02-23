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
  isAbsolute,
  resolve,
  cwd,
  relative,
} from "../platform/platform.ts";

/**
 * Compiles HQL source code into a JS module string.
 * The generated module uses relative paths computed from the output file’s directory.
 *
 * @param source         The HQL source code.
 * @param inputPath      The absolute path of the input HQL file.
 * @param skipEvaluation If true, non-definition code is not evaluated.
 * @param outputPath     The absolute path of the output JS module.
 * @returns A Promise resolving to the generated JS module code.
 */
export async function compile(
  source: string,
  inputPath: string,
  skipEvaluation: boolean = false,
  outputPath?: string
): Promise<string> {
  // inputPath is expected to be absolute.
  const inputAbs = resolve(inputPath);
  // outputPath is expected to be absolute.
  if (!outputPath) {
    const baseName = basename(inputAbs, extname(inputAbs));
    outputPath = join(dirname(inputAbs), `${baseName}.hql.js`);
  }
  const outputAbs = resolve(outputPath);
  // The output directory.
  const outDir = dirname(outputAbs);
  // Compute the runtime file import.
  // Assume "hql.ts" lives at the project root (cwd).
  const runtimeAbs = resolve(join(cwd(), "hql.ts"));
  const runtimeImport = makeRelativePath(outDir, runtimeAbs);
  // Compute the module identifier for the HQL source.
  const inputRel = makeRelativePath(outDir, inputAbs);

  // Evaluate HQL forms.
  const exportsMap: Record<string, HQLValue> = {};
  const forms = parse(source);
  const env = new Env({}, baseEnv);
  env.exports = exportsMap;
  if (!skipEvaluation) {
    for (const form of forms) {
      await evaluateAsync(form, env, inputAbs);
    }
  } else {
    // Partial evaluation: scan for definitions only.
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
    if (val && val.type === "function") {
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
 * Computes a relative path from one directory to a target.
 * Ensures that the returned path starts with "./" or "../" as needed.
 */
function makeRelativePath(fromDir: string, toPath: string): string {
  let rel = relative(fromDir, toPath);
  if (!rel.startsWith(".") && !rel.startsWith("/")) {
    rel = "./" + rel;
  }
  return rel;
}
