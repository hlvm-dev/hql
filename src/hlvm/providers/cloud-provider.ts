/**
 * Cloud Provider Factory
 *
 * Eliminates class duplication across OpenAI, Anthropic, Google, and Claude Code providers.
 * Each provider declares a thin spec; the factory produces a full AIProvider from it.
 */

import type {
  AIProvider,
  ChatOptions,
  GenerateOptions,
  Message,
  ModelInfo,
  ProviderCapability,
  ProviderConfig,
  ProviderStatus,
} from "./types.ts";
import { getPlatform } from "../../platform/platform.ts";
import { RuntimeError } from "../../common/error.ts";
import { fetchPublicModelsForProvider } from "./public-catalog.ts";
import {
  assertSupportedSdkProvider,
  chatStructuredWithSdk,
  chatWithSdk,
  generateWithSdk,
  type SdkModelSpec,
} from "./sdk-runtime.ts";

/** API surface each provider's api.ts must expose (adapted via createApi). */
export interface CloudProviderApi {
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
  /** Allow fallback to OpenRouter public catalog when live provider listing is unavailable. */
  allowPublicCatalogFallback?: boolean;
  /** Provider-level capabilities (defaults to chat+tools+vision+models.list if omitted). */
  capabilities?: ProviderCapability[];
  /** Create the API adapter. For API-key providers, captures apiKey in closures. */
  createApi(apiKey: string): CloudProviderApi;
  /** Transform model name before API calls (e.g. strip :agent suffix). */
  transformModel?(model: string): string;
  /** Transform model list after fetching (e.g. expand with agent variants). */
  transformModels?(models: ModelInfo[]): ModelInfo[];
}

/** Build a ProviderFactory from a declarative spec. */
/** Factory returned by createCloudProvider — carries spec capabilities for registration. */
export interface CloudProviderFactory {
  (config?: ProviderConfig): AIProvider;
  specCapabilities?: ProviderCapability[];
}

export function createCloudProvider(
  spec: CloudProviderSpec,
): CloudProviderFactory {
  const factory = (config?: ProviderConfig): AIProvider => {
    const endpoint = config?.endpoint ?? spec.defaultEndpoint;
    const configuredModel = config?.defaultModel;
    const apiKey = config?.apiKey ??
      (spec.envVarName ? getPlatform().env.get(spec.envVarName) ?? "" : "");
    const apiKeyConfigured = spec.envVarName ? apiKey.length > 0 : true;
    const api = spec.createApi(apiKey);
    const sdkProviderName = assertSupportedSdkProvider(spec.name);

    let resolvedDefault: string | undefined;

    const models = {
      list: async (): Promise<ModelInfo[]> => {
        if (apiKeyConfigured) {
          const live = await api.listModels(endpoint);
          if (live.length > 0) {
            return spec.transformModels ? spec.transformModels(live) : live;
          }
        }
        if (spec.allowPublicCatalogFallback === false) {
          return [];
        }
        const pub = await fetchPublicModelsForProvider(
          spec.publicCatalogProvider,
        );
        return spec.transformModels ? spec.transformModels(pub) : pub;
      },
      get: async (name: string): Promise<ModelInfo | null> => {
        const list = await models.list();
        return list.find((m) => m.name === name) ?? null;
      },
    };

    async function getModel(options?: GenerateOptions): Promise<string> {
      const model = options?.model ?? configuredModel ?? resolvedDefault;
      if (model) {
        return spec.transformModel ? spec.transformModel(model) : model;
      }
      const list = await models.list();
      if (list.length === 0) {
        throw new RuntimeError(spec.noModelsError);
      }
      resolvedDefault = list[0].name;
      return spec.transformModel
        ? spec.transformModel(resolvedDefault)
        : resolvedDefault;
    }

    function buildSpec(modelId: string): SdkModelSpec {
      return {
        providerName: sdkProviderName,
        modelId,
        endpoint,
        apiKey: apiKeyConfigured ? apiKey : undefined,
      };
    }

    return {
      name: spec.name,
      displayName: spec.displayName,
      apiKeyConfigured,
      capabilities: spec.capabilities ?? [
        "chat",
        "tools",
        "vision",
        "models.list",
      ] as ProviderCapability[],

      async *generate(prompt: string, options?: GenerateOptions) {
        const model = await getModel(options);
        yield* generateWithSdk(
          buildSpec(model),
          prompt,
          options,
          options?.signal,
        );
      },

      async *chat(messages: Message[], options?: ChatOptions) {
        const model = await getModel(options);
        yield* chatWithSdk(
          buildSpec(model),
          messages,
          options,
          options?.signal,
        );
      },

      async chatStructured(messages: Message[], options?: ChatOptions) {
        const model = await getModel(options);
        return chatStructuredWithSdk(
          buildSpec(model),
          messages,
          options,
          options?.signal,
        );
      },

      models,

      status(): Promise<ProviderStatus> {
        return api.checkStatus(endpoint);
      },
    };
  };

  // Attach spec capabilities so registration can access them without instantiation
  factory.specCapabilities = spec.capabilities;
  return factory as CloudProviderFactory;
}
