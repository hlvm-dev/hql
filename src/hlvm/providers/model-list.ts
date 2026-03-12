import type { AIProvider, ModelInfo } from "./types.ts";
import { getProvider, listRegisteredProviders } from "./registry.ts";
import { getProviderMeta } from "./provider-meta.ts";

export interface ModelListAllOptions {
  includeProviders?: string[];
  excludeProviders?: string[];
}

function getCanonicalModelListKey(model: ModelInfo): string {
  const provider = typeof model.metadata?.provider === "string"
    ? model.metadata.provider
    : "";
  return provider ? `${provider}/${model.name}` : model.name;
}

function tagProviderModels(
  providerName: string,
  provider: AIProvider,
  models: ModelInfo[],
): ModelInfo[] {
  if (models.length === 0) {
    return models;
  }

  const isCloud = providerName !== "ollama";
  const meta = getProviderMeta(providerName);
  return models.map((model) => ({
    ...model,
    metadata: {
      ...model.metadata,
      provider: providerName,
      providerDisplayName: provider.displayName ?? providerName,
      apiKeyConfigured: provider.apiKeyConfigured,
      ...(isCloud ? { cloud: true } : {}),
      ...(meta?.subtitle ? { providerSubtitle: meta.subtitle } : {}),
      ...(meta?.docsUrl ? { providerDocsUrl: meta.docsUrl } : {}),
    },
  }));
}

export function tagModelsForProvider(
  providerName: string,
  models: ModelInfo[],
): ModelInfo[] {
  const provider = getProvider(providerName);
  if (!provider) {
    return models;
  }
  return tagProviderModels(providerName, provider, models);
}

function mergeCapabilities(
  primary?: ModelInfo["capabilities"],
  secondary?: ModelInfo["capabilities"],
): ModelInfo["capabilities"] {
  if (!primary?.length) return secondary;
  if (!secondary?.length) return primary;

  const merged = [...primary];
  for (const capability of secondary) {
    if (!merged.includes(capability)) {
      merged.push(capability);
    }
  }
  return merged;
}

function mergeMetadata(
  primary?: ModelInfo["metadata"],
  secondary?: ModelInfo["metadata"],
): ModelInfo["metadata"] {
  if (!primary) return secondary;
  if (!secondary) return primary;
  return {
    ...secondary,
    ...primary,
  };
}

function mergeModelInfo(primary: ModelInfo, secondary: ModelInfo): ModelInfo {
  return {
    name: primary.name,
    displayName: primary.displayName ?? secondary.displayName,
    size: primary.size ?? secondary.size,
    family: primary.family ?? secondary.family,
    parameterSize: primary.parameterSize ?? secondary.parameterSize,
    quantization: primary.quantization ?? secondary.quantization,
    modifiedAt: primary.modifiedAt ?? secondary.modifiedAt,
    capabilities: mergeCapabilities(
      primary.capabilities,
      secondary.capabilities,
    ),
    metadata: mergeMetadata(primary.metadata, secondary.metadata),
    contextWindow: primary.contextWindow ?? secondary.contextWindow,
  };
}

export function dedupeModelList(models: ModelInfo[]): ModelInfo[] {
  const byName = new Map<string, ModelInfo[]>();
  for (const model of models) {
    const key = getCanonicalModelListKey(model);
    const existing = byName.get(key);
    if (existing) existing.push(model);
    else byName.set(key, [model]);
  }

  const deduped: ModelInfo[] = [];
  for (const groupedModels of byName.values()) {
    const preferredModels = groupedModels.some((model) =>
        model.metadata?.apiKeyConfigured === true
      )
      ? groupedModels.filter((model) =>
        model.metadata?.apiKeyConfigured !== false
      )
      : groupedModels;
    deduped.push(preferredModels.reduce(mergeModelInfo));
  }

  return deduped;
}

export async function listAllProviderModels(
  options?: ModelListAllOptions,
): Promise<ModelInfo[]> {
  const includeProviders = options?.includeProviders;
  const excludeProviders = new Set(options?.excludeProviders ?? []);
  const providerNames = listRegisteredProviders().filter((name) =>
    (!includeProviders || includeProviders.includes(name)) &&
    !excludeProviders.has(name)
  );
  const results = await Promise.all(
    providerNames.map(async (name) => {
      try {
        const provider = getProvider(name);
        if (!provider?.models?.list) return [];
        let models: ModelInfo[] = [];

        try {
          models = await provider.models.list();
        } catch {
          // Keep empty; listing should still return whatever other providers have.
        }

        if (
          name === "ollama" &&
          models.length === 0 &&
          provider.models.catalog
        ) {
          try {
            models = await provider.models.catalog();
          } catch {
            // Keep empty; listing should still return whatever other providers have.
          }
        }

        return tagProviderModels(name, provider, models);
      } catch {
        return [];
      }
    }),
  );
  return dedupeModelList(results.flat());
}
