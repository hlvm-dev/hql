export interface ModelBrowserLoadState {
  filterMode: string;
  searchQuery: string;
  currentModel?: string;
}

export interface NormalizedModelBrowserSearchState {
  query: string;
  cursor: number;
}

function getLeadingSearchPrefixLength(query: string): number {
  const match = query.match(/^\/\s*|^\s+/);
  return match?.[0]?.length ?? 0;
}

export function normalizeModelBrowserSearchQuery(query: string): string {
  const prefixLength = getLeadingSearchPrefixLength(query);
  return prefixLength > 0 ? query.slice(prefixLength) : query;
}

export function normalizeModelBrowserSearchState(
  query: string,
  cursor: number,
): NormalizedModelBrowserSearchState {
  const prefixLength = getLeadingSearchPrefixLength(query);
  if (prefixLength <= 0) {
    return { query, cursor };
  }

  return {
    query: query.slice(prefixLength),
    cursor: Math.max(0, cursor - prefixLength),
  };
}

function isConfiguredApiProviderModel(model?: string): boolean {
  return Boolean(model && model.includes("/") && !model.startsWith("ollama/"));
}

export function shouldLoadCloudModels(
  state: ModelBrowserLoadState,
): boolean {
  const normalizedQuery = normalizeModelBrowserSearchQuery(state.searchQuery)
    .trim();
  return state.filterMode === "cloud" ||
    normalizedQuery.length >= 2 ||
    isConfiguredApiProviderModel(state.currentModel);
}
