/**
 * Web tool configuration loader.
 *
 * Delegates to common config resolver SSOT.
 * Accepts optional toolConfig for SDK decoupling; falls back to HLVM config API.
 */

import {
  type ResolvedWebFetchConfig,
  type ResolvedWebSearchConfig,
  resolveWebConfig,
} from "../../common/config/web-resolver.ts";
import type { WebFetchConfig, WebSearchConfig } from "../../common/config/types.ts";

/** Web tool config shape accepted by loadWebConfig */
type WebToolConfig = { search?: WebSearchConfig; fetch?: WebFetchConfig };

export async function loadWebConfig(toolConfig?: WebToolConfig): Promise<{
  search: ResolvedWebSearchConfig;
  fetch: ResolvedWebFetchConfig;
}> {
  if (toolConfig !== undefined) {
    return resolveWebConfig(toolConfig);
  }
  // Lazy import for HLVM compatibility — avoids hard coupling to ../api/config.ts
  const { config: configApi } = await import("../api/config.ts");
  const current = await configApi.all;
  return resolveWebConfig(current.tools?.web);
}
