import { DEFAULT_CONFIG, DEFAULT_MODEL_ID, type PermissionMode } from "./types.ts";
import { isObjectValue } from "../utils.ts";

export function getConfiguredModel(config: unknown): string {
  const rawModel = isObjectValue(config) ? config.model : undefined;
  return typeof rawModel === "string" && rawModel.length > 0
    ? rawModel
    : DEFAULT_MODEL_ID;
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
  const rawPermissionMode = isObjectValue(config)
    ? config.permissionMode
    : undefined;
  return rawPermissionMode === "default" || rawPermissionMode === "auto-edit" ||
      rawPermissionMode === "yolo"
    ? rawPermissionMode
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
