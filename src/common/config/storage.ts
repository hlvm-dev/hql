/**
 * HLVM Config Storage
 * File I/O with atomic writes for ~/.hlvm/config.json
 */

import {
  CHANNEL_TRANSPORT_MODES,
  CONFIG_KEYS,
  type ChannelConfig,
  type ChannelTransportConfig,
  type ChannelTransportMode,
  type ChannelsConfig,
  type ConfigKey,
  createDefaultToolsConfig,
  createDefaultWebFetchConfig,
  createDefaultWebSearchConfig,
  DEFAULT_CONFIG,
  DEFAULT_OLLAMA_ENDPOINT,
  type HlvmConfig,
  type KeybindingsConfig,
  normalizeModelId,
  type ToolsConfig,
  validateValue,
  type WebFetchConfig,
  type WebSearchConfig,
} from "./types.ts";
import { getHlvmDir, getSettingsPath } from "../paths.ts";
import { getPlatform } from "../../platform/platform.ts";
import { atomicWriteTextFile } from "../atomic-file.ts";
import { isFileNotFoundError } from "../utils.ts";
import {
  CURRENT_CONFIG_VERSION,
  migrateConfig,
  stampCurrentConfigVersion,
} from "./migrations.ts";

// SSOT: Use platform layer for all file/path operations
const fs = () => getPlatform().fs;
import { log } from "../../hlvm/api/log.ts";

// Re-export for backward compatibility
export { getConfigPath, getHlvmDir } from "../paths.ts";

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
    const content = await fs().readTextFile(path);
    const parsed = JSON.parse(content) as Record<string, unknown>;
    return { data: parsed, exists: true };
  } catch (error) {
    // Check for NotFound error (file doesn't exist)
    if (isFileNotFoundError(error)) {
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

function canonicalizeLocalOllamaEndpoint(endpoint: string): string {
  try {
    const parsed = new URL(endpoint);
    const host = parsed.hostname.toLowerCase();
    const isLoopbackHost = host === "localhost" || host === "127.0.0.1";
    if (isLoopbackHost && parsed.port === "11439") {
      return DEFAULT_OLLAMA_ENDPOINT;
    }
  } catch {
    // Keep the original value if URL parsing fails.
  }
  return endpoint;
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
  const config: WebSearchConfig = createDefaultWebSearchConfig();

  if (typeof raw.enabled === "boolean") config.enabled = raw.enabled;
  if (typeof raw.provider === "string") {
    const provider = raw.provider.toLowerCase();
    if (provider === "duckduckgo") {
      config.provider = provider as WebSearchConfig["provider"];
    } else {
      // Legacy providers were removed; always collapse to keyless DuckDuckGo.
      config.provider = "duckduckgo";
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

  return config;
}

function normalizeWebFetchConfig(value: unknown): WebFetchConfig | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  const raw = value as Record<string, unknown>;
  const config: WebFetchConfig = createDefaultWebFetchConfig();

  if (typeof raw.enabled === "boolean") config.enabled = raw.enabled;
  if (typeof raw.maxChars === "number" && raw.maxChars > 0) {
    config.maxChars = raw.maxChars;
  }
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
  if (typeof raw.readability === "boolean") {
    config.readability = raw.readability;
  }

  return config;
}

function normalizeToolsConfig(value: unknown): ToolsConfig | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  const raw = value as Record<string, unknown>;
  const tools: ToolsConfig = createDefaultToolsConfig();

  if (raw.web && typeof raw.web === "object" && !Array.isArray(raw.web)) {
    const web = raw.web as Record<string, unknown>;
    tools.web = {
      search: normalizeWebSearchConfig(web.search) ?? createDefaultWebSearchConfig(),
      fetch: normalizeWebFetchConfig(web.fetch) ?? createDefaultWebFetchConfig(),
    };
  }
  // else: tools.web already has defaults from createDefaultToolsConfig()

  return tools;
}

function normalizeChannelTransportConfig(
  value: unknown,
): ChannelTransportConfig | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  const raw = value as Record<string, unknown>;
  const extras = Object.fromEntries(
    Object.entries(raw).filter(([key]) =>
      !["mode", "deviceId", "relayUrl", "token", "cursor"].includes(key)
    ),
  );
  const config: ChannelTransportConfig = { ...extras };

  if (
    typeof raw.mode === "string" &&
    CHANNEL_TRANSPORT_MODES.includes(raw.mode as ChannelTransportMode)
  ) {
    config.mode = raw.mode as ChannelTransportMode;
  }
  if (typeof raw.deviceId === "string" && raw.deviceId.trim()) {
    config.deviceId = raw.deviceId.trim();
  }
  if (typeof raw.relayUrl === "string" && raw.relayUrl.trim()) {
    config.relayUrl = raw.relayUrl.trim();
  }
  if (typeof raw.token === "string" && raw.token.trim()) {
    config.token = raw.token;
  }
  if (
    typeof raw.cursor === "number" && Number.isInteger(raw.cursor) &&
    raw.cursor >= 0
  ) {
    config.cursor = raw.cursor;
  }

  return Object.keys(config).length > 0 ? config : undefined;
}

function normalizeChannelConfig(value: unknown): ChannelConfig | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  const raw = value as Record<string, unknown>;
  const extras = Object.fromEntries(
    Object.entries(raw).filter(([key]) =>
      !["enabled", "allowedIds", "transport"].includes(key)
    ),
  );
  const config: ChannelConfig = { ...extras };

  if (typeof raw.enabled === "boolean") {
    config.enabled = raw.enabled;
  }
  if (Array.isArray(raw.allowedIds)) {
    const allowedIds = raw.allowedIds.filter((entry): entry is string =>
      typeof entry === "string" && entry.trim().length > 0
    ).map((entry) => entry.trim());
    if (allowedIds.length > 0) {
      config.allowedIds = [...new Set(allowedIds)];
    }
  }
  const transport = normalizeChannelTransportConfig(raw.transport);
  if (transport) {
    config.transport = transport;
  }

  return Object.keys(config).length > 0 ? config : undefined;
}

