/**
 * Web tools config resolver.
 *
 * SSOT for resolving web tool settings from config defaults and env overrides.
 */

import { getEnvVar } from "../paths.ts";
import {
  createDefaultWebFetchConfig,
  createDefaultWebSearchConfig,
  DEFAULT_USER_AGENT,
  type SearchProvider,
  type WebFetchConfig,
  type WebSearchConfig,
} from "./types.ts";

export { DEFAULT_USER_AGENT } from "./types.ts";

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
}

export interface ResolvedWebConfig {
  search: ResolvedWebSearchConfig;
  fetch: ResolvedWebFetchConfig;
}

interface WebConfigEnv {
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
  _env: WebConfigEnv = DEFAULT_WEB_CONFIG_ENV,
): ResolvedWebFetchConfig {
  const defaults = createDefaultWebFetchConfig();
  const resolved: ResolvedWebFetchConfig = {
    enabled: config?.enabled ?? defaults.enabled ?? true,
    maxChars: config?.maxChars ?? defaults.maxChars ?? 50000,
    timeoutSeconds: config?.timeoutSeconds ?? defaults.timeoutSeconds ?? 30,
    cacheTtlMinutes: config?.cacheTtlMinutes ?? defaults.cacheTtlMinutes ?? 15,
    maxRedirects: config?.maxRedirects ?? defaults.maxRedirects ?? 3,
    userAgent: config?.userAgent ?? defaults.userAgent ?? DEFAULT_USER_AGENT,
    readability: config?.readability ?? defaults.readability ?? true,
  };

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
