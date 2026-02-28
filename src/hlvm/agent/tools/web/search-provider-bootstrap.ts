/**
 * Provider bootstrap for search providers.
 *
 * Kept separate from search-provider.ts to avoid import cycles:
 * - registry/types live in search-provider.ts
 * - adapters import registry from search-provider.ts
 * - bootstrap imports adapters and registers them once
 */

import { registerDuckDuckGo } from "./duckduckgo.ts";

let initialized = false;

export function initSearchProviders(): void {
  if (initialized) return;
  initialized = true;
  registerDuckDuckGo();
}

export function resetSearchProviderBootstrap(): void {
  initialized = false;
}
