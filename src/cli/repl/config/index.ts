/**
 * HQL REPL Config Command Handler
 * Re-exports from common/config and provides /config command
 */

// Re-export everything from common/config
export * from "../../../common/config/index.ts";

import { ANSI_COLORS } from "../../ansi.ts";
import {
  type ConfigKey,
  type HqlConfig,
  CONFIG_KEYS,
  DEFAULT_CONFIG,
  parseValue,
  validateValue,
  getConfigPath,
  loadConfig,
  getConfigValue,
  isConfigKey,
  initConfigRuntime,
  updateConfigRuntime,
  resetConfigRuntime,
} from "../../../common/config/index.ts";

const { CYAN, GREEN, YELLOW, DIM_GRAY, RESET, BOLD } = ANSI_COLORS;

// ============================================================
// Command Handler
// ============================================================

/**
 * Handle /config command
 * Usage:
 *   /config                     - Show all config
 *   /config <key>               - Show single value
 *   /config <key> <value>       - Set value (shorthand, hot reload)
 *   /config set <key> <value>   - Set value (explicit, hot reload)
 *   /config reset               - Reset to defaults (hot reload)
 *   /config reload              - Reload from file (for external edits)
 *   /config path                - Show config file location
 */
export async function handleConfigCommand(args: string): Promise<void> {
  const parts = args.trim().split(/\s+/);
  const subcommand = parts[0] || "";

  // /config - show all
  if (!subcommand) {
    await showAllConfig();
    return;
  }

  // /config path - show file location
  if (subcommand === "path") {
    console.log(`${CYAN}Config file:${RESET} ${getConfigPath()}`);
    return;
  }

  // /config reset - reset to defaults (hot reload)
  if (subcommand === "reset") {
    // 100% SSOT: Use config API only - no fallback bypass
    const configApi = (globalThis as Record<string, unknown>).config as {
      reset: () => Promise<unknown>;
    } | undefined;
    if (!configApi?.reset) {
      console.log(`${YELLOW}Config API not initialized${RESET}`);
      return;
    }
    await configApi.reset();
    console.log(`${GREEN}Config reset to defaults.${RESET}`);
    return;
  }

  // /config reload - reload from file (for external edits)
  if (subcommand === "reload") {
    // 100% SSOT: Use config API only - no fallback bypass
    const configApi = (globalThis as Record<string, unknown>).config as {
      reload: () => Promise<unknown>;
    } | undefined;
    if (!configApi?.reload) {
      console.log(`${YELLOW}Config API not initialized${RESET}`);
      return;
    }
    await configApi.reload();
    console.log(`${GREEN}Config reloaded from file.${RESET}`);
    return;
  }

  // /config set <key> <value> - explicit set
  if (subcommand === "set") {
    const key = parts[1];
    const value = parts.slice(2).join(" ");

    if (!key || !value) {
      console.log(`${YELLOW}Usage: /config set <key> <value>${RESET}`);
      console.log(`${DIM_GRAY}Keys: ${CONFIG_KEYS.join(", ")}${RESET}`);
      return;
    }

    await setConfigByKey(key, value);
    return;
  }

  // /config <key> - show single value OR /config <key> <value> - shorthand set
  if (isConfigKey(subcommand)) {
    const key = subcommand;
    const value = parts.slice(1).join(" ");

    if (value) {
      // Shorthand: /config model ollama/mistral
      await setConfigByKey(key, value);
    } else {
      // Show single value: /config model
      await showSingleConfig(key);
    }
    return;
  }

  // Unknown subcommand
  console.log(`${YELLOW}Unknown config command: ${subcommand}${RESET}`);
  showConfigHelp();
}

// ============================================================
// Helper Functions
// ============================================================

async function showAllConfig(): Promise<void> {
  // 100% SSOT: Use config API only - no direct loadConfig() bypass
  const configApi = (globalThis as Record<string, unknown>).config as {
    all: Promise<HqlConfig>;
  } | undefined;

  if (!configApi?.all) {
    console.log(`${YELLOW}Config API not initialized${RESET}`);
    return;
  }

  const config = await configApi.all;

  console.log(`${BOLD}Configuration:${RESET}`);
  for (const key of CONFIG_KEYS) {
    const value = getConfigValue(config, key);
    const defaultValue = DEFAULT_CONFIG[key as keyof typeof DEFAULT_CONFIG];
    const isDefault = value === defaultValue;
    const suffix = isDefault ? ` ${DIM_GRAY}(default)${RESET}` : "";
    console.log(`  ${CYAN}${key}${RESET}: ${formatValue(value)}${suffix}`);
  }
  console.log(`\n${DIM_GRAY}File: ${getConfigPath()}${RESET}`);
}

async function showSingleConfig(key: ConfigKey): Promise<void> {
  // 100% SSOT: Use config API only - no direct loadConfig() bypass
  const configApi = (globalThis as Record<string, unknown>).config as {
    all: Promise<HqlConfig>;
  } | undefined;

  if (!configApi?.all) {
    console.log(`${YELLOW}Config API not initialized${RESET}`);
    return;
  }

  const config = await configApi.all;
  const value = getConfigValue(config, key);
  console.log(`${CYAN}${key}${RESET}: ${formatValue(value)}`);
}

async function setConfigByKey(keyStr: string, valueStr: string): Promise<void> {
  if (!isConfigKey(keyStr)) {
    console.log(`${YELLOW}Unknown config key: ${keyStr}${RESET}`);
    console.log(`${DIM_GRAY}Valid keys: ${CONFIG_KEYS.join(", ")}${RESET}`);
    return;
  }

  const key = keyStr as ConfigKey;
  const parsedValue = parseValue(key, valueStr);

  // Validate before setting
  const validation = validateValue(key, parsedValue);
  if (!validation.valid) {
    console.log(`${YELLOW}${validation.error}${RESET}`);
    return;
  }

  // 100% SSOT: Use config API only - no fallback bypass
  const configApi = (globalThis as Record<string, unknown>).config as {
    set: (key: string, value: unknown) => Promise<unknown>;
  } | undefined;

  if (!configApi?.set) {
    console.log(`${YELLOW}Config API not initialized${RESET}`);
    return;
  }

  await configApi.set(key, parsedValue);
  console.log(`${GREEN}Set ${key} = ${formatValue(parsedValue)}${RESET}`);
}

function formatValue(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  return String(value);
}

function showConfigHelp(): void {
  console.log(`${BOLD}Usage:${RESET}`);
  console.log(`  ${CYAN}/config${RESET}                     Show all settings`);
  console.log(`  ${CYAN}/config <key>${RESET}               Show single value`);
  console.log(`  ${CYAN}/config <key> <value>${RESET}       Set value`);
  console.log(`  ${CYAN}/config reset${RESET}               Reset to defaults`);
  console.log(`  ${CYAN}/config reload${RESET}              Reload from file`);
  console.log(`  ${CYAN}/config path${RESET}                Show config file location`);
  console.log(`\n${DIM_GRAY}Keys: ${CONFIG_KEYS.join(", ")}${RESET}`);
}
