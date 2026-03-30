/**
 * Google Provider — thin spec over shared cloud-provider factory.
 */

import { createCloudProvider } from "../cloud-provider.ts";
import * as api from "./api.ts";

export const createGoogleProvider = createCloudProvider({
  name: "google",
  displayName: "Google",
  defaultEndpoint: "https://generativelanguage.googleapis.com",
  envVarName: "GOOGLE_API_KEY",
  noModelsError: "No Google models available. Check your API key or network.",
  publicCatalogProvider: "google",
  capabilities: [
    "chat", "tools", "vision", "models.list",
    "hosted.webSearch", "hosted.codeExecution", "media.audioInput",
    "structured.output", "citations.grounding",
  ],
  createApi: (apiKey) => ({
    listModels: (ep) => api.listModels(ep, apiKey),
    checkStatus: (ep) => api.checkStatus(ep, apiKey),
  }),
});
