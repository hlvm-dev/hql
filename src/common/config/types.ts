/**
 * HQL Config Types
 * Configuration interface, defaults, and validation
 */

import { THEME_NAMES } from "../../cli/theme/palettes.ts";

// ============================================================
// Config Interface
// ============================================================

export interface HqlConfig {
  version: number;
  model: string;           // "provider/model" format (e.g., "ollama/llama3.2")
  endpoint: string;        // API endpoint URL
  temperature: number;     // 0.0-2.0
  maxTokens: number;       // Max response tokens
  theme: string;           // UI theme
}

// ============================================================
// Defaults
// ============================================================

export const DEFAULT_CONFIG: HqlConfig = {
  version: 1,
  model: "ollama/llama3.2:latest",
  endpoint: "http://localhost:11434",
  temperature: 0.7,
  maxTokens: 4096,
  theme: "sicp",
};

// ============================================================
// Config Keys
// ============================================================

export const CONFIG_KEYS = ["model", "endpoint", "temperature", "maxTokens", "theme"] as const;
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
export function validateValue(key: ConfigKey, value: unknown): ValidationResult {
  switch (key) {
    case "model":
      if (typeof value !== "string") {
        return { valid: false, error: "model must be a string" };
      }
      if (!MODEL_FORMAT_REGEX.test(value)) {
        return { valid: false, error: "model must be in 'provider/model' format (e.g., ollama/llama3.2)" };
      }
      return { valid: true };

    case "endpoint":
      if (typeof value !== "string") {
        return { valid: false, error: "endpoint must be a string" };
      }
      if (!URL_REGEX.test(value)) {
        return { valid: false, error: "endpoint must be a valid URL (http:// or https://)" };
      }
      return { valid: true };

    case "temperature":
      if (typeof value !== "number" || Number.isNaN(value)) {
        return { valid: false, error: "temperature must be a number" };
      }
      if (value < 0 || value > 2) {
        return { valid: false, error: "temperature must be between 0.0 and 2.0" };
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
        return { valid: false, error: `theme must be one of: ${THEME_NAMES.join(", ")}` };
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
