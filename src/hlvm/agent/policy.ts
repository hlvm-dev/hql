/**
 * Agent Policy - Persistent allow/deny/ask rules for tool execution
 *
 * Provides a simple, local-only policy file for core engine safety:
 * - Per-tool decisions (allow/deny/ask)
 * - Per-safety-level decisions (L0/L1/L2)
 * - Optional path allow/deny lists (glob patterns)
 * - Optional network allow/deny lists (URL patterns)
 *
 * Policy is stored globally at:
 *   ~/.hlvm/agent-policy.json
 *
 * If the policy file does not exist, policy is disabled (null).
 * This preserves existing behavior unless user explicitly configures policy.
 */

import { getPlatform } from "../../platform/platform.ts";
import { getAgentLogger } from "./logger.ts";
import { GlobPatternError, globToRegex } from "../../common/pattern-utils.ts";
import {
  getErrorMessage,
  isFileNotFoundError,
  isObjectValue,
} from "../../common/utils.ts";
import type { SafetyLevel } from "./security/safety.ts";
import { isPathWithinRoot, SecurityError } from "./security/path-sandbox.ts";
// getAgentPolicyPath removed — policy now read from unified settings.json

// ============================================================
// Types
// ============================================================

/** Explicit decision from policy */
type PolicyDecision = "allow" | "deny" | "ask";

/** Path rules (glob patterns relative to the active working directory) */
interface PathRules {
  allow?: string[];
  deny?: string[];
  roots?: string[];
}

/** Network rules (glob patterns for URL strings) */
interface NetworkRules {
  allow?: string[];
  deny?: string[];
}

/** Policy file schema */
export interface AgentPolicy {
  version: 1;
  /** Default decision when no rule matches */
  default?: PolicyDecision;
  /** Per-tool decisions */
  toolRules?: Record<string, PolicyDecision>;
  /** Per-safety-level decisions */
  levelRules?: Partial<Record<SafetyLevel, PolicyDecision>>;
  /** Optional path allow/deny rules */
  pathRules?: PathRules;
  /** Optional network allow/deny rules */
  networkRules?: NetworkRules;
}

// ============================================================
// Policy Loading
// ============================================================

const POLICY_V1_EXAMPLE = `{
  "version": 1,
  "default": "ask",
  "toolRules": { "read_file": "allow" },
  "levelRules": { "L2": "deny" }
}`;

/**
 * Load policy from unified settings.json (config.policy section).
 */
export async function loadAgentPolicy(): Promise<AgentPolicy | null> {
  try {
    const { loadConfig } = await import("../../common/config/storage.ts");
    const config = await loadConfig();
    if (config.policy) {
      return normalizePolicy({ version: 1, ...config.policy });
    }
  } catch { /* config unavailable */ }
  return null;
}

/**
 * Normalize policy object (minimal validation)
 */
function normalizePolicy(input: unknown): AgentPolicy | null {
  if (!isObjectValue(input)) return null;

  const policy = input as Partial<AgentPolicy>;
  if (policy.version !== 1) return null;

  return {
    version: 1,
    default: isDecision(policy.default) ? policy.default : undefined,
    toolRules: normalizeDecisionMap(policy.toolRules),
    levelRules: normalizeDecisionMap(policy.levelRules) as Partial<
      Record<SafetyLevel, PolicyDecision>
    >,
    pathRules: normalizePathRules(policy.pathRules),
    networkRules: normalizeRuleSet(policy.networkRules),
  };
}

function isDecision(value: unknown): value is PolicyDecision {
  return value === "allow" || value === "deny" || value === "ask";
}

function normalizeDecisionMap(
  input: unknown,
): Record<string, PolicyDecision> | undefined {
  if (!isObjectValue(input)) return undefined;
  const result: Record<string, PolicyDecision> = {};
  for (const [key, value] of Object.entries(input)) {
    if (isDecision(value)) result[key] = value;
  }
  return Object.keys(result).length > 0 ? result : undefined;
}

