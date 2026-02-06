/**
 * HLVM Config Storage
 * File I/O with atomic writes for ~/.hlvm/config.json
 */

import {
  type HlvmConfig,
  type KeybindingsConfig,
  DEFAULT_CONFIG,
  DEFAULT_TOOLS_CONFIG,
  DEFAULT_WEB_FETCH_CONFIG,
  DEFAULT_WEB_SEARCH_CONFIG,
  CONFIG_KEYS,
  type ConfigKey,
  validateValue,
  normalizeModelId,
  type ToolsConfig,
  type WebFetchConfig,
  type WebSearchConfig,
} from "./types.ts";
import { getHlvmDir, getConfigPath } from "../paths.ts";
import { getLegacyConfigPath } from "../legacy-migration.ts";
import { getPlatform } from "../../platform/platform.ts";

// SSOT: Use platform layer for all file/path operations
const fs = () => getPlatform().fs;
import { log } from "../../hlvm/api/log.ts";

// Re-export for backward compatibility
export { getHlvmDir, getConfigPath };

// ============================================================
// File I/O
// ============================================================

interface ReadConfigResult {
  data: Record<string, unknown> | null;
  exists: boolean;
  error?: Error;
}

async function readJsonConfig(path: string): Promise<ReadConfigResult> {
  try {
    const content = await getPlatform().fs.readTextFile(path);
    const parsed = JSON.parse(content) as Record<string, unknown>;
    return { data: parsed, exists: true };
  } catch (error) {
    // Check for NotFound error (file doesn't exist)
    if (error instanceof Error && error.name === "NotFound") {
      return { data: null, exists: false };
    }
    if (error instanceof SyntaxError) {
      return { data: null, exists: true, error };
    }
    throw error;
  }
}

function normalizeEndpoint(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  if (/^https?:\/\//.test(trimmed)) return trimmed;
  return `http://${trimmed}`;
}

function normalizeNumber(value: unknown): number | undefined {
  if (typeof value === "number" && !Number.isNaN(value)) {
    return value;
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return undefined;
    const parsed = Number(trimmed);
    if (!Number.isNaN(parsed)) {
      return parsed;
    }
  }
  return undefined;
}

function normalizeKeybindings(value: unknown): KeybindingsConfig | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  const entries = Object.entries(value as Record<string, unknown>);
  const normalized: KeybindingsConfig = {};
  for (const [key, val] of entries) {
    if (typeof val === "string") {
      normalized[key] = val;
    }
  }
  return Object.keys(normalized).length > 0 ? normalized : undefined;
}

function normalizeWebSearchConfig(value: unknown): WebSearchConfig | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  const raw = value as Record<string, unknown>;
  const config: WebSearchConfig = {
    ...DEFAULT_WEB_SEARCH_CONFIG,
    brave: { ...DEFAULT_WEB_SEARCH_CONFIG.brave },
    perplexity: { ...DEFAULT_WEB_SEARCH_CONFIG.perplexity },
    openrouter: { ...DEFAULT_WEB_SEARCH_CONFIG.openrouter },
  };

  if (typeof raw.enabled === "boolean") config.enabled = raw.enabled;
  if (typeof raw.provider === "string") {
    const provider = raw.provider.toLowerCase();
    if (provider === "brave" || provider === "perplexity" || provider === "openrouter") {
      config.provider = provider as WebSearchConfig["provider"];
    }
  }
  if (typeof raw.maxResults === "number" && raw.maxResults > 0) {
    config.maxResults = raw.maxResults;
  }
  if (typeof raw.timeoutSeconds === "number" && raw.timeoutSeconds > 0) {
    config.timeoutSeconds = raw.timeoutSeconds;
  }
  if (typeof raw.cacheTtlMinutes === "number" && raw.cacheTtlMinutes >= 0) {
    config.cacheTtlMinutes = raw.cacheTtlMinutes;
  }

  if (raw.brave && typeof raw.brave === "object" && !Array.isArray(raw.brave)) {
    const brave = raw.brave as Record<string, unknown>;
    if (typeof brave.apiKey === "string") config.brave = { apiKey: brave.apiKey };
  }
  if (raw.perplexity && typeof raw.perplexity === "object" && !Array.isArray(raw.perplexity)) {
    const perplexity = raw.perplexity as Record<string, unknown>;
    config.perplexity = {
      apiKey: typeof perplexity.apiKey === "string" ? perplexity.apiKey : config.perplexity?.apiKey,
      baseUrl: typeof perplexity.baseUrl === "string" ? perplexity.baseUrl : config.perplexity?.baseUrl,
      model: typeof perplexity.model === "string" ? perplexity.model : config.perplexity?.model,
    };
  }
  if (raw.openrouter && typeof raw.openrouter === "object" && !Array.isArray(raw.openrouter)) {
    const openrouter = raw.openrouter as Record<string, unknown>;
    config.openrouter = {
      apiKey: typeof openrouter.apiKey === "string" ? openrouter.apiKey : config.openrouter?.apiKey,
      baseUrl: typeof openrouter.baseUrl === "string" ? openrouter.baseUrl : config.openrouter?.baseUrl,
      model: typeof openrouter.model === "string" ? openrouter.model : config.openrouter?.model,
    };
  }

  return config;
}

