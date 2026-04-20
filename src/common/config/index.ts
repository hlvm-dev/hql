/**
 * HLVM Config Module - Public Exports
 */

// Re-export types
export {
  type HlvmConfig,
  type ConfigKey,
  type KeybindingsConfig,
  type ChannelConfig,
  type ChannelTransportConfig,
  type ChannelsConfig,
  type ValidationResult,
  CHANNEL_TRANSPORT_MODES,
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

// Use initializeRuntime() from common/runtime-initializer.ts instead
