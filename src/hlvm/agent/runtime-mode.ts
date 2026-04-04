export const RUNTIME_MODES = ["manual", "auto"] as const;

export type RuntimeMode = (typeof RUNTIME_MODES)[number];

export const DEFAULT_RUNTIME_MODE: RuntimeMode = "manual";

export function normalizeRuntimeMode(value: unknown): RuntimeMode | undefined {
  return value === "manual" || value === "auto" ? value : undefined;
}

export function resolveRuntimeMode(value: unknown): RuntimeMode {
  return normalizeRuntimeMode(value) ?? DEFAULT_RUNTIME_MODE;
}

export function getRuntimeModeFooterLabel(mode: RuntimeMode): string {
  return `runtime:${mode}`;
}

export function getRuntimeModeStatusLabel(mode: RuntimeMode): string {
  return mode;
}