function normalizeWebFetchConfig(value: unknown): WebFetchConfig | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  const raw = value as Record<string, unknown>;
  const config: WebFetchConfig = {
    ...DEFAULT_WEB_FETCH_CONFIG,
    firecrawl: { ...DEFAULT_WEB_FETCH_CONFIG.firecrawl },
  };

  if (typeof raw.enabled === "boolean") config.enabled = raw.enabled;
  if (typeof raw.maxChars === "number" && raw.maxChars > 0) config.maxChars = raw.maxChars;
  if (typeof raw.timeoutSeconds === "number" && raw.timeoutSeconds > 0) {
    config.timeoutSeconds = raw.timeoutSeconds;
  }
  if (typeof raw.cacheTtlMinutes === "number" && raw.cacheTtlMinutes >= 0) {
    config.cacheTtlMinutes = raw.cacheTtlMinutes;
  }
  if (typeof raw.maxRedirects === "number" && raw.maxRedirects >= 0) {
    config.maxRedirects = raw.maxRedirects;
  }
  if (typeof raw.userAgent === "string" && raw.userAgent.trim()) {
    config.userAgent = raw.userAgent;
  }
  if (typeof raw.readability === "boolean") config.readability = raw.readability;

  if (raw.firecrawl && typeof raw.firecrawl === "object" && !Array.isArray(raw.firecrawl)) {
    const firecrawl = raw.firecrawl as Record<string, unknown>;
    config.firecrawl = {
      enabled: typeof firecrawl.enabled === "boolean"
        ? firecrawl.enabled
        : config.firecrawl?.enabled,
      apiKey: typeof firecrawl.apiKey === "string" ? firecrawl.apiKey : config.firecrawl?.apiKey,
      baseUrl: typeof firecrawl.baseUrl === "string" ? firecrawl.baseUrl : config.firecrawl?.baseUrl,
      onlyMainContent: typeof firecrawl.onlyMainContent === "boolean"
        ? firecrawl.onlyMainContent
        : config.firecrawl?.onlyMainContent,
      maxAgeMs: typeof firecrawl.maxAgeMs === "number"
        ? firecrawl.maxAgeMs
        : config.firecrawl?.maxAgeMs,
      timeoutSeconds: typeof firecrawl.timeoutSeconds === "number"
        ? firecrawl.timeoutSeconds
        : config.firecrawl?.timeoutSeconds,
    };
  }

  return config;
}

function normalizeToolsConfig(value: unknown): ToolsConfig | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  const raw = value as Record<string, unknown>;
  const tools: ToolsConfig = { web: { ...DEFAULT_TOOLS_CONFIG.web } };

  if (raw.web && typeof raw.web === "object" && !Array.isArray(raw.web)) {
    const web = raw.web as Record<string, unknown>;
    const search = normalizeWebSearchConfig(web.search);
    const fetch = normalizeWebFetchConfig(web.fetch);
    tools.web = {
      search: search ?? { ...DEFAULT_WEB_SEARCH_CONFIG },
      fetch: fetch ?? { ...DEFAULT_WEB_FETCH_CONFIG },
    };
  } else {
    tools.web = {
      search: { ...DEFAULT_WEB_SEARCH_CONFIG },
      fetch: { ...DEFAULT_WEB_FETCH_CONFIG },
    };
  }

  return tools;
}

function normalizeConfigInput(raw: Record<string, unknown> | null): Partial<HlvmConfig> | null {
  if (!raw || typeof raw !== "object") {
    return null;
  }

  const normalized: Partial<HlvmConfig> = {};

  if (typeof raw.version === "number" && !Number.isNaN(raw.version)) {
    normalized.version = raw.version;
  }

  const model = normalizeModelId(raw.model);
  if (model && validateValue("model", model).valid) {
    normalized.model = model;
  }

  const endpoint = normalizeEndpoint(raw.endpoint);
  if (endpoint && validateValue("endpoint", endpoint).valid) {
    normalized.endpoint = endpoint;
  }

  const temperature = normalizeNumber(raw.temperature);
  if (temperature !== undefined && validateValue("temperature", temperature).valid) {
    normalized.temperature = temperature;
  }

  const maxTokens = normalizeNumber(raw.maxTokens);
  if (maxTokens !== undefined && validateValue("maxTokens", maxTokens).valid) {
    normalized.maxTokens = maxTokens;
  }

  if (typeof raw.theme === "string" && validateValue("theme", raw.theme).valid) {
    normalized.theme = raw.theme;
  }

  const keybindings = normalizeKeybindings(raw.keybindings);
  if (keybindings) {
    normalized.keybindings = keybindings;
  }

  const tools = normalizeToolsConfig(raw.tools);
  if (tools) {
    normalized.tools = tools;
  }

  return Object.keys(normalized).length > 0 ? normalized : null;
}

