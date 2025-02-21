import { parse } from "./parser.ts";
import { Env, baseEnv } from "./env.ts";
import { evaluateAsync } from "./eval.ts";
import { HQLValue } from "./type.ts";
import { readTextFile, realPathSync } from "../platform/platform.ts";
import { hqlToJs } from "./eval.ts";

export async function exportHqlModules(
  path: string,
  targetExports?: Record<string, HQLValue>
): Promise<Record<string, HQLValue>> {
  const exportsMap: Record<string, HQLValue> = targetExports || {};
  const hql = await readTextFile(path);
  const forms = parse(hql);
  const env = new Env({}, baseEnv);
  env.exports = exportsMap;
  // Use our abstracted realPathSync to mark the environment with the real file path.
  (env as any).fileBase = realPathSync(path);
  for (const f of forms) {
    await evaluateAsync(f, env, realPathSync(path));
  }
  // Copy any binding from env.bindings into exportsMap if not already exported.
  for (const key in env.bindings) {
    if (!exportsMap.hasOwnProperty(key)) {
      exportsMap[key] = env.bindings[key];
    }
  }
  return exportsMap;
}

export function getHqlModule(name: string, targetExports: Record<string, HQLValue>): any {
  if (!Object.prototype.hasOwnProperty.call(targetExports, name)) {
    throw new Error(`HQL export '${name}' not found`);
  }
  return hqlToJs(targetExports[name]);
}