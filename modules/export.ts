// export.ts

import { parse } from "./parser.ts";
import { Env, baseEnv } from "./env.ts";
import { evaluateAsync } from "./eval.ts";
import { HQLValue } from "./type.ts";
import { hqlToJs } from "./eval.ts";

/**
 * Internal helper that parses and evaluates HQL source code,
 * given a source string and a file identifier.
 *
 * @param source The HQL source code.
 * @param fileId A meaningful file identifier (for bundled code, e.g. "bundle.hql").
 * @param targetExports Optional object to collect exports.
 * @returns A Promise resolving to the exports map.
 */
async function _exportHqlCore(
  source: string,
  fileId: string,
  targetExports?: Record<string, HQLValue>
): Promise<Record<string, HQLValue>> {
  const exportsMap: Record<string, HQLValue> = targetExports || {};
  const forms = parse(source);
  const env = new Env({}, baseEnv);
  env.exports = exportsMap;
  // Set the fileBase to a real or meaningful identifier.
  (env as any).fileBase = fileId;
  for (const form of forms) {
    await evaluateAsync(form, env, fileId);
  }
  for (const key in env.bindings) {
    if (!exportsMap.hasOwnProperty(key)) {
      exportsMap[key] = env.bindings[key];
    }
  }
  return exportsMap;
}

/**
 * Evaluates bundled HQL source (a complete string containing all code)
 * and returns an exports map.
 *
 * @param bundled The entire bundled HQL code.
 * @param bundleFileName A meaningful virtual file name for the bundle (default: "bundle.hql").
 * @param targetExports Optional object to store exports.
 * @returns A Promise that resolves to the exports map.
 */
export async function exportHql(
  bundled: string,
  bundleFileName: string = "bundle.hql",
  targetExports?: Record<string, HQLValue>
): Promise<Record<string, HQLValue>> {
  return _exportHqlCore(bundled, bundleFileName, targetExports);
}

/**
 * Reads HQL source from a file, evaluates it, and returns an exports map.
 * (This function is preserved for backward compatibility.)
 *
 * @param path The HQL file path.
 * @param targetExports Optional object to store exports.
 * @returns A Promise that resolves to the exports map.
 */
export async function exportHqlModules(
  path: string,
  targetExports?: Record<string, HQLValue>
): Promise<Record<string, HQLValue>> {
  const { readTextFile, realPathSync } = await import("../platform/platform.ts");
  const realPath = realPathSync(path);
  const source = await readTextFile(path);
  return _exportHqlCore(source, realPath, targetExports);
}

/**
 * Retrieves a JS-compatible version of a HQL module export.
 *
 * @param name The export name.
 * @param targetExports The exports map.
 * @returns The JS-compatible version of the export.
 */
export function getHqlModule(
  name: string,
  targetExports: Record<string, HQLValue>
): any {
  if (!Object.prototype.hasOwnProperty.call(targetExports, name)) {
    throw new Error(`HQL export '${name}' not found`);
  }
  return hqlToJs(targetExports[name]);
}
