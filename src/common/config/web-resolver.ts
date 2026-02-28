/**
 * Web tools config resolver.
 *
 * SSOT for resolving web tool settings from config defaults and env overrides.
 */

import { getEnvVar } from "../paths.ts";
import {
  createDefaultWebFetchConfig,
  createDefaultWebSearchConfig,
  type SearchProvider,
  type WebFetchConfig,
  type WebSearchConfig,
} from "./types.ts";

export interface ResolvedWebSearchConfig {
  enabled: boolean;
  provider: SearchProvider;
  maxResults: number;
  timeoutSeconds: number;
  cacheTtlMinutes: number;
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

export interface WebConfigEnv {
  get: (key: string) => string | undefined;
}

const DEFAULT_WEB_CONFIG_ENV: WebConfigEnv = {
  get: (key: string) => getEnvVar(key),
};

function resolveWebSearchConfig(
  config?: WebSearchConfig,
  _env: WebConfigEnv = DEFAULT_WEB_CONFIG_ENV,
): ResolvedWebSearchConfig {
  const defaults = createDefaultWebSearchConfig();
  const resolved: ResolvedWebSearchConfig = {
    enabled: config?.enabled ?? defaults.enabled ?? true,
    provider: config?.provider ?? "duckduckgo",
    maxResults: config?.maxResults ?? defaults.maxResults ?? 5,
    timeoutSeconds: config?.timeoutSeconds ?? defaults.timeoutSeconds ?? 30,
    cacheTtlMinutes: config?.cacheTtlMinutes ?? defaults.cacheTtlMinutes ?? 15,
  };

  return resolved;
}

function resolveWebFetchConfig(
  config?: WebFetchConfig,
  env: WebConfigEnv = DEFAULT_WEB_CONFIG_ENV,
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

  const firecrawlKey = env.get("FIRECRAWL_API_KEY");
  if (firecrawlKey) resolved.firecrawl.apiKey = firecrawlKey;

  return resolved;
}

export function resolveWebConfig(
  web?: { search?: WebSearchConfig; fetch?: WebFetchConfig },
  env: WebConfigEnv = DEFAULT_WEB_CONFIG_ENV,
): ResolvedWebConfig {
  return {
    search: resolveWebSearchConfig(web?.search, env),
    fetch: resolveWebFetchConfig(web?.fetch, env),
  };
}
