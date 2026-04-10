import { DEFAULT_CONFIG, DEFAULT_MODEL_ID, PERMISSION_MODES_SET, type PermissionMode } from "./types.ts";
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
  return typeof raw === "string" && PERMISSION_MODES_SET.has(raw)
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

export function getChatMaxPromptChars(config: unknown): number {
  const raw = isObjectValue(config) ? config.chatMaxPromptChars : undefined;
  return typeof raw === "number" && Number.isInteger(raw) && raw >= 100 && raw <= 1000000
    ? raw
    : 10000;
}

export function getChatMaxReferencesLocal(config: unknown): number {
  const raw = isObjectValue(config) ? config.chatMaxReferencesLocal : undefined;
  return typeof raw === "number" && Number.isInteger(raw) && raw >= 0 && raw <= 50
    ? raw
    : 5;
}

export function getChatMaxReferencesCloud(config: unknown): number {
  const raw = isObjectValue(config) ? config.chatMaxReferencesCloud : undefined;
  return typeof raw === "number" && Number.isInteger(raw) && raw >= 0 && raw <= 100
    ? raw
    : 20;
}
