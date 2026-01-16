/**
 * Ollama Model Catalog
 *
 * Offline catalog used for discovery (no network calls).
 */

import ollamaModelsData from "../../../data/ollama_models.json" with { type: "json" };
import type { ModelInfo, ProviderCapability } from "../types.ts";

interface ScrapedModelVariant {
  id: string;
  name: string;
  parameters: string;
  size: string;
  context: string;
  vision: boolean;
}

interface ScrapedModel {
  id: string;
  name: string;
  description: string;
  variants: ScrapedModelVariant[];
  vision: boolean;
  downloads: number;
  model_type?: string;
  ollamaUrl?: string;
}

interface ScrapedCatalog {
  models: ScrapedModel[];
}

const MAX_VARIANTS = 3;
let cachedCatalog: ModelInfo[] | null = null;

function buildCapabilityTags(model: ScrapedModel): string[] {
  const tags: string[] = [];

  if (model.model_type === "embedding") {
    tags.push("embedding");
  } else {
    tags.push("text");
  }

  if (model.vision) tags.push("vision");

  if (/llama3|qwen|mistral|gemma/i.test(model.id) && !model.vision && model.model_type !== "embedding") {
    tags.push("tools");
  }

  if (/r1|qwq/i.test(model.id)) {
    tags.push("thinking");
  }

  return tags;
}

function toModelInfo(model: ScrapedModel, variant?: ScrapedModelVariant): ModelInfo {
  const tags = buildCapabilityTags(model);
  const capabilities: ProviderCapability[] = [];

  if (tags.includes("embedding")) {
    capabilities.push("embeddings");
  } else {
    capabilities.push("generate", "chat");
  }

  if (tags.includes("vision")) {
    capabilities.push("vision");
  }

  const name = variant?.id ?? model.id;
  const displayParts = [model.name];
  if (variant?.parameters && variant.parameters !== "Unknown") {
    displayParts.push(variant.parameters);
  }
  const displayName = displayParts.join(" ");

  return {
    name,
    displayName,
    parameterSize: variant?.parameters !== "Unknown" ? variant?.parameters : undefined,
    capabilities,
    metadata: {
      description: model.description,
      sizes: variant?.size ? [variant.size] : undefined,
      capabilities: tags,
      context: variant?.context,
      downloads: model.downloads,
      modelId: model.id,
      modelName: model.name,
      url: model.ollamaUrl,
    },
  };
}

function buildCatalog(): ModelInfo[] {
  const data = ollamaModelsData as ScrapedCatalog;
  const result: ModelInfo[] = [];

  for (const model of data.models || []) {
    const variants = model.variants || [];
    if (variants.length > 0) {
      for (const variant of variants.slice(0, MAX_VARIANTS)) {
        result.push(toModelInfo(model, variant));
      }
    } else {
      result.push(toModelInfo(model));
    }
  }

  return result;
}

export function getOllamaCatalog(): ModelInfo[] {
  if (!cachedCatalog) {
    cachedCatalog = buildCatalog();
  }
  return cachedCatalog;
}

export function searchOllamaCatalog(query: string): ModelInfo[] {
  const q = query.trim().toLowerCase();
  if (!q) return getOllamaCatalog();

  return getOllamaCatalog().filter((model) => {
    const meta = (model.metadata || {}) as Record<string, unknown>;
    const capabilities = Array.isArray(meta.capabilities) ? meta.capabilities.join(" ") : "";
    const haystack = [
      model.name,
      model.displayName ?? "",
      typeof meta.description === "string" ? meta.description : "",
      typeof meta.modelName === "string" ? meta.modelName : "",
      typeof meta.modelId === "string" ? meta.modelId : "",
      capabilities,
    ].join(" ").toLowerCase();

    return haystack.includes(q);
  });
}