function normalizeRuleSet(input: unknown): NetworkRules | undefined {
  if (!isObjectValue(input)) return undefined;
  const allow = Array.isArray(input.allow)
    ? input.allow.filter((s) => typeof s === "string")
    : [];
  const deny = Array.isArray(input.deny)
    ? input.deny.filter((s) => typeof s === "string")
    : [];

  if (allow.length === 0 && deny.length === 0) return undefined;
  return { allow, deny };
}

function normalizePathRules(input: unknown): PathRules | undefined {
  if (!isObjectValue(input)) return undefined;
  const base = normalizeRuleSet(input);
  const roots = Array.isArray(input.roots)
    ? input.roots.filter((s) => typeof s === "string")
    : [];

  if (!base && roots.length === 0) return undefined;
  return {
    allow: base?.allow ?? [],
    deny: base?.deny ?? [],
    roots: roots.length > 0 ? roots : undefined,
  };
}

function describePolicyInvalid(input: unknown): string {
  if (!isObjectValue(input)) return "Policy must be a JSON object";
  const version = input.version;
  if (version !== 1) {
    return `Unsupported policy version "${String(version)}" (expected 1)`;
  }
  return "Schema validation failed (check default/toolRules/levelRules types)";
}

// ============================================================
// Policy Resolution
// ============================================================

/**
 * Resolve policy decision for a tool + safety level
 *
 * Order of precedence:
 * 1. toolRules[toolName]
 * 2. levelRules[level]
 * 3. policy.default
 * 4. null (no policy)
 */
export function resolvePolicyDecision(
  policy: AgentPolicy | null | undefined,
  toolName: string,
  level: SafetyLevel,
): PolicyDecision | null {
  if (!policy) return null;

  const toolDecision = policy.toolRules?.[toolName];
  if (toolDecision) return toolDecision;

  const levelDecision = policy.levelRules?.[level];
  if (levelDecision) return levelDecision;

  if (policy.default) return policy.default;

  return null;
}

/**
 * Check if a path is allowed by policy (relative path)
 *
 * Deny rules take precedence.
 * If allow list exists, path must match at least one allow rule.
 */
export function isPathAllowed(
  policy: AgentPolicy | null | undefined,
  relativePath: string,
): boolean {
  if (!policy?.pathRules) return true;
  const { allow = [], deny = [] } = policy.pathRules;

  // Deny takes precedence
  if (matchesAny(deny, relativePath, { matchPath: true })) return false;

  // If allow list exists, must match at least one
  if (allow.length > 0) {
    return matchesAny(allow, relativePath, { matchPath: true });
  }

  return true;
}

/**
 * Shared logic for absolute path policy checks.
 * Returns true if path is allowed by roots or relative rules.
 */
function checkAbsolutePathAgainstPolicy(
  policy: AgentPolicy,
  workspace: string,
  absolutePath: string,
): { allowed: boolean; relativePath: string } {
  const roots = resolvePolicyPathRoots(policy, workspace);
  if (
    roots.length > 0 &&
    roots.some((root) => isPathWithinRoot(absolutePath, root))
  ) {
    return { allowed: true, relativePath: "" };
  }
  const platform = getPlatform();
  const relative = normalizePolicyPath(
    platform.path.relative(workspace, absolutePath) || ".",
    platform.path.sep,
  );
  return { allowed: isPathAllowed(policy, relative), relativePath: relative };
}

/**
 * Check if an absolute path is allowed by policy.
 * Converts to workspace-relative path before evaluation.
 */
export function isPathAllowedAbsolute(
  policy: AgentPolicy | null | undefined,
  workspace: string,
  absolutePath: string,
): boolean {
  if (!policy?.pathRules) return true;
  return checkAbsolutePathAgainstPolicy(policy, workspace, absolutePath)
    .allowed;
}

/**
 * Enforce path policy by throwing SecurityError when disallowed.
 */
