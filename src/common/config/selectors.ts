import { DEFAULT_CONFIG, DEFAULT_MODEL_ID, PERMISSION_MODES, type PermissionMode } from "./types.ts";
import { normalizeSelectedModelId } from "./model-selection.ts";
import { isObjectValue } from "../utils.ts";

export function getConfiguredModel(config: unknown): string {
  const rawModel = isObjectValue(config) ? config.model : undefined;
  const rawAgentMode = isObjectValue(config) &&
      (config.agentMode === "hlvm" || config.agentMode === "claude-code-agent")
    ? config.agentMode
    : undefined;
  return normalizeSelectedModelId(rawModel, rawAgentMode) ?? DEFAULT_MODEL_ID;
}

export function getContextWindow(config: unknown): number | undefined {
  const rawContextWindow = isObjectValue(config)
    ? config.contextWindow
    : undefined;
  return typeof rawContextWindow === "number" &&
      Number.isInteger(rawContextWindow) && rawContextWindow > 0
    ? rawContextWindow
    : undefined;
}

export function getPermissionMode(config: unknown): PermissionMode | undefined {
  const raw = isObjectValue(config) ? config.permissionMode : undefined;
  return typeof raw === "string" && PERMISSION_MODES.includes(raw as PermissionMode)
    ? (raw as PermissionMode)
    : undefined;
}

export function getApprovedProviders(config: unknown): string[] {
  const rawApprovedProviders = isObjectValue(config)
    ? config.approvedProviders
    : undefined;
  return Array.isArray(rawApprovedProviders)
    ? rawApprovedProviders.filter((provider): provider is string =>
      typeof provider === "string"
    )
    : [];
}

export function getTheme(config: unknown): string {
  const rawTheme = isObjectValue(config) ? config.theme : undefined;
  return typeof rawTheme === "string" && rawTheme.length > 0
    ? rawTheme
    : DEFAULT_CONFIG.theme;
}

export function getAgentMaxThreads(config: unknown): number {
  const raw = isObjectValue(config) ? config.agentMaxThreads : undefined;
  return typeof raw === "number" && Number.isInteger(raw) && raw >= 1 && raw <= 16
    ? raw
    : 4;
}

export function getAgentMaxDepth(config: unknown): number {
  const raw = isObjectValue(config) ? config.agentMaxDepth : undefined;
  return typeof raw === "number" && Number.isInteger(raw) && raw >= 1 && raw <= 3
    ? raw
    : 1;
}
