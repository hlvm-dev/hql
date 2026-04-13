/**
 * OpenAI Provider — thin spec over shared cloud-provider factory.
 */

import { createCloudProvider } from "../cloud-provider.ts";
import { DEFAULT_OPENAI_ENDPOINT } from "../../../common/config/types.ts";
import * as api from "./api.ts";

export const createOpenAIProvider = createCloudProvider({
  name: "openai",
  displayName: "OpenAI",
  defaultEndpoint: DEFAULT_OPENAI_ENDPOINT,
  envVarName: "OPENAI_API_KEY",
  noModelsError: "No OpenAI models available. Check your API key or network.",
  publicCatalogProvider: "openai",
  capabilities: [
    "chat", "tools", "vision", "models.list",
    "hosted.webSearch", "structured.output",
  ],
  createApi: (apiKey) => ({
    listModels: (ep) => api.listModels(ep, apiKey),
    checkStatus: (ep) => api.checkStatus(ep, apiKey),
  }),
});
