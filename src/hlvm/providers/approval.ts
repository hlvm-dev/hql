import { config } from "../api/config.ts";
import { parseModelString } from "./index.ts";

const PAID_PROVIDERS = new Set(["openai", "anthropic", "google"]);

const PROVIDER_LABELS: Record<string, string> = {
  openai: "OpenAI",
  anthropic: "Anthropic",
  google: "Google",
};

/** Extract provider prefix from a model ID like "openai/gpt-4o". */
export function extractProvider(modelId: string): string | null {
  const [provider] = parseModelString(modelId);
  return provider;
}

/** Check if a model ID uses a paid provider. */
export function isPaidProvider(modelId: string): boolean {
  const provider = extractProvider(modelId);
  return provider !== null && PAID_PROVIDERS.has(provider);
}

/** Check if the user has already approved a provider. */
export function isProviderApproved(modelId: string): boolean {
  const provider = extractProvider(modelId);
  if (!provider) return true;
  const approved = config.snapshot.approvedProviders ?? [];
  return approved.includes(provider);
}

/** Return the user-facing provider label for approval messaging. */
export function getProviderApprovalLabel(modelId: string): string | null {
  const provider = extractProvider(modelId);
  if (!provider) return null;
  return PROVIDER_LABELS[provider] ?? provider;
}
