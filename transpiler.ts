import { parse } from "./parser.ts";
import { Env, baseEnv } from "./env.ts";
import { evaluateAsync } from "./eval.ts";
import { HQLValue } from "./type.ts";

export async function runHQLFile(path: string, targetExports?: Record<string, HQLValue>): Promise<Record<string, HQLValue>> {
  const exportsMap = targetExports || {};
  const hql = await Deno.readTextFile(path);
  const forms = parse(hql);
  const env = new Env({}, baseEnv);
  env.exports = exportsMap;
  for (const f of forms) {
    await evaluateAsync(f, env);
  }
  return exportsMap;
}

export async function transpileHQLFile(inputPath: string, outputPath?: string): Promise<void> {
  const exportsMap: Record<string, HQLValue> = {};
  const hql = await Deno.readTextFile(inputPath);
  const forms = parse(hql);
  const env = new Env({}, baseEnv);
  env.exports = exportsMap;
  for (const form of forms) {
    await evaluateAsync(form, env);
  }
  const names = Object.keys(exportsMap);
  if (!outputPath) {
    outputPath = inputPath.endsWith(".hql") ? inputPath + ".js" : inputPath + ".js";
  }
  let code = `import { runHQLFile, getExport } from "./main.ts";\n\n`;
  code += `const _exports = await runHQLFile("${inputPath}");\n\n`;
  for (const name of names) {
    const val = exportsMap[name];
    const isFn = val?.type === "function";
    if (isFn && val.typed) {
      code += `
export async function ${name}(...args) {
  const fn = getExport("${name}", _exports);
  return await fn(...args);
}
`;
    } else if (isFn) {
      const isSync = val.isSync;
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
    } else {
      code += `
export const ${name} = getExport("${name}", _exports);
`;
    }
  }
  await Deno.writeTextFile(outputPath, code);
  console.log(`Transpiled ${inputPath} -> ${outputPath}. Exports: ${names.join(", ")}`);
}
