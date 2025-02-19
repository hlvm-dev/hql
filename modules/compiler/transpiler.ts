// modules/compiler/transpiler.ts
import { parse } from "../parser.ts";
import { Env, baseEnv } from "../env.ts";
import { evaluateAsync } from "../eval.ts";
import { HQLValue } from "../type.ts";
import { dirname } from "https://deno.land/std@0.170.0/path/mod.ts";

/**
 * Runs an HQL file and returns its exports as a record.
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
  // Mark the environment with the real path so that nested imports resolve properly.
  (env as any).fileBase = Deno.realPathSync(path);
  for (const f of forms) {
    await evaluateAsync(f, env, Deno.realPathSync(path));
  }
  // NEW: Copy any binding from env.bindings into exportsMap if not already exported.
  for (const key in env.bindings) {
    if (!exportsMap.hasOwnProperty(key)) {
      exportsMap[key] = env.bindings[key];
    }
  }
  return exportsMap;
}

/**
 * Transpiles an HQL file into a JS module file.
 */
export async function transpile(inputPath: string, outputPath?: string): Promise<void> {
  const exportsMap: Record<string, HQLValue> = {};
  const hql = await Deno.readTextFile(inputPath);
  const forms = parse(hql);
  const env = new Env({}, baseEnv);
  env.exports = exportsMap;
  (env as any).fileBase = Deno.realPathSync(inputPath);

  // Evaluate all forms to populate exports.
  for (const form of forms) {
    await evaluateAsync(form, env, Deno.realPathSync(inputPath));
  }

  if (!outputPath) {
    outputPath = inputPath.endsWith(".hql") ? inputPath + ".js" : inputPath + ".js";
  }

  const names = Object.keys(exportsMap);

  let code = `import { runHQLFile, getExport } from "file://${Deno.realPathSync("hql.ts")}";\n\n`;
  code += `const _exports = await runHQLFile("${inputPath}");\n\n`;

  for (const name of names) {
    const val = exportsMap[name];
    const isFn = val?.type === "function";
    if (isFn) {
      const typed = (val as any).typed;
      const isSync = (val as any).isSync;
      if (typed) {
        code += `
export async function ${name}(...args) {
  const fn = getExport("${name}", _exports);
  return await fn(...args);
}
`;
      } else {
        if (isSync) {
          code += `
export function ${name}(...args) {
  const fn = getExport("${name}", _exports);
  return fn(...args);
}
`;
        } else {
          code += `
export async function ${name}(...args) {
  const fn = getExport("${name}", _exports);
  return await fn(...args);
}
`;
        }
      }
    } else {
      code += `
export const ${name} = getExport("${name}", _exports);
`;
    }
  }

  await Deno.mkdir(dirname(outputPath), { recursive: true });
  await Deno.writeTextFile(outputPath, code);
  console.log(`Transpiled ${inputPath} -> ${outputPath}. Exports: ${names.join(", ")}`);
}
