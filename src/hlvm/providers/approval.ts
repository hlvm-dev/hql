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

export type ProviderApprovalDecision =
  | {
    status: "not_required";
    provider: string | null;
    label: string | null;
  }
  | {
    status: "approved" | "approval_required";
    provider: string;
    label: string;
  };

export function evaluateProviderApproval(
  modelId: string,
  approvedProviders: readonly string[] | undefined,
): ProviderApprovalDecision {
  const provider = extractProvider(modelId);
  const label = getProviderApprovalLabel(modelId);

  if (!provider || !PAID_PROVIDERS.has(provider)) {
    return {
      status: "not_required",
      provider,
      label,
    };
  }

  return {
    status: (approvedProviders ?? []).includes(provider)
      ? "approved"
      : "approval_required",
    provider,
    label: label ?? provider,
  };
}

/** Return the user-facing provider label for approval messaging. */
function getProviderApprovalLabel(modelId: string): string | null {
  const provider = extractProvider(modelId);
  if (!provider) return null;
  return PROVIDER_LABELS[provider] ?? provider;
}
