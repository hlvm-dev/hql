/**
 * HLVM Config Types
 * Configuration interface, defaults, and validation
 */

import { THEME_NAMES } from "../../hlvm/cli/theme/palettes.ts";

// ============================================================
// Model Defaults
// ============================================================

export const DEFAULT_MODEL_ID = "ollama/llama3.1:8b";
export const DEFAULT_MODEL_PROVIDER = DEFAULT_MODEL_ID.split("/")[0];
export const DEFAULT_MODEL_NAME = DEFAULT_MODEL_ID.split("/")[1];
export const DEFAULT_OLLAMA_ENDPOINT = "http://localhost:11434";

/**
 * Normalize a model ID to provider/model format.
 * Defaults to the provider from DEFAULT_MODEL_ID when missing.
 */
export function normalizeModelId(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  if (trimmed.includes("/")) return trimmed;
  return `${DEFAULT_MODEL_PROVIDER}/${trimmed}`;
}

// ============================================================
// Config Interface
// ============================================================

/** Agent mode for Claude models: HLVM-orchestrated or Claude Code full agent passthrough */
export type AgentMode = "hlvm" | "claude-code-agent";

/** User-customized keybindings (action ID -> key combo) */
export type KeybindingsConfig = Record<string, string>;

export interface WebSearchConfig {
  enabled?: boolean;
  provider?: "duckduckgo";
  maxResults?: number;
  timeoutSeconds?: number;
  cacheTtlMinutes?: number;
}

export interface WebFetchFirecrawlConfig {
  enabled?: boolean;
  apiKey?: string;
  baseUrl?: string;
  onlyMainContent?: boolean;
  maxAgeMs?: number;
  timeoutSeconds?: number;
}

export interface WebFetchConfig {
  enabled?: boolean;
  maxChars?: number;
  timeoutSeconds?: number;
  cacheTtlMinutes?: number;
  maxRedirects?: number;
  userAgent?: string;
  readability?: boolean;
  firecrawl?: WebFetchFirecrawlConfig;
}

export interface ToolsConfig {
  web?: {
    search?: WebSearchConfig;
    fetch?: WebFetchConfig;
  };
}

export interface HlvmConfig {
  version: number;
  model: string; // "provider/model" format (e.g., "ollama/llama3.2"). Models with ":agent" suffix use Claude Code full agent mode.
  endpoint: string; // API endpoint URL
  temperature: number; // 0.0-2.0
  maxTokens: number; // Max response tokens
  theme: string; // UI theme
  keybindings?: KeybindingsConfig; // Custom keybindings (optional)
  tools?: ToolsConfig; // Tool-specific configuration (optional)
  modelConfigured?: boolean; // true after first explicit model selection
  approvedProviders?: string[]; // Providers the user has consented to (e.g., ["openai", "anthropic"])
  agentMode?: AgentMode; // Agent mode for Claude models: "hlvm" (HLVM orchestrates) or "claude-code-agent" (full passthrough)
}

// ============================================================
// Defaults
// ============================================================

export const DEFAULT_WEB_SEARCH_CONFIG: WebSearchConfig = {
  enabled: true,
  provider: "duckduckgo",
  maxResults: 5,
  timeoutSeconds: 30,
  cacheTtlMinutes: 15,
};

export const DEFAULT_WEB_FETCH_CONFIG: WebFetchConfig = {
  enabled: true,
  maxChars: 50000,
  timeoutSeconds: 30,
  cacheTtlMinutes: 15,
  maxRedirects: 3,
  userAgent:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_4) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
  readability: true,
  firecrawl: {
    enabled: false,
    apiKey: "",
    baseUrl: "https://api.firecrawl.dev",
    onlyMainContent: true,
    maxAgeMs: 900000,
    timeoutSeconds: 30,
  },
};

export function createDefaultWebSearchConfig(): WebSearchConfig {
  return {
    ...DEFAULT_WEB_SEARCH_CONFIG,
  };
}

export function createDefaultWebFetchConfig(): WebFetchConfig {
  return {
    ...DEFAULT_WEB_FETCH_CONFIG,
    firecrawl: { ...DEFAULT_WEB_FETCH_CONFIG.firecrawl },
  };
}

export function createDefaultToolsConfig(): ToolsConfig {
  return {
    web: {
      search: createDefaultWebSearchConfig(),
      fetch: createDefaultWebFetchConfig(),
    },
  };
}

