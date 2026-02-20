/**
 * OpenAI Provider — thin spec over shared cloud-provider factory.
 */

import { createCloudProvider } from "../cloud-provider.ts";
import * as api from "./api.ts";

export const createOpenAIProvider = createCloudProvider({
  name: "openai",
  displayName: "OpenAI",
  defaultEndpoint: "https://api.openai.com",
  envVarName: "OPENAI_API_KEY",
  noModelsError: "No OpenAI models available. Check your API key or network.",
  publicCatalogProvider: "openai",
  createApi: (apiKey) => ({
    chatStructured: (ep, model, msgs, opts, sig) => api.chatStructured(ep, model, msgs, apiKey, opts, sig),
    listModels: (ep) => api.listModels(ep, apiKey),
    checkStatus: (ep) => api.checkStatus(ep, apiKey),
  }),
});
