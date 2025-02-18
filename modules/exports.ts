// modules/exports.ts
import { HQLValue } from "./type.ts";
import { hqlToJs } from "./eval.ts";

export function getExport(name: string, targetExports: Record<string, HQLValue>): any {
  if (!Object.prototype.hasOwnProperty.call(targetExports, name)) {
    throw new Error(`HQL export '${name}' not found`);
  }
  return hqlToJs(targetExports[name]);
}
