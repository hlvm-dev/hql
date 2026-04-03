import { getAllTools } from "./registry.ts";

export const REPL_MAIN_THREAD_QUERY_SOURCE = "repl_main_thread";

const REPL_MAIN_THREAD_EAGER_CORE = [
  "ask_user",
  "tool_search",
  "todo_read",
  "todo_write",
  "list_files",
  "read_file",
  "search_code",
  "find_symbol",
  "get_structure",
  "edit_file",
  "write_file",
  "git_status",
  "git_diff",
  "git_log",
  "shell_exec",
  "shell_script",
  "open_path",
] as const;

/** Deduplicate and validate a tool allowlist. */
export function resolveQueryToolAllowlist(
  userAllowlist?: readonly string[],
): string[] | undefined {
  return userAllowlist?.length ? [...new Set(userAllowlist)] : undefined;
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
  if (!explicitAllowlist?.length) {
    return baseline;
  }

  const explicitSet = new Set(explicitAllowlist);
  const intersected = baseline.filter((name) => explicitSet.has(name));
  return intersected.length > 0 ? intersected : explicitAllowlist;
}
