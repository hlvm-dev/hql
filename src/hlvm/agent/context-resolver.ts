/**
 * Context Resolver — Dynamic context window budget resolution
 *
 * 3-layer pipeline:
 * 1. Preflight: user override → provider API metadata → cache → seed defaults → 32K fallback
 * 2. Runtime: overflow error parsing → cache update → budget reduction → retry
 * 3. Persistent cache: ~/.hlvm/model-context-cache.json
 *
 * SSOT for context budget resolution across CLI and GUI.
 */

import { getPlatform } from "../../platform/platform.ts";
import { getModelContextCachePath } from "../../common/paths.ts";
import type { ContextOverflowInfo, ModelInfo } from "../providers/types.ts";
import { getAgentLogger } from "./logger.ts";

// ============================================================================
// Cache Types
// ============================================================================

interface ContextCacheEntry {
  limitTokens: number;
  confidence: "high" | "low";
  updatedAt: string;
}

interface ContextCacheFile {
  version: 1;
  entries: Record<string, ContextCacheEntry>;
}

// ============================================================================
// Constants
// ============================================================================

/** Conservative fallback when no context window info is available */
const DEFAULT_CONTEXT_WINDOW = 32_000;

/** Reserve 15% of context for output tokens and safety margin */
const BUDGET_RATIO = 0.85;

/** Max overflow retries before giving up */
const MAX_OVERFLOW_RETRIES = 2;

// ============================================================================
// In-Memory Cache
// ============================================================================

let memoryCache: ContextCacheFile | null = null;

function createDefaultCache(): ContextCacheFile {
  return { version: 1, entries: {} };
}

function buildCacheKey(
  provider: string,
  model: string,
  endpoint?: string,
  digest?: string,
): string {
  const parts = [provider, model];
  if (endpoint) parts.push(endpoint);
  if (digest) parts.push(digest);
  return parts.join(":");
}

// ============================================================================
// Cache Read/Write (follows web-cache.ts pattern)
// ============================================================================

async function loadCache(): Promise<ContextCacheFile> {
  if (memoryCache) return memoryCache;

  const cachePath = getModelContextCachePath();
  try {
    const raw = await getPlatform().fs.readTextFile(cachePath);
    const parsed = JSON.parse(raw);
    if (
      parsed &&
      typeof parsed === "object" &&
      parsed.version === 1 &&
      typeof parsed.entries === "object"
    ) {
      memoryCache = parsed as ContextCacheFile;
      return memoryCache;
    }
  } catch {
    // File doesn't exist or is malformed — use default
  }

  memoryCache = createDefaultCache();
  return memoryCache;
}

async function writeCache(cache: ContextCacheFile): Promise<void> {
  memoryCache = cache;
  const cachePath = getModelContextCachePath();
  try {
    await getPlatform().fs.writeTextFile(cachePath, JSON.stringify(cache, null, 2));
  } catch {
    // Best-effort write — don't crash on permission errors
  }
}

async function updateCacheEntry(
  key: string,
  limitTokens: number,
  confidence: "high" | "low",
): Promise<void> {
  const cache = await loadCache();
  cache.entries[key] = {
    limitTokens,
    confidence,
    updatedAt: new Date().toISOString(),
  };
  await writeCache(cache);
}

/** Reset in-memory cache (for testing) */
export function resetContextCache(): void {
  memoryCache = null;
}

// ============================================================================
// Resolver
// ============================================================================

export interface ResolveContextWindowOptions {
  provider: string;
  model: string;
  endpoint?: string;
  digest?: string;
  /** ModelInfo from provider.models.get() — may contain contextWindow */
  modelInfo?: ModelInfo;
  /** User config override (config.contextWindow) */
  userOverride?: number;
}

/**
 * Resolve the effective context window budget for a model.
 *
 * Priority chain (first non-null wins):
 * 1. User config override
 * 2. Provider API metadata (modelInfo.contextWindow)
 * 3. Learned cache (~/.hlvm/model-context-cache.json)
 * 4. Conservative fallback: 32K
 *
 * Returns: effective budget = resolved * 0.85 (reserves 15% for output)
 */
