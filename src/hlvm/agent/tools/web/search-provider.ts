/**
 * Search Provider Abstraction - Multi-provider search with fail-fast semantics
 */

import { ValidationError } from "../../../../common/error.ts";
import { getEnvVar } from "../../../../common/paths.ts";
import type { ToolExecutionOptions } from "../../registry.ts";

// ============================================================
// Types
// ============================================================

export interface SearchResult {
  title: string;
  url?: string;
  snippet?: string;
  score?: number;
  publishedDate?: string;
}

export interface SearchProviderResponse {
  query: string;
  provider: string;
  results: SearchResult[];
  count: number;
}

export type SearchTimeRange = "day" | "week" | "month" | "year" | "all";

export interface SearchCallOptions {
  limit: number;
  timeoutMs?: number;
  allowedDomains?: string[];
  blockedDomains?: string[];
  timeRange?: SearchTimeRange;
  toolOptions?: ToolExecutionOptions;
}

export interface SearchProviderSpec {
  name: string;
  displayName: string;
  envVarName?: string;
  requiresApiKey: boolean;
  search(query: string, opts: SearchCallOptions): Promise<SearchProviderResponse>;
}

/** Additive citation field — never breaks existing response shapes */
export interface Citation {
  url: string;
  title: string;
  excerpt?: string;
  provider?: string;
}

// ============================================================
// Registry
// ============================================================

const providers = new Map<string, SearchProviderSpec>();

export function registerSearchProvider(spec: SearchProviderSpec): void {
  providers.set(spec.name, spec);
}

/** For testing: reset registry state */
export function resetSearchProviders(): void {
  providers.clear();
}

export function getSearchProvider(name: string): SearchProviderSpec | undefined {
  return providers.get(name);
}

/**
 * Resolve provider with fail-fast semantics:
 * - Explicit unknown provider = ValidationError
 * - Default/unset provider = duckduckgo (always available)
 */
export function resolveSearchProvider(
  configured: string,
  isExplicit: boolean,
): SearchProviderSpec {
  const spec = providers.get(configured);
  if (!spec) {
    if (isExplicit) {
      throw new ValidationError(`Unknown search provider: "${configured}"`, "search_web");
    }
    return providers.get("duckduckgo")!;
  }
  if (spec.requiresApiKey) {
    const hasKey = spec.envVarName && getEnvVar(spec.envVarName);
    if (!hasKey) {
      if (isExplicit) {
        throw new ValidationError(
          `Search provider "${configured}" requires ${spec.envVarName} to be set`,
          "search_web",
        );
      }
      return providers.get("duckduckgo")!;
    }
  }
  return spec;
}

// ============================================================
// Domain Filtering (SSOT)
// ============================================================

function normalizeDomain(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/^\*\./, "")
    .replace(/\.$/, "");
}

function normalizeHostname(input: string): string {
  return input.trim().toLowerCase().replace(/\.$/, "");
}

function hostMatchesDomain(hostname: string, domain: string): boolean {
  return hostname === domain || hostname.endsWith(`.${domain}`);
}

export function isAllowedByDomainFilters(
  hostname: string,
  allowedDomains?: string[],
  blockedDomains?: string[],
): boolean {
  const normalizedHost = normalizeHostname(hostname);
  const blocked = (blockedDomains ?? [])
    .map(normalizeDomain)
    .filter((d) => d.length > 0);
  if (blocked.some((d) => hostMatchesDomain(normalizedHost, d))) return false;

  const allowed = (allowedDomains ?? [])
    .map(normalizeDomain)
    .filter((d) => d.length > 0);
  if (allowed.length === 0) return true;
  return allowed.some((d) => hostMatchesDomain(normalizedHost, d));
}
