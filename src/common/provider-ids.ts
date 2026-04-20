export const PROVIDER_IDS = Object.freeze({
  OLLAMA: "ollama",
  OPENAI: "openai",
  ANTHROPIC: "anthropic",
  GOOGLE: "google",
  CLAUDE_CODE: "claude-code",
} as const);

export type ProviderId = typeof PROVIDER_IDS[keyof typeof PROVIDER_IDS];

export const PROVIDER_ID_VALUES: readonly ProviderId[] = Object.freeze(
  Object.values(PROVIDER_IDS),
);

export function isProviderId(value: unknown): value is ProviderId {
  return typeof value === "string" &&
    (PROVIDER_ID_VALUES as readonly string[]).includes(value);
}
