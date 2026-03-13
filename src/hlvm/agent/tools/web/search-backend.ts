/**
 * WebSearchBackend - Interface for full-pipeline web search orchestration.
 *
 * Separates backend retrieval orchestration from the tool entrypoint
 * (validation, caching, formatting). The shared confidence helper is used for
 * retry/depth decisions, not result ranking.
 */

import type { ToolExecutionOptions } from "../../registry.ts";
import type {
  Citation,
  SearchDepthProfile,
  SearchProviderSpec,
  SearchResult,
  SearchTimeRange,
} from "./search-provider.ts";
import { assessSearchConfidence } from "./search-ranking.ts";

// ============================================================
// Request / Response Types
// ============================================================

export interface WebSearchRequest {
  query: string;
  limit: number;
  timeoutMs?: number;
  allowedDomains?: string[];
  blockedDomains?: string[];
  timeRange: SearchTimeRange;
  locale?: string;
  searchDepth: SearchDepthProfile;
  prefetch: boolean;
  reformulate: boolean;
  profilePrefetchTargets: number;
  provider: SearchProviderSpec;
  fetchUserAgent: string;
  toolOptions?: ToolExecutionOptions;
}

export interface WebSearchResponse {
  query: string;
  provider: string;
  results: SearchResult[];
  count: number;
  citations: Citation[];
  diagnostics: Record<string, unknown>;
}

// ============================================================
// Backend Interface
// ============================================================

export interface WebSearchBackend {
  search(request: WebSearchRequest): Promise<WebSearchResponse>;
}

// ============================================================
// Shared Confidence Thresholds
// ============================================================

export const LOW_CONFIDENCE_SCORE_THRESHOLD = 4;
const LOW_CONFIDENCE_DIVERSITY_THRESHOLD = 0.4;
const LOW_CONFIDENCE_COVERAGE_THRESHOLD = 0.55;

export function assessToolSearchConfidence(query: string, results: SearchResult[]) {
  return assessSearchConfidence(query, results, {
    scoreThreshold: LOW_CONFIDENCE_SCORE_THRESHOLD,
    diversityThreshold: LOW_CONFIDENCE_DIVERSITY_THRESHOLD,
    coverageThreshold: LOW_CONFIDENCE_COVERAGE_THRESHOLD,
  });
}
