import type { SearchResult } from "./search-provider.ts";

export function resultHost(url?: string): string | undefined {
  if (!url) return undefined;
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return undefined;
  }
}

export function hasStructuredEvidence(result: SearchResult): boolean {
  return Boolean(
    (result.passages?.length ?? 0) > 0 ||
      result.pageDescription ||
      result.publishedDate,
  );
}
