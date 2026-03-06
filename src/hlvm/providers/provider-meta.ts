/**
 * Shared provider metadata (SSOT).
 *
 * Centralizes provider-facing docs, subtitles, and search aliases so UI/API
 * code does not drift on provider naming behavior.
 */

export interface ProviderMeta {
  subtitle?: string;
  docsUrl?: string;
  searchTerms?: readonly string[];
}

const PROVIDER_META: Record<string, ProviderMeta> = {
  ollama: {
    subtitle: "Local models",
    docsUrl: "https://ollama.com/library",
    searchTerms: ["ollama", "local", "local model", "local models"],
  },
  anthropic: {
    subtitle: "Claude AI models",
    docsUrl: "https://docs.anthropic.com/en/docs/about-claude/models",
    searchTerms: [
      "anthropic",
      "anthropic ai",
      "claude",
      "antrophic",
    ],
  },
  openai: {
    subtitle: "GPT models",
    docsUrl: "https://platform.openai.com/docs/models",
    searchTerms: [
      "openai",
      "open ai",
      "gpt",
      "chatgpt",
      "chat gpt",
    ],
  },
  google: {
    subtitle: "Gemini models",
    docsUrl: "https://ai.google.dev/gemini-api/docs/models",
    searchTerms: ["google", "google ai", "gemini"],
  },
  "claude-code": {
    subtitle: "Claude AI models (Max)",
    docsUrl: "https://docs.anthropic.com/en/docs/about-claude/models",
    searchTerms: [
      "claude-code",
      "claude code",
      "claude",
      "anthropic",
      "max",
      "claude max",
    ],
  },
};

function normalizeProviderLookup(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

export function findProviderMetaKey(name?: string | null): string | null {
  const normalized = name ? normalizeProviderLookup(name) : "";
  if (!normalized) return null;

  for (const [key, meta] of Object.entries(PROVIDER_META)) {
    if (normalizeProviderLookup(key) === normalized) {
      return key;
    }
    if (
      meta.searchTerms?.some((term) =>
        normalizeProviderLookup(term) === normalized
      )
    ) {
      return key;
    }
  }

  return null;
}

export function getProviderMeta(name?: string | null): ProviderMeta | null {
  const key = findProviderMetaKey(name);
  return key ? PROVIDER_META[key] ?? null : null;
}

export function getProviderSearchTerms(
  name?: string | null,
): readonly string[] {
  const key = findProviderMetaKey(name);
  if (!key) return [];

  const meta = PROVIDER_META[key];
  return [...new Set([key, ...(meta?.searchTerms ?? [])])];
}