function normalizeChannelsConfig(value: unknown): ChannelsConfig | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  const normalized: ChannelsConfig = {};
  for (const [channel, channelValue] of Object.entries(value)) {
    if (!channel.trim()) continue;
    const config = normalizeChannelConfig(channelValue);
    if (config) {
      normalized[channel] = config;
    }
  }
  return normalized;
}

function normalizeConfigInput(
  raw: Record<string, unknown> | null,
): Partial<HlvmConfig> | null {
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
    normalized.endpoint = canonicalizeLocalOllamaEndpoint(endpoint);
  }

  const temperature = normalizeNumber(raw.temperature);
  if (
    temperature !== undefined && validateValue("temperature", temperature).valid
  ) {
    normalized.temperature = temperature;
  }

  const maxTokens = normalizeNumber(raw.maxTokens);
  if (maxTokens !== undefined && validateValue("maxTokens", maxTokens).valid) {
    normalized.maxTokens = maxTokens;
  }

  if (
    typeof raw.theme === "string" && validateValue("theme", raw.theme).valid
  ) {
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

  if (typeof raw.modelConfigured === "boolean") {
    normalized.modelConfigured = raw.modelConfigured;
  }

  if (
    Array.isArray(raw.approvedProviders) &&
    raw.approvedProviders.every((v: unknown) => typeof v === "string")
  ) {
    normalized.approvedProviders = raw.approvedProviders as string[];
  }

  if (raw.agentMode === "hlvm" || raw.agentMode === "claude-code-agent") {
    normalized.agentMode = raw.agentMode;
  }

  if (typeof raw.sessionMemory === "boolean") {
    normalized.sessionMemory = raw.sessionMemory;
  }

  if (
    typeof raw.permissionMode === "string" &&
    validateValue("permissionMode", raw.permissionMode).valid
  ) {
    normalized.permissionMode = raw
      .permissionMode as HlvmConfig["permissionMode"];
  }

  // Integer config fields with validateValue-based normalization
  for (
    const key of [
      "chatMaxPromptChars",
      "chatMaxReferencesLocal",
      "chatMaxReferencesCloud",
    ] as const
  ) {
    const val = normalizeNumber(raw[key]);
    if (val !== undefined && validateValue(key, val).valid) {
      (normalized as Record<string, unknown>)[key] = val;
    }
  }

  const channels = normalizeChannelsConfig(raw.channels);
  if (channels && validateValue("channels", channels).valid) {
    normalized.channels = channels;
  }

  return Object.keys(normalized).length > 0 ? normalized : null;
}

function mergeConfigs(
  current: Partial<HlvmConfig> | null,
  legacy: Partial<HlvmConfig> | null,
): { config: HlvmConfig; usedLegacy: boolean } {
  const merged: HlvmConfig = {
    ...DEFAULT_CONFIG,
    version: CURRENT_CONFIG_VERSION,
  };
  const mergedByKey = merged as Record<ConfigKey, HlvmConfig[ConfigKey]>;
  let usedLegacy = false;

  for (const key of CONFIG_KEYS) {
    const currentValue = current?.[key] as HlvmConfig[ConfigKey] | undefined;
    const legacyValue = legacy?.[key] as HlvmConfig[ConfigKey] | undefined;
    const defaultValue = DEFAULT_CONFIG[key] as HlvmConfig[ConfigKey];
    const currentIsDefault = currentValue === undefined ||
      (key === "tools" || key === "channels"
        ? JSON.stringify(currentValue) === JSON.stringify(defaultValue)
        : currentValue === defaultValue);

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

  merged.version = CURRENT_CONFIG_VERSION;

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

function mergeUnknownConfigFields(
  config: HlvmConfig,
  raw: Record<string, unknown> | null,
): HlvmConfig {
  if (!raw) return config;
  const knownKeys = new Set<string>(["version", ...CONFIG_KEYS]);
  const extras = Object.fromEntries(
    Object.entries(raw).filter(([key]) => !knownKeys.has(key)),
  );
  return {
    ...extras,
    ...config,
    version: CURRENT_CONFIG_VERSION,
  } as HlvmConfig;
}

/**
 * Load config from ~/.hlvm/settings.json (the sole SSOT).
 * Returns defaults if file doesn't exist.
 */
export async function loadConfig(): Promise<HlvmConfig> {
  const settingsResult = await readJsonConfig(getSettingsPath());
  if (!settingsResult.exists || settingsResult.error || !settingsResult.data) {
    return { ...DEFAULT_CONFIG };
  }
  const migrated = migrateConfig(settingsResult.data);
  const normalized = normalizeConfigInput(migrated.config);
  const { config } = mergeConfigs(normalized, null);
  return mergeUnknownConfigFields(config, migrated.config);
}

/**
 * Save config to disk as ~/.hlvm/settings.json (unified SSOT).
 */
export async function saveConfig(config: HlvmConfig): Promise<void> {
  const path = getSettingsPath();
  await fs().ensureDir(getHlvmDir());
  const content = JSON.stringify(stampCurrentConfigVersion(config), null, 2) +
    "\n";
  await atomicWriteTextFile(path, content);
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
  const config = stampCurrentConfigVersion({ ...DEFAULT_CONFIG });
  await saveConfig(config);
  return config;
}
