/**
 * Web tool configuration loader.
 *
 * Delegates to common config resolver SSOT.
 */

import { config as configApi } from "../api/config.ts";
import {
  type ResolvedWebFetchConfig,
  type ResolvedWebSearchConfig,
  resolveWebConfig,
} from "../../common/config/web-resolver.ts";

export type { ResolvedWebFetchConfig, ResolvedWebSearchConfig };

export async function loadWebConfig(): Promise<{
  search: ResolvedWebSearchConfig;
  fetch: ResolvedWebFetchConfig;
}> {
  const current = await configApi.all;
  return resolveWebConfig(current.tools?.web);
}
