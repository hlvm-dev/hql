/**
 * Web tools config resolver.
 *
 * SSOT for resolving web tool settings from config defaults and env overrides.
 */

import { getEnvVar } from "../paths.ts";
import {
  createDefaultWebFetchConfig,
  createDefaultWebSearchConfig,
  type WebFetchConfig,
  type WebSearchConfig,
} from "./types.ts";

type SearchProvider = NonNullable<WebSearchConfig["provider"]>;

export interface ResolvedWebSearchConfig {
  enabled: boolean;
  provider: SearchProvider;
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

export interface ResolvedWebConfig {
  search: ResolvedWebSearchConfig;
  fetch: ResolvedWebFetchConfig;
}

function resolveWebSearchConfig(
  config?: WebSearchConfig,
): ResolvedWebSearchConfig {
  const defaults = createDefaultWebSearchConfig();
  const resolved: ResolvedWebSearchConfig = {
    enabled: config?.enabled ?? defaults.enabled ?? true,
    provider:
      (config?.provider ?? defaults.provider ?? "brave") as SearchProvider,
    maxResults: config?.maxResults ?? defaults.maxResults ?? 5,
    timeoutSeconds: config?.timeoutSeconds ?? defaults.timeoutSeconds ?? 30,
    cacheTtlMinutes: config?.cacheTtlMinutes ?? defaults.cacheTtlMinutes ?? 15,
    brave: {
      apiKey: config?.brave?.apiKey ?? defaults.brave?.apiKey,
    },
    perplexity: {
      apiKey: config?.perplexity?.apiKey ?? defaults.perplexity?.apiKey,
      baseUrl: config?.perplexity?.baseUrl ?? defaults.perplexity?.baseUrl ??
        "https://api.perplexity.ai",
      model: config?.perplexity?.model ?? defaults.perplexity?.model ?? "sonar",
    },
    openrouter: {
      apiKey: config?.openrouter?.apiKey ?? defaults.openrouter?.apiKey,
      baseUrl: config?.openrouter?.baseUrl ?? defaults.openrouter?.baseUrl ??
        "https://openrouter.ai/api/v1",
      model: config?.openrouter?.model ?? defaults.openrouter?.model ??
        "perplexity/sonar",
    },
    serpapi: {
      apiKey: config?.serpapi?.apiKey ?? defaults.serpapi?.apiKey,
      baseUrl: config?.serpapi?.baseUrl ?? defaults.serpapi?.baseUrl ??
        "https://serpapi.com",
    },
  };

  const braveKey = getEnvVar("BRAVE_API_KEY");
  if (braveKey) resolved.brave.apiKey = braveKey;

  const perplexityKey = getEnvVar("PERPLEXITY_API_KEY");
  if (perplexityKey) resolved.perplexity.apiKey = perplexityKey;

  const openrouterKey = getEnvVar("OPENROUTER_API_KEY");
  if (openrouterKey) resolved.openrouter.apiKey = openrouterKey;

  const serpApiKey = getEnvVar("SERPAPI_API_KEY");
  if (serpApiKey) resolved.serpapi.apiKey = serpApiKey;

  return resolved;
}

function resolveWebFetchConfig(
  config?: WebFetchConfig,
): ResolvedWebFetchConfig {
  const defaults = createDefaultWebFetchConfig();
  const resolved: ResolvedWebFetchConfig = {
    enabled: config?.enabled ?? defaults.enabled ?? true,
    maxChars: config?.maxChars ?? defaults.maxChars ?? 50000,
    timeoutSeconds: config?.timeoutSeconds ?? defaults.timeoutSeconds ?? 30,
    cacheTtlMinutes: config?.cacheTtlMinutes ?? defaults.cacheTtlMinutes ?? 15,
    maxRedirects: config?.maxRedirects ?? defaults.maxRedirects ?? 3,
    userAgent: config?.userAgent ?? defaults.userAgent ??
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_4) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
    readability: config?.readability ?? defaults.readability ?? true,
    firecrawl: {
      enabled: config?.firecrawl?.enabled ?? defaults.firecrawl?.enabled ??
        false,
      apiKey: config?.firecrawl?.apiKey ?? defaults.firecrawl?.apiKey,
      baseUrl: config?.firecrawl?.baseUrl ?? defaults.firecrawl?.baseUrl ??
        "https://api.firecrawl.dev",
      onlyMainContent: config?.firecrawl?.onlyMainContent ??
        defaults.firecrawl?.onlyMainContent ?? true,
      maxAgeMs: config?.firecrawl?.maxAgeMs ?? defaults.firecrawl?.maxAgeMs ??
        900000,
      timeoutSeconds: config?.firecrawl?.timeoutSeconds ??
        defaults.firecrawl?.timeoutSeconds ?? 30,
    },
  };

  const firecrawlKey = getEnvVar("FIRECRAWL_API_KEY");
  if (firecrawlKey) resolved.firecrawl.apiKey = firecrawlKey;

  return resolved;
}

export function resolveWebConfig(
  web?: { search?: WebSearchConfig; fetch?: WebFetchConfig },
): ResolvedWebConfig {
  return {
    search: resolveWebSearchConfig(web?.search),
    fetch: resolveWebFetchConfig(web?.fetch),
  };
}
