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

const NON_ALPHANUM_RE = /[^a-z0-9]+/g;

function normalizeProviderLookup(value: string): string {
  return value.toLowerCase().replace(NON_ALPHANUM_RE, "");
}

/** Pre-computed reverse lookup: normalized term → provider key. O(1) per call. */
const PROVIDER_LOOKUP: Map<string, string> = (() => {
  const map = new Map<string, string>();
  for (const [key, meta] of Object.entries(PROVIDER_META)) {
    map.set(normalizeProviderLookup(key), key);
    for (const term of meta.searchTerms ?? []) {
      const normalized = normalizeProviderLookup(term);
      // First registration wins (earlier keys have priority)
      if (!map.has(normalized)) map.set(normalized, key);
    }
  }
  return map;
})();

export function findProviderMetaKey(name?: string | null): string | null {
  const normalized = name ? normalizeProviderLookup(name) : "";
  if (!normalized) return null;
  return PROVIDER_LOOKUP.get(normalized) ?? null;
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
