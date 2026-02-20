/**
 * Cloud Provider Factory
 *
 * Eliminates class duplication across OpenAI, Anthropic, Google, and Claude Code providers.
 * Each provider declares a thin spec; the factory produces a full AIProvider from it.
 */

import type {
  AIProvider,
  ChatOptions,
  ChatStructuredResponse,
  GenerateOptions,
  Message,
  ModelInfo,
  ProviderCapability,
  ProviderConfig,
  ProviderStatus,
} from "./types.ts";
import { getPlatform } from "../../platform/platform.ts";
import { extractSignal, generateFromChat, chatFromStructured } from "./common.ts";
import { fetchPublicModelsForProvider } from "./public-catalog.ts";

/** API surface each provider's api.ts must expose (adapted via createApi). */
export interface CloudProviderApi {
  chatStructured(endpoint: string, model: string, messages: Message[], options?: ChatOptions, signal?: AbortSignal): Promise<ChatStructuredResponse>;
  listModels(endpoint: string): Promise<ModelInfo[]>;
  checkStatus(endpoint: string): Promise<ProviderStatus>;
}

/** Declarative spec for a cloud provider — all provider-specific logic lives here. */
export interface CloudProviderSpec {
  name: string;
  displayName: string;
  defaultEndpoint: string;
  /** Env var for API key. Omit for OAuth providers (e.g. claude-code). */
  envVarName?: string;
  noModelsError: string;
  publicCatalogProvider: string;
  /** Create the API adapter. For API-key providers, captures apiKey in closures. */
  createApi(apiKey: string): CloudProviderApi;
  /** Transform model name before API calls (e.g. strip :agent suffix). */
  transformModel?(model: string): string;
  /** Transform model list after fetching (e.g. expand with agent variants). */
  transformModels?(models: ModelInfo[]): ModelInfo[];
}

/** Build a ProviderFactory from a declarative spec. */
export function createCloudProvider(spec: CloudProviderSpec): (config?: ProviderConfig) => AIProvider {
  return (config?: ProviderConfig): AIProvider => {
    const endpoint = config?.endpoint ?? spec.defaultEndpoint;
    const configuredModel = config?.defaultModel;
    const apiKey = config?.apiKey
      ?? (spec.envVarName ? getPlatform().env.get(spec.envVarName) ?? "" : "");
    const apiKeyConfigured = spec.envVarName ? apiKey.length > 0 : true;
    const api = spec.createApi(apiKey);

    let resolvedDefault: string | undefined;

    const models = {
      list: async (): Promise<ModelInfo[]> => {
        if (apiKeyConfigured) {
          const live = await api.listModels(endpoint);
          if (live.length > 0) return spec.transformModels ? spec.transformModels(live) : live;
        }
        const pub = await fetchPublicModelsForProvider(spec.publicCatalogProvider);
        return spec.transformModels ? spec.transformModels(pub) : pub;
      },
      get: async (name: string): Promise<ModelInfo | null> => {
        const list = await models.list();
        return list.find((m) => m.name === name) ?? null;
      },
    };

    async function getModel(options?: GenerateOptions): Promise<string> {
      let model: string;
      if (options?.model) {
        model = options.model;
      } else if (configuredModel) {
        model = configuredModel;
      } else if (resolvedDefault) {
        model = resolvedDefault;
      } else {
        const list = await models.list();
        if (list.length > 0) {
          resolvedDefault = list[0].name;
          model = resolvedDefault;
        } else {
          throw new Error(spec.noModelsError);
        }
      }
      return spec.transformModel ? spec.transformModel(model) : model;
    }

    return {
      name: spec.name,
      displayName: spec.displayName,
      apiKeyConfigured,
      capabilities: ["chat", "tools", "vision", "models.list"] as ProviderCapability[],

      async *generate(prompt: string, options?: GenerateOptions) {
        const model = await getModel(options);
        yield* generateFromChat(
          (msgs, opts, signal) => api.chatStructured(endpoint, model, msgs, opts, signal),
          prompt, options,
        );
      },

      async *chat(messages: Message[], options?: ChatOptions) {
        const model = await getModel(options);
        yield* chatFromStructured(
          (msgs, opts, signal) => api.chatStructured(endpoint, model, msgs, opts, signal),
          messages, options,
        );
      },

      async chatStructured(messages: Message[], options?: ChatOptions): Promise<ChatStructuredResponse> {
        const model = await getModel(options);
        return api.chatStructured(endpoint, model, messages, options, extractSignal(options));
      },

      models,

      status(): Promise<ProviderStatus> {
        return api.checkStatus(endpoint);
      },
    };
  };
}