function isDefaultLikeConfig(config: Partial<HlvmConfig> | null): boolean {
  if (!config) return true;
  for (const key of CONFIG_KEYS) {
    const value = config[key];
    if (value === undefined) continue;
    if (key === "tools") {
      const defaults = DEFAULT_CONFIG.tools;
      if (!defaults || typeof value !== "object") {
        return false;
      }
      const same = JSON.stringify(value) === JSON.stringify(defaults);
      if (!same) return false;
      continue;
    }
    if (value !== DEFAULT_CONFIG[key]) {
      return false;
    }
  }
  if (config.keybindings && Object.keys(config.keybindings).length > 0) {
    return false;
  }
  return true;
}

function mergeConfigs(
  current: Partial<HlvmConfig> | null,
  legacy: Partial<HlvmConfig> | null
): { config: HlvmConfig; usedLegacy: boolean } {
  const merged: HlvmConfig = { ...DEFAULT_CONFIG };
  const mergedByKey = merged as Record<ConfigKey, HlvmConfig[ConfigKey]>;
  let usedLegacy = false;

  for (const key of CONFIG_KEYS) {
    const currentValue = current?.[key] as HlvmConfig[ConfigKey] | undefined;
    const legacyValue = legacy?.[key] as HlvmConfig[ConfigKey] | undefined;
    const defaultValue = DEFAULT_CONFIG[key] as HlvmConfig[ConfigKey];
    const currentIsDefault = currentValue === undefined || currentValue === defaultValue;

    if (currentValue !== undefined && !currentIsDefault) {
      mergedByKey[key] = currentValue;
      continue;
    }
    if (legacyValue !== undefined) {
      mergedByKey[key] = legacyValue;
      usedLegacy = true;
      continue;
    }
    if (currentValue !== undefined) {
      mergedByKey[key] = currentValue;
    }
  }

  if (current?.version !== undefined) {
    merged.version = current.version;
  } else if (legacy?.version !== undefined) {
    merged.version = legacy.version;
    usedLegacy = true;
  }

  const currentKeybindings = current?.keybindings;
  const legacyKeybindings = legacy?.keybindings;
  if (currentKeybindings && Object.keys(currentKeybindings).length > 0) {
    merged.keybindings = currentKeybindings;
  } else if (legacyKeybindings && Object.keys(legacyKeybindings).length > 0) {
    merged.keybindings = legacyKeybindings;
    usedLegacy = true;
  } else if (currentKeybindings) {
    merged.keybindings = currentKeybindings;
  }

  return { config: merged, usedLegacy };
}

/**
 * Load config from disk, merging with defaults.
 * Migrates legacy ~/.hql/config.json values when present.
 */
export async function loadConfig(): Promise<HlvmConfig> {
  const path = getConfigPath();
  const legacyPath = getLegacyConfigPath();

  const currentResult = await readJsonConfig(path);
  const legacyResult = await readJsonConfig(legacyPath);
  const canUseLegacy = !currentResult.exists || !!currentResult.error;

  if (currentResult.error) {
    log.raw.warn("Warning: config.json is corrupted, using defaults or legacy config");
  }
  if (legacyResult.error) {
    log.raw.warn("Warning: legacy config.json is corrupted, ignoring");
  }

  const currentConfig = normalizeConfigInput(currentResult.data);
  const legacyConfig = canUseLegacy ? normalizeConfigInput(legacyResult.data) : null;

  const { config, usedLegacy } = mergeConfigs(currentConfig, legacyConfig);

  const shouldPersistLegacy = usedLegacy && canUseLegacy && isDefaultLikeConfig(currentConfig);
  if (shouldPersistLegacy) {
    try {
      await saveConfig(config);
    } catch (error) {
      log.raw.warn(`Warning: failed to persist migrated config: ${(error as Error).message}`);
    }
  }

  return config;
}

/**
 * Save config to disk using atomic write (temp file + rename)
 */
export async function saveConfig(config: HlvmConfig): Promise<void> {
  const platform = getPlatform();
  const dir = getHlvmDir();
  const path = getConfigPath();
  const tempPath = `${path}.tmp`;

  await fs().ensureDir(dir);

  // Write to temp file first
  const content = JSON.stringify(config, null, 2) + "\n";
  await platform.fs.writeTextFile(tempPath, content);

  // Atomic rename
  await platform.fs.rename(tempPath, path);
}

// ============================================================
// Config Access Helpers
// ============================================================

/**
 * Get a config value by key
 */
export function getConfigValue(config: HlvmConfig, key: ConfigKey): unknown {
  return config[key];
}

/**
 * Check if a string is a valid config key
 */
export function isConfigKey(key: string): key is ConfigKey {
  return CONFIG_KEYS.includes(key as ConfigKey);
}

/**
 * Reset config to defaults and save
 */
export async function resetConfig(): Promise<HlvmConfig> {
  const config = { ...DEFAULT_CONFIG };
  await saveConfig(config);
  return config;
}