export function enforcePathPolicy(
  policy: AgentPolicy | null | undefined,
  workspace: string,
  absolutePath: string,
  displayPath?: string,
): void {
  if (!policy) return;
  const { allowed, relativePath } = checkAbsolutePathAgainstPolicy(
    policy,
    workspace,
    absolutePath,
  );
  if (!allowed) {
    throw new SecurityError(
      `Path denied by policy: ${displayPath ?? relativePath}`,
      absolutePath,
    );
  }
}

/** Cache resolved roots — policy and workspace are stable within a session */
let _rootsCache:
  | { policy: AgentPolicy; workspace: string; roots: string[] }
  | null = null;

export function resolvePolicyPathRoots(
  policy: AgentPolicy | null | undefined,
  workspace: string,
): string[] {
  if (!policy?.pathRules?.roots) return [];
  if (
    _rootsCache && _rootsCache.policy === policy &&
    _rootsCache.workspace === workspace
  ) {
    return _rootsCache.roots;
  }
  const platform = getPlatform();
  const home = platform.env.get("HOME") || "";
  const expandHome = (path: string): string => {
    if (!path.startsWith("~")) return path;
    if (!home) return path;
    return path.replace(/^~(?=$|\/)/, home);
  };
  const roots = policy.pathRules.roots.map((root) =>
    platform.path.resolve(workspace, expandHome(root))
  );
  _rootsCache = { policy, workspace, roots };
  return roots;
}

/**
 * Check if a URL is allowed by policy
 *
 * Deny rules take precedence.
 * If allow list exists, URL must match at least one allow rule.
 */
export function isNetworkAllowed(
  policy: AgentPolicy | null | undefined,
  url: string,
): boolean {
  if (!policy?.networkRules) return true;
  const { allow = [], deny = [] } = policy.networkRules;

  // Network rules should match the full URL string (including slashes).
  // Use matchPath: false so "*" can match any URL.
  if (matchesAny(deny, url, { matchPath: false })) return false;
  if (allow.length > 0) {
    return matchesAny(allow, url, { matchPath: false });
  }
  return true;
}

/**
 * Return the first URL denied by policy, or null if all allowed.
 */
export function getNetworkPolicyDeniedUrl(
  policy: AgentPolicy | null | undefined,
  urls: string[],
): string | null {
  if (!policy?.networkRules || urls.length === 0) return null;
  for (const url of urls) {
    if (!isNetworkAllowed(policy, url)) {
      return url;
    }
  }
  return null;
}

/** Cache compiled glob regexes — patterns come from a static policy file and never change */
const _globRegexCache = new Map<string, RegExp | null>();
/** Prevent unbounded cache growth in long-running server */
const MAX_GLOB_CACHE_SIZE = 200;

function getCompiledGlob(
  pattern: string,
  options: { matchPath: boolean },
): RegExp | null {
  const key = `${pattern}\0${options.matchPath ? "p" : "s"}`;
  if (_globRegexCache.has(key)) return _globRegexCache.get(key)!;
  // Clear cache if it gets too large
  if (_globRegexCache.size >= MAX_GLOB_CACHE_SIZE) {
    _globRegexCache.clear();
  }
  try {
    const regex = globToRegex(pattern, options);
    _globRegexCache.set(key, regex);
    return regex;
  } catch (error) {
    if (error instanceof GlobPatternError) {
      _globRegexCache.set(key, null);
      return null;
    }
    throw error;
  }
}

function matchesAny(
  patterns: string[],
  input: string,
  options: { matchPath: boolean },
): boolean {
  for (const pattern of patterns) {
    const regex = getCompiledGlob(pattern, options);
    if (regex && regex.test(input)) return true;
  }
  return false;
}

function normalizePolicyPath(relativePath: string, separator: string): string {
  const normalized = relativePath
    .split(separator)
    .join("/")
    .replace(/\\/g, "/");
  return normalized === "" ? "." : normalized;
}
