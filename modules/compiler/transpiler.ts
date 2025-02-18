// transpiler.ts
import { parse } from "../parser.ts";
import { Env, baseEnv } from "../env.ts";
import { evaluateAsync } from "../eval.ts";
import { HQLValue } from "../type.ts";
import { join, dirname, extname, basename } from "https://deno.land/std@0.170.0/path/mod.ts";

// Compute the absolute URL for "hql.ts" so that our generated JS
// always imports from an absolute path.
const absoluteHqlRuntime = "file://" + Deno.realPathSync("hql.ts");

export async function runHQLFile(
  path: string,
  targetExports?: Record<string, HQLValue>
): Promise<Record<string, HQLValue>> {
  const exportsMap: Record<string, HQLValue> = targetExports || {};
  const hql = await Deno.readTextFile(path);
  const forms = parse(hql);
  const env = new Env({}, baseEnv);
  env.exports = exportsMap;
  // Mark the environment with the real path so that nested imports can resolve relative paths.
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
  (env as any).fileBase = Deno.realPathSync(inputPath);

  // Evaluate forms so that we can gather exports
  for (const form of forms) {
    await evaluateAsync(form, env, Deno.realPathSync(inputPath));
  }

  // If no outputPath specified, default to "<input>.js"
  if (!outputPath) {
    outputPath = inputPath.endsWith(".hql") ? inputPath + ".js" : inputPath + ".js";
  }

  const names = Object.keys(exportsMap);

  // Generate code that uses the absolute import of "hql.ts"
  let code = `import { runHQLFile, getExport } from "${absoluteHqlRuntime}";\n\n`;
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
      // Exporting a non-function
      code += `
export const ${name} = getExport("${name}", _exports);
`;
    }
  }

  await Deno.mkdir(dirname(outputPath), { recursive: true });
  await Deno.writeTextFile(outputPath, code);

  console.log(
    `Transpiled ${inputPath} -> ${outputPath}. Exports: ${names.join(", ")}`
  );
}
