/**
 * Ollama Model Catalog
 *
 * Offline catalog used for discovery (no network calls).
 */

import ollamaModelsData from "../../../data/ollama_models.json" with { type: "json" };
import type { ModelInfo, ProviderCapability } from "../types.ts";

interface ScrapedModelVariant {
  id: string;
  parameters: string;
  size: string;
}

interface ScrapedModel {
  id: string;
  name: string;
  description: string;
  variants: ScrapedModelVariant[];
  vision: boolean;
  model_type?: string;
  tools?: boolean;
  thinking?: boolean;
  cloud?: boolean;
}

interface ScrapedCatalog {
  models: ScrapedModel[];
}

const DEFAULT_MAX_VARIANTS = 3;
let cachedCatalog: ModelInfo[] | null = null;
let cachedFullCatalog: ModelInfo[] | null = null;

function buildCapabilityTags(model: ScrapedModel): string[] {
  const tags: string[] = [];

  if (model.model_type === "embedding") {
    tags.push("embedding");
  } else {
    tags.push("text");
  }

  if (model.vision) tags.push("vision");
  if (model.tools) tags.push("tools");
  if (model.thinking) tags.push("thinking");

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

  if (tags.includes("tools")) {
    capabilities.push("tools");
  }

  if (tags.includes("thinking")) {
    capabilities.push("thinking");
  }

  const name = variant?.id ?? model.id;
  const displayParts = [model.name];
  if (variant?.parameters && variant.parameters !== "Unknown") {
    displayParts.push(variant.parameters);
  }
  const displayName = displayParts.join(" ");

  const cloud = Boolean(model.cloud) || variant?.size === "Cloud (API only)";

  return {
    name,
    displayName,
    parameterSize: variant?.parameters !== "Unknown" ? variant?.parameters : undefined,
    capabilities,
    metadata: {
      description: model.description,
      sizes: variant?.size ? [variant.size] : undefined,
      ...(cloud ? { cloud: true } : {}),
    },
  };
}

function buildCatalog(maxVariants: number): ModelInfo[] {
  const data = ollamaModelsData as ScrapedCatalog;
  const result: ModelInfo[] = [];

  for (const model of data.models || []) {
    const variants = model.variants || [];
    const limit = Number.isFinite(maxVariants) ? Math.max(0, maxVariants) : variants.length;
    if (variants.length > 0) {
      for (const variant of variants.slice(0, limit || variants.length)) {
        result.push(toModelInfo(model, variant));
      }
    } else {
      result.push(toModelInfo(model));
    }
  }

  return result;
}

export function getOllamaCatalog(options: { maxVariants?: number } = {}): ModelInfo[] {
  const maxVariants = options.maxVariants ?? DEFAULT_MAX_VARIANTS;
  if (maxVariants === DEFAULT_MAX_VARIANTS) {
    if (!cachedCatalog) {
      cachedCatalog = buildCatalog(maxVariants);
    }
    return cachedCatalog;
  }

  if (maxVariants === Number.POSITIVE_INFINITY) {
    if (!cachedFullCatalog) {
      cachedFullCatalog = buildCatalog(maxVariants);
    }
    return cachedFullCatalog;
  }

  return buildCatalog(maxVariants);
}
