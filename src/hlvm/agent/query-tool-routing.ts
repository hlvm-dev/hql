import { STANDARD_EAGER_TOOLS } from "./constants.ts";
import { getAllTools } from "./registry.ts";

export const REPL_MAIN_THREAD_QUERY_SOURCE = "repl_main_thread";

/** REPL main thread uses the same eager core as standard tier (SSOT in constants.ts). */
const REPL_MAIN_THREAD_EAGER_CORE = STANDARD_EAGER_TOOLS;

/** Deduplicate and validate a tool allowlist. */
export function resolveQueryToolAllowlist(
  userAllowlist?: readonly string[],
): string[] | undefined {
  return userAllowlist === undefined ? undefined : [...new Set(userAllowlist)];
}

export function isMainThreadQuerySource(querySource?: string): boolean {
  return querySource === REPL_MAIN_THREAD_QUERY_SOURCE;
}

export function getMainThreadEagerCoreAllowlist(
  ownerId?: string,
): string[] {
  const tools = getAllTools(ownerId);
  return REPL_MAIN_THREAD_EAGER_CORE.filter((name) => name in tools);
}

export function resolveMainThreadBaselineToolAllowlist(options: {
  querySource?: string;
  toolAllowlist?: readonly string[];
  discoveredDeferredTools?: Iterable<string>;
  ownerId?: string;
}): string[] | undefined {
  const explicitAllowlist = resolveQueryToolAllowlist(options.toolAllowlist);
  if (!isMainThreadQuerySource(options.querySource)) {
    return explicitAllowlist;
  }

  const eagerCore = getMainThreadEagerCoreAllowlist(options.ownerId);
  const discovered = options.discoveredDeferredTools
    ? [...new Set(options.discoveredDeferredTools)]
    : [];
  const baseline = [...new Set([...eagerCore, ...discovered])];
  if (explicitAllowlist === undefined) {
    return baseline;
  }

  const explicitSet = new Set(explicitAllowlist);
  const intersected = baseline.filter((name) => explicitSet.has(name));
  return intersected.length > 0 ? intersected : explicitAllowlist;
}
