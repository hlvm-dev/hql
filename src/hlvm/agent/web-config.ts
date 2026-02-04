/**
 * Web Tool Configuration - OpenClaw-compatible settings with env overrides
 */

import { loadConfig } from "../../common/config/storage.ts";
import {
  DEFAULT_WEB_FETCH_CONFIG,
  DEFAULT_WEB_SEARCH_CONFIG,
  type WebFetchConfig,
  type WebSearchConfig,
} from "../../common/config/types.ts";
import { getEnvVar } from "../../common/paths.ts";

export interface ResolvedWebSearchConfig {
  enabled: boolean;
  provider: "brave" | "perplexity" | "openrouter" | "serpapi";
  maxResults: number;
  timeoutSeconds: number;
  cacheTtlMinutes: number;
  brave: { apiKey?: string };
  perplexity: { apiKey?: string; baseUrl: string; model: string };
  openrouter: { apiKey?: string; baseUrl: string; model: string };
  serpapi: { apiKey?: string; baseUrl: string };
}

export interface ResolvedWebFetchConfig {
  enabled: boolean;
  maxChars: number;
  timeoutSeconds: number;
  cacheTtlMinutes: number;
  maxRedirects: number;
  userAgent: string;
  readability: boolean;
  firecrawl: {
    enabled: boolean;
    apiKey?: string;
    baseUrl: string;
    onlyMainContent: boolean;
    maxAgeMs: number;
    timeoutSeconds: number;
  };
}

function resolveSearchConfig(config?: WebSearchConfig): ResolvedWebSearchConfig {
  const base: ResolvedWebSearchConfig = {
    enabled: config?.enabled ?? DEFAULT_WEB_SEARCH_CONFIG.enabled ?? true,
    provider: (config?.provider ?? DEFAULT_WEB_SEARCH_CONFIG.provider ?? "brave") as
      ResolvedWebSearchConfig["provider"],
    maxResults: config?.maxResults ?? DEFAULT_WEB_SEARCH_CONFIG.maxResults ?? 5,
    timeoutSeconds: config?.timeoutSeconds ?? DEFAULT_WEB_SEARCH_CONFIG.timeoutSeconds ?? 30,
    cacheTtlMinutes: config?.cacheTtlMinutes ?? DEFAULT_WEB_SEARCH_CONFIG.cacheTtlMinutes ?? 15,
    brave: {
      apiKey: config?.brave?.apiKey ?? DEFAULT_WEB_SEARCH_CONFIG.brave?.apiKey,
    },
    perplexity: {
      apiKey: config?.perplexity?.apiKey ??
        DEFAULT_WEB_SEARCH_CONFIG.perplexity?.apiKey,
      baseUrl: config?.perplexity?.baseUrl ??
        DEFAULT_WEB_SEARCH_CONFIG.perplexity?.baseUrl ??
        "https://api.perplexity.ai",
      model: config?.perplexity?.model ??
        DEFAULT_WEB_SEARCH_CONFIG.perplexity?.model ??
        "sonar",
    },
    openrouter: {
      apiKey: config?.openrouter?.apiKey ??
        DEFAULT_WEB_SEARCH_CONFIG.openrouter?.apiKey,
      baseUrl: config?.openrouter?.baseUrl ??
        DEFAULT_WEB_SEARCH_CONFIG.openrouter?.baseUrl ??
        "https://openrouter.ai/api/v1",
      model: config?.openrouter?.model ??
        DEFAULT_WEB_SEARCH_CONFIG.openrouter?.model ??
        "perplexity/sonar",
    },
    serpapi: {
      apiKey: config?.serpapi?.apiKey ??
        DEFAULT_WEB_SEARCH_CONFIG.serpapi?.apiKey,
      baseUrl: config?.serpapi?.baseUrl ??
        DEFAULT_WEB_SEARCH_CONFIG.serpapi?.baseUrl ??
        "https://serpapi.com",
    },
  };

  const braveKey = getEnvVar("BRAVE_API_KEY");
  if (braveKey) base.brave.apiKey = braveKey;

  const perplexityKey = getEnvVar("PERPLEXITY_API_KEY");
  if (perplexityKey) base.perplexity.apiKey = perplexityKey;

  const openrouterKey = getEnvVar("OPENROUTER_API_KEY");
  if (openrouterKey) base.openrouter.apiKey = openrouterKey;

  const serpApiKey = getEnvVar("SERPAPI_API_KEY");
  if (serpApiKey) base.serpapi.apiKey = serpApiKey;

  return base;
}

function resolveFetchConfig(config?: WebFetchConfig): ResolvedWebFetchConfig {
  const base: ResolvedWebFetchConfig = {
    enabled: config?.enabled ?? DEFAULT_WEB_FETCH_CONFIG.enabled ?? true,
    maxChars: config?.maxChars ?? DEFAULT_WEB_FETCH_CONFIG.maxChars ?? 50000,
    timeoutSeconds: config?.timeoutSeconds ?? DEFAULT_WEB_FETCH_CONFIG.timeoutSeconds ?? 30,
    cacheTtlMinutes: config?.cacheTtlMinutes ?? DEFAULT_WEB_FETCH_CONFIG.cacheTtlMinutes ?? 15,
    maxRedirects: config?.maxRedirects ?? DEFAULT_WEB_FETCH_CONFIG.maxRedirects ?? 3,
    userAgent: config?.userAgent ?? DEFAULT_WEB_FETCH_CONFIG.userAgent ??
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_4) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
    readability: config?.readability ?? DEFAULT_WEB_FETCH_CONFIG.readability ?? true,
    firecrawl: {
      enabled: config?.firecrawl?.enabled ??
        DEFAULT_WEB_FETCH_CONFIG.firecrawl?.enabled ?? false,
      apiKey: config?.firecrawl?.apiKey ??
        DEFAULT_WEB_FETCH_CONFIG.firecrawl?.apiKey,
      baseUrl: config?.firecrawl?.baseUrl ??
        DEFAULT_WEB_FETCH_CONFIG.firecrawl?.baseUrl ??
        "https://api.firecrawl.dev",
      onlyMainContent: config?.firecrawl?.onlyMainContent ??
        DEFAULT_WEB_FETCH_CONFIG.firecrawl?.onlyMainContent ?? true,
      maxAgeMs: config?.firecrawl?.maxAgeMs ??
        DEFAULT_WEB_FETCH_CONFIG.firecrawl?.maxAgeMs ?? 900000,
      timeoutSeconds: config?.firecrawl?.timeoutSeconds ??
        DEFAULT_WEB_FETCH_CONFIG.firecrawl?.timeoutSeconds ?? 30,
    },
  };

  const firecrawlKey = getEnvVar("FIRECRAWL_API_KEY");
  if (firecrawlKey) base.firecrawl.apiKey = firecrawlKey;

  return base;
}

export async function loadWebConfig(): Promise<{
  search: ResolvedWebSearchConfig;
  fetch: ResolvedWebFetchConfig;
}> {
  const config = await loadConfig();
  const web = config.tools?.web;
  return {
    search: resolveSearchConfig(web?.search),
    fetch: resolveFetchConfig(web?.fetch),
  };
}
