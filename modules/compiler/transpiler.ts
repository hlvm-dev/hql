// transpiler.ts
import { parse } from "../parser.ts";
import { Env, baseEnv } from "../env.ts";
import { evaluateAsync } from "../eval.ts";
import { HQLValue } from "../type.ts";

// When running an HQL file, set the environment's fileBase property.
export async function runHQLFile(
  path: string,
  targetExports?: Record<string, HQLValue>
): Promise<Record<string, HQLValue>> {
  const exportsMap: Record<string, HQLValue> = targetExports || {};
  const hql = await Deno.readTextFile(path);
  const forms = parse(hql);
  const env = new Env({}, baseEnv);
  env.exports = exportsMap;
  // Set fileBase so that subsequent evaluations know the caller's absolute path.
  (env as any).fileBase = Deno.realPathSync(path);
  for (const f of forms) {
    await evaluateAsync(f, env, Deno.realPathSync(path));
  }
  return exportsMap;
}

export async function transpile(inputPath: string, outputPath?: string): Promise<void> {
  const exportsMap: Record<string, HQLValue> = {};
  const hql = await Deno.readTextFile(inputPath);
  const forms = parse(hql);
  const env = new Env({}, baseEnv);
  env.exports = exportsMap;
  // Also store the fileBase in the environment here.
  (env as any).fileBase = Deno.realPathSync(inputPath);
  for (const form of forms) {
    await evaluateAsync(form, env, Deno.realPathSync(inputPath));
  }
  const names = Object.keys(exportsMap);
  if (!outputPath) {
    outputPath = inputPath.endsWith(".hql") ? inputPath + ".js" : inputPath + ".js";
  }
  // Build output code using standard string concatenation (to avoid template escape issues)
  let code = 'import { runHQLFile, getExport } from "../hql.ts";\n\n';
  code += 'const _exports = await runHQLFile("' + inputPath + '");\n\n';
  for (const name of names) {
    const val = exportsMap[name];
    const isFn = val?.type === "function";
    if (isFn && val.typed) {
      code += 'export async function ' + name + '(...args) {\n' +
              '  const fn = getExport("' + name + '", _exports);\n' +
              '  return await fn(...args);\n' +
              '}\n\n';
    } else if (isFn) {
      const isSync = val.isSync;
      if (isSync) {
        code += 'export function ' + name + '(...args) {\n' +
                '  const fn = getExport("' + name + '", _exports);\n' +
                '  return fn(...args);\n' +
                '}\n\n';
      } else {
        code += 'export async function ' + name + '(...args) {\n' +
                '  const fn = getExport("' + name + '", _exports);\n' +
                '  return await fn(...args);\n' +
                '}\n\n';
      }
    } else {
      code += 'export const ' + name + ' = getExport("' + name + '", _exports);\n\n';
    }
  }
  await Deno.writeTextFile(outputPath, code);
  console.log("Transpiled " + inputPath + " -> " + outputPath + ". Exports: " + names.join(", "));
}
