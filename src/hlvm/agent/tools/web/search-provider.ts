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
  passages?: string[];        // Prefetched relevant passages (max 3, max 280 chars each)
  pageDescription?: string;   // Enriched description from prefetched page metadata
  relatedLinks?: string[];    // Cross-domain links extracted from prefetched page
  evidenceStrength?: "high" | "medium" | "low";
  evidenceReason?: string;
  fetchPriority?: number;
  selectedForFetch?: boolean;
  sourceClass?: SearchResultSourceClass;
}

export type SearchResultSourceClass =
  | "official_docs"
  | "vendor_docs"
  | "repo_docs"
  | "technical_article"
  | "forum"
  | "other";

export interface SearchProviderResponse {
  query: string;
  provider: string;
  results: SearchResult[];
  count: number;
  diagnostics?: Record<string, unknown>;
}

export type SearchTimeRange = "day" | "week" | "month" | "year" | "all";
export type SearchDepthProfile = "low" | "medium" | "high";

/** SSOT list of valid time-range values for search tools. */
export const SEARCH_TIME_RANGES: readonly SearchTimeRange[] = ["day", "week", "month", "year", "all"];
/** SSOT list of valid depth profiles for search tools. */
export const SEARCH_DEPTH_PROFILES: readonly SearchDepthProfile[] = ["low", "medium", "high"];

export interface SearchDepthDefaults {
  maxResults: number;
  prefetch: boolean;
  reformulate: boolean;
  prefetchTargets: number;
}

/** SSOT defaults used by searchDepth profile resolution. */
export const SEARCH_DEPTH_DEFAULTS: Record<SearchDepthProfile, SearchDepthDefaults> = {
  low: { maxResults: 3, prefetch: false, reformulate: false, prefetchTargets: 0 },
  medium: { maxResults: 5, prefetch: true, reformulate: true, prefetchTargets: 3 },
  high: { maxResults: 8, prefetch: true, reformulate: true, prefetchTargets: 4 },
};

export interface SearchCallOptions {
  limit: number;
  timeoutMs?: number;
  allowedDomains?: string[];
  blockedDomains?: string[];
  timeRange?: SearchTimeRange;
  locale?: string;
  toolOptions?: ToolExecutionOptions;
  reformulate?: boolean;      // Enable query reformulation for wider recall (default: true)
  searchDepth?: SearchDepthProfile;
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
  provenance?: "provider" | "retrieval" | "inferred";
  sourceId?: string;
  sourceType?: "url" | "document";
  providerMetadata?: Record<string, unknown>;
  startIndex?: number;
  endIndex?: number;
  confidence?: number;
  spanText?: string;
  sourceKind?: "snippet" | "passage";
  sourceClass?: SearchResultSourceClass;
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

export function normalizeDomain(input: string): string {
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

export function filterSearchResultsByDomain<T extends { url?: string }>(
  results: T[],
  allowedDomains?: string[],
  blockedDomains?: string[],
): T[] {
  return results.filter((result) => {
    if (!result.url) return true;
    try {
      const hostname = new URL(result.url).hostname;
      return isAllowedByDomainFilters(hostname, allowedDomains, blockedDomains);
    } catch {
      return true;
    }
  });
}
