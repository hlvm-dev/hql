/**
 * Anthropic Provider — thin spec over shared cloud-provider factory.
 */

import { createCloudProvider } from "../cloud-provider.ts";
import * as api from "./api.ts";

export const createAnthropicProvider = createCloudProvider({
  name: "anthropic",
  displayName: "Anthropic",
  defaultEndpoint: "https://api.anthropic.com",
  envVarName: "ANTHROPIC_API_KEY",
  noModelsError: "No Anthropic models available. Check your API key or network.",
  publicCatalogProvider: "anthropic",
  capabilities: [
    "chat", "tools", "vision", "models.list",
    "hosted.webSearch", "hosted.codeExecution", "hosted.computerUse",
    "structured.output", "citations.grounding",
  ],
  createApi: (apiKey) => ({
    listModels: (ep) => api.listModels(ep, apiKey),
    checkStatus: (ep) => api.checkStatus(ep, apiKey),
  }),
});