export async function resolveContextWindow(
  opts: ResolveContextWindowOptions,
): Promise<number> {
  const log = getAgentLogger();

  // 1. User override — highest priority
  if (opts.userOverride && opts.userOverride > 0) {
    log.debug?.(`Context budget: user override ${opts.userOverride}`);
    return Math.floor(opts.userOverride * BUDGET_RATIO);
  }

  // 2. Provider API metadata
  if (opts.modelInfo?.contextWindow && opts.modelInfo.contextWindow > 0) {
    const budget = Math.floor(opts.modelInfo.contextWindow * BUDGET_RATIO);
    log.debug?.(`Context budget: provider API → ${opts.modelInfo.contextWindow} → ${budget}`);
    // Cache for future use
    const key = buildCacheKey(opts.provider, opts.model, opts.endpoint, opts.digest);
    await updateCacheEntry(key, opts.modelInfo.contextWindow, "high");
    return budget;
  }

  // 3. Learned cache
  const cache = await loadCache();
  const key = buildCacheKey(opts.provider, opts.model, opts.endpoint, opts.digest);
  const cached = cache.entries[key];
  if (cached) {
    const budget = Math.floor(cached.limitTokens * BUDGET_RATIO);
    log.debug?.(`Context budget: cache hit → ${cached.limitTokens} → ${budget}`);
    return budget;
  }

  // 4. Conservative fallback
  log.debug?.(`Context budget: fallback → ${DEFAULT_CONTEXT_WINDOW}`);
  return Math.floor(DEFAULT_CONTEXT_WINDOW * BUDGET_RATIO);
}

// ============================================================================
// Overflow Handler
// ============================================================================

export interface HandleContextOverflowOptions {
  error: unknown;
  provider: string;
  model: string;
  endpoint?: string;
  digest?: string;
  parseOverflow: (err: unknown) => ContextOverflowInfo;
  currentBudget: number;
  /** How many overflow retries have already been attempted */
  overflowRetryCount?: number;
}

export interface OverflowResult {
  newBudget: number;
  shouldRetry: boolean;
}

/**
 * Handle a context overflow error from an LLM provider.
 *
 * - Parses the error to extract the actual context limit
 * - Updates the persistent cache with the learned limit
 * - Returns a reduced budget and whether to retry
 * - Max 2 retries: first at limit * 0.85, second at limit * 0.5
 */
export async function handleContextOverflow(
  opts: HandleContextOverflowOptions,
): Promise<OverflowResult> {
  const retryCount = opts.overflowRetryCount ?? 0;

  // Max retries exceeded
  if (retryCount >= MAX_OVERFLOW_RETRIES) {
    return { newBudget: opts.currentBudget, shouldRetry: false };
  }

  const info = opts.parseOverflow(opts.error);
  if (!info.isOverflow) {
    return { newBudget: opts.currentBudget, shouldRetry: false };
  }

  const key = buildCacheKey(opts.provider, opts.model, opts.endpoint, opts.digest);
  const log = getAgentLogger();

  if (info.limitTokens && info.confidence === "high") {
    // Known limit — cache it and use 85% of it
    await updateCacheEntry(key, info.limitTokens, "high");
    const newBudget = Math.floor(info.limitTokens * BUDGET_RATIO);
    log.debug?.(`Context overflow: learned limit ${info.limitTokens} → budget ${newBudget}`);
    return { newBudget, shouldRetry: true };
  }

  // Unknown limit — reduce progressively: 75% then 50%
  const reductionFactor = retryCount === 0 ? 0.75 : 0.5;
  const newBudget = Math.floor(opts.currentBudget * reductionFactor);
  await updateCacheEntry(key, newBudget, "low");
  log.debug?.(`Context overflow: reduce budget ${opts.currentBudget} → ${newBudget} (${reductionFactor}x)`);
  return { newBudget, shouldRetry: true };
}

// ============================================================================
// Provider Overflow Parser Resolver
// ============================================================================

/**
 * Get the provider-specific overflow error parser for a given provider name.
 * Uses lazy dynamic imports to avoid circular deps and keep the module lightweight.
 */
export async function getOverflowParser(
  providerName: string,
): Promise<((err: unknown) => ContextOverflowInfo) | null> {
  switch (providerName) {
    case "ollama":
      return (await import("../providers/ollama/api.ts")).parseOverflowError;
    case "openai":
      return (await import("../providers/openai/api.ts")).parseOverflowError;
    case "anthropic":
      return (await import("../providers/anthropic/api.ts")).parseOverflowError;
    case "google":
      return (await import("../providers/google/api.ts")).parseOverflowError;
    case "claude-code":
      return (await import("../providers/claude-code/api.ts")).parseOverflowError;
    default:
      return null;
  }
}
