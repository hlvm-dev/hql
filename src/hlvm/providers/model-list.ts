import type { AIProvider, ModelInfo } from "./types.ts";
import { getProvider, listRegisteredProviders } from "./registry.ts";
import { getProviderMeta } from "./provider-meta.ts";

export interface ModelListAllOptions {
  includeProviders?: string[];
  excludeProviders?: string[];
}

export function getCanonicalModelListKey(model: ModelInfo): string {
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
  const allModels = results.flat();

  const byName = new Map<string, ModelInfo[]>();
  for (const model of allModels) {
    const key = getCanonicalModelListKey(model);
    const existing = byName.get(key);
    if (existing) existing.push(model);
    else byName.set(key, [model]);
  }

  const deduped: ModelInfo[] = [];
  for (const models of byName.values()) {
    if (models.length <= 1) {
      deduped.push(...models);
      continue;
    }
    const hasConfigured = models.some((model) =>
      model.metadata?.apiKeyConfigured === true
    );
    if (hasConfigured) {
      for (const model of models) {
        if (model.metadata?.apiKeyConfigured !== false) deduped.push(model);
      }
    } else {
      deduped.push(...models);
    }
  }
  return deduped;
}
