/**
 * HLVM Config Module - Public Exports
 */

// Re-export types
export {
  type HlvmConfig,
  type ConfigKey,
  type KeybindingsConfig,
  type ValidationResult,
  DEFAULT_CONFIG,
  CONFIG_KEYS,
  validateValue,
  parseValue,
} from "./types.ts";

// Re-export storage
export {
  getHlvmDir,
  getConfigPath,
  loadConfig,
  saveConfig,
  getConfigValue,
  isConfigKey,
  resetConfig,
} from "./storage.ts";

// Note: initConfigRuntime is internal to runtime-initializer.ts (SSOT)
// Use initializeRuntime() from common/runtime-initializer.ts instead