export const DEFAULT_CONFIG: HlvmConfig = {
  version: 1,
  model: DEFAULT_MODEL_ID,
  endpoint: DEFAULT_OLLAMA_ENDPOINT,
  temperature: 0.7,
  maxTokens: 4096,
  theme: "sicp",
  tools: createDefaultToolsConfig(),
};

// ============================================================
// Config Keys
// ============================================================

export const CONFIG_KEYS = [
  "model",
  "endpoint",
  "temperature",
  "maxTokens",
  "theme",
  "tools",
  "modelConfigured",
  "approvedProviders",
  "agentMode",
] as const;
export type ConfigKey = typeof CONFIG_KEYS[number];

// ============================================================
// Validation
// ============================================================

// Model format: provider/model[:tag] - allows colons for Ollama tags like "llama3.2:latest"
const MODEL_FORMAT_REGEX = /^[a-zA-Z0-9_-]+\/[a-zA-Z0-9_.:-]+$/;
// URL must have protocol + host (at least localhost or IP)
const URL_REGEX = /^https?:\/\/[a-zA-Z0-9][-a-zA-Z0-9.]*(?::\d+)?(?:\/.*)?$/;

export interface ValidationResult {
  valid: boolean;
  error?: string;
}

/**
 * Validate a config value for a given key
 */
export function validateValue(
  key: ConfigKey,
  value: unknown,
): ValidationResult {
  switch (key) {
    case "model":
      if (typeof value !== "string") {
        return { valid: false, error: "model must be a string" };
      }
      if (!MODEL_FORMAT_REGEX.test(value)) {
        return {
          valid: false,
          error:
            "model must be in 'provider/model' format (e.g., ollama/llama3.2)",
        };
      }
      return { valid: true };

    case "endpoint":
      if (typeof value !== "string") {
        return { valid: false, error: "endpoint must be a string" };
      }
      if (!URL_REGEX.test(value)) {
        return {
          valid: false,
          error: "endpoint must be a valid URL (http:// or https://)",
        };
      }
      return { valid: true };

    case "temperature":
      if (typeof value !== "number" || Number.isNaN(value)) {
        return { valid: false, error: "temperature must be a number" };
      }
      if (value < 0 || value > 2) {
        return {
          valid: false,
          error: "temperature must be between 0.0 and 2.0",
        };
      }
      return { valid: true };

    case "maxTokens":
      if (typeof value !== "number" || Number.isNaN(value)) {
        return { valid: false, error: "maxTokens must be a number" };
      }
      if (!Number.isInteger(value) || value <= 0) {
        return { valid: false, error: "maxTokens must be a positive integer" };
      }
      // Reasonable upper bound (most models support up to 128K, 1M is generous)
      if (value > 1000000) {
        return { valid: false, error: "maxTokens must be at most 1,000,000" };
      }
      return { valid: true };

    case "theme":
      if (typeof value !== "string") {
        return { valid: false, error: "theme must be a string" };
      }
      if (!THEME_NAMES.includes(value as typeof THEME_NAMES[number])) {
        return {
          valid: false,
          error: `theme must be one of: ${THEME_NAMES.join(", ")}`,
        };
      }
      return { valid: true };
    case "tools":
      if (typeof value !== "object" || value === null || Array.isArray(value)) {
        return { valid: false, error: "tools must be an object" };
      }
      return { valid: true };
    case "modelConfigured":
      if (value === undefined) return { valid: true }; // optional field
      if (typeof value !== "boolean") {
        return { valid: false, error: "modelConfigured must be a boolean" };
      }
      return { valid: true };

    case "approvedProviders":
      if (value === undefined) return { valid: true }; // optional field
      if (!Array.isArray(value) || !value.every((v) => typeof v === "string")) {
        return { valid: false, error: "approvedProviders must be an array of strings" };
      }
      return { valid: true };

    case "agentMode":
      if (value === undefined) return { valid: true }; // optional field
      if (value !== "hlvm" && value !== "claude-code-agent") {
        return { valid: false, error: "agentMode must be 'hlvm' or 'claude-code-agent'" };
      }
      return { valid: true };

    default:
      return { valid: false, error: `Unknown config key: ${key}` };
  }
}

/**
 * Parse a string value into the appropriate type for a config key
 */
export function parseValue(key: ConfigKey, valueStr: string): unknown {
  switch (key) {
    case "temperature":
      return parseFloat(valueStr);
    case "maxTokens":
      return parseInt(valueStr, 10);
    default:
      return valueStr;
  }
}
