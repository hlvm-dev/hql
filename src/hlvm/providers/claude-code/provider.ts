/**
 * Claude Code Subscription Provider — thin spec over shared cloud-provider factory.
 *
 * Uses your Claude Max subscription (via Claude Code OAuth token)
 * instead of a separate API key. Same Anthropic API, different auth.
 */

import type { ModelInfo } from "../types.ts";
import { createCloudProvider } from "../cloud-provider.ts";
import * as api from "./api.ts";

/** Suffix appended to model IDs to indicate Claude Code full agent passthrough mode */
export const AGENT_MODEL_SUFFIX = ":agent";

/** Expand a flat list of Anthropic models into plain + :agent variants */
function expandWithAgentVariants(models: ModelInfo[]): ModelInfo[] {
  return models.flatMap((m) => [
    m,
    { ...m, name: `${m.name}${AGENT_MODEL_SUFFIX}`, displayName: `${m.displayName ?? m.name} (Agent)` },
  ]);
}

export const createClaudeCodeProvider = createCloudProvider({
  name: "claude-code",
  displayName: "Claude Code (Max Subscription)",
  defaultEndpoint: "https://api.anthropic.com",
  // No envVarName — auth is via OAuth, always "configured"
  noModelsError: "No Claude Code models available. Run `claude login` to authenticate.",
  publicCatalogProvider: "anthropic",
  allowPublicCatalogFallback: false,
  createApi: (_apiKey) => ({
    listModels: (ep) => api.listModels(ep),
    checkStatus: (ep) => api.checkStatus(ep),
  }),
  transformModel: (model) =>
    model.endsWith(AGENT_MODEL_SUFFIX) ? model.slice(0, -AGENT_MODEL_SUFFIX.length) : model,
  transformModels: expandWithAgentVariants,
});
