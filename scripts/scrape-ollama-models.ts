#!/usr/bin/env -S deno run --allow-net --allow-write --allow-read --allow-env
/**
 * Ollama Models Scraper
 *
 * Scrapes ollama.com/library to generate ollama_models.json
 * Output format is compatible with HLVM tooling
 *
 * Usage:
 *   # Update HLVM's bundled JSON (default)
 *   deno task scrape-models
 *
 *   # Update HLVM and external resource copy
 *   deno task scrape-models --sync
 *
 *   # Custom output path
 *   deno run --allow-net --allow-write --allow-read --allow-env scripts/scrape-ollama-models.ts --output ./custom.json
 *
 * The JSON file ships with HLVM and is used by:
 *   - src/hlvm/providers/ollama/catalog.ts
 *   - src/hlvm/cli/repl-ink/components/ModelBrowser.tsx
 *
 * @see ~/dev/HLVM/HLVM/Resources/ollama_models.json for reference format
 */

// ============================================================
// Type Definitions (matching HLVM Swift types exactly)
// ============================================================

interface OllamaVariant {
  id: string;           // e.g., "llama3:8b"
  name: string;         // e.g., "8b"
  parameters: string;   // e.g., "8B"
  size: string;         // e.g., "4.7GB"
  context: string;      // e.g., "8K"
  vision: boolean;
  input_types?: string; // e.g., "Text, Image" (only for vision models)
}

interface OllamaModel {
  description: string;
  id: string;           // e.g., "llama3"
  name: string;         // e.g., "Llama 3"
  variants: OllamaVariant[];
  vision: boolean;
  ollamaUrl: string;    // e.g., "https://ollama.com/library/llama3"
  downloads: number;
  model_type?: string;  // e.g., "embedding" (optional)
}

interface OllamaModelsJSON {
  version: string;
  last_updated: string;
  total_models: number;
  models: OllamaModel[];
}

// ============================================================
// Constants
// ============================================================

const BASE_URL = "https://ollama.com";
const USER_AGENT = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
const CONCURRENCY_LIMIT = 5; // Don't hammer the server
const DELAY_MS = 200; // Delay between requests

// ============================================================
// Utility Functions
// ============================================================

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function formatModelName(id: string): string {
  // Convert "llama3.2" -> "Llama 3.2", "deepseek-r1" -> "Deepseek R1"
  return id
    .split(/[-_.]/)
    .map(part => {
      // Keep numbers as-is, capitalize words
      if (/^\d+$/.test(part)) return part;
      return part.charAt(0).toUpperCase() + part.slice(1).toLowerCase();
    })
    .join(" ")
    .replace(/(\d+)\s+(\d+)/g, "$1.$2"); // "3 2" -> "3.2"
}

function parseDownloads(text: string): number {
  // Parse "25M Pulls" -> 25000000, "1.5K Pulls" -> 1500
  const match = text.match(/([\d.]+)\s*([KMB])?/i);
  if (!match) return 0;

  const num = parseFloat(match[1]);
  const suffix = (match[2] || "").toUpperCase();

  switch (suffix) {
    case "K": return Math.round(num * 1_000);
    case "M": return Math.round(num * 1_000_000);
    case "B": return Math.round(num * 1_000_000_000);
    default: return Math.round(num);
  }
}

function parseSize(sizeStr: string): string {
  // Normalize size strings: "4.7 GB" -> "4.7GB"
  return sizeStr.replace(/\s+/g, "").toUpperCase();
}

function parseContext(contextStr: string): string {
  // Normalize context: "128k" -> "128K", "8192" -> "8K"
  const match = contextStr.match(/([\d.]+)\s*([KkMm])?/);
  if (!match) return contextStr;

  let num = parseFloat(match[1]);
  const suffix = (match[2] || "").toUpperCase();

  // Convert raw numbers >= 1000 to K (e.g., 8192 -> 8K)
  if (!suffix && num >= 1000) {
    num = num / 1024;
    return `${Math.round(num)}K`;
  }

  // For small numbers without suffix (like 512 for embedding models), keep as-is
  if (!suffix && num < 1000) {
    return String(Math.round(num));
  }

  return `${match[1]}${suffix}`;
}

function parseParameters(paramStr: string): string {
  // Normalize: "7b" -> "7B", "1.1b" -> "1.1B", "137m" -> "137M"
  return paramStr.toUpperCase();
}

// ============================================================
// Scraping Functions
// ============================================================

async function fetchHTML(url: string): Promise<string> {
  const response = await fetch(url, {
    headers: {
      "User-Agent": USER_AGENT,
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.5",
    },
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  }

  return response.text();
}

async function fetchModelList(): Promise<string[]> {
  console.log("📥 Fetching model list from ollama.com/library...");

  const html = await fetchHTML(`${BASE_URL}/library`);

  // Extract model names from href="/library/modelname"
  const pattern = /href="\/library\/([^"\/]+)"/g;
  const models = new Set<string>();

  let match;
  while ((match = pattern.exec(html)) !== null) {
    const modelName = match[1];
    // Skip navigation/utility links
    if (!["new", "search", "popular", "featured", "models"].includes(modelName)) {
      models.add(modelName);
    }
  }

  const modelList = Array.from(models).sort();
  console.log(`   Found ${modelList.length} models`);

  return modelList;
}

async function fetchModelDetails(modelId: string): Promise<OllamaModel | null> {
  try {
    const url = `${BASE_URL}/library/${modelId}`;
    const html = await fetchHTML(url);

    // Extract description from meta tag or page content
    let description = "";
    const metaMatch = html.match(/<meta\s+name="description"\s+content="([^"]+)"/i);
    if (metaMatch) {
      description = metaMatch[1]
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'");
    }

    // Try to get description from page h2 or first paragraph if meta is generic
    if (!description || description.includes("Ollama") && description.includes("library")) {
      const h2Match = html.match(/<h2[^>]*class="[^"]*text-lg[^"]*"[^>]*>([^<]+)</i);
      if (h2Match) {
        description = h2Match[1].trim();
      }
    }

    // Extract downloads count from x-test-pull-count span
    let downloads = 0;
    const downloadsMatch = html.match(/x-test-pull-count[^>]*>([^<]+)</i) ||
                          html.match(/([\d.]+[KMB]?)\s*(?:Pulls|Downloads)/i);
    if (downloadsMatch) {
      downloads = parseDownloads(downloadsMatch[1] || downloadsMatch[0]);
    }

    // Check if it's a vision model (look for vision badge or multimodal mentions)
    const hasVisionBadge = /class="[^"]*"[^>]*>vision<\/span>/i.test(html);
    const hasVisionInDescription = /multimodal|vision\s+encoder|visual\s+and\s+language|image\s+understanding/i.test(description);
    const isVisionModel = hasVisionBadge || hasVisionInDescription ||
                          (modelId.includes("vision") || modelId.includes("llava") || modelId.includes("moondream"));

    // Check if it's an embedding model
    const isEmbeddingModel = /embedding|embed/i.test(modelId) ||
                             /embedding\s+model|text\s+embed/i.test(html);

    // Extract variants/tags
    const variants = await extractVariants(html, modelId, isVisionModel);

    // If no variants found, create a default "latest"
    if (variants.length === 0) {
      variants.push({
        id: `${modelId}:latest`,
        name: "latest",
        parameters: "Unknown",
        size: "Unknown",
        context: "Unknown",
        vision: isVisionModel,
        ...(isVisionModel ? { input_types: "Text, Image" } : {}),
      });
    }

    const model: OllamaModel = {
      description: description || formatModelName(modelId),
      id: modelId,
      name: formatModelName(modelId),
      variants,
      vision: isVisionModel,
      ollamaUrl: url,
      downloads,
      ...(isEmbeddingModel ? { model_type: "embedding" } : {}),
    };

    return model;

  } catch (error) {
    console.error(`   ❌ Error fetching ${modelId}:`, error instanceof Error ? error.message : error);
    return null;
  }
}

async function extractVariants(html: string, modelId: string, isVisionModel: boolean): Promise<OllamaVariant[]> {
  const variants: OllamaVariant[] = [];
  const seenTags = new Set<string>();

  // Pattern 1: Mobile view format - most reliable
  // Format: href="/library/model:tag"... then <p class="flex text-neutral-500">4.9GB · 128K context window</p>
  // We need to match each variant block separately, not greedily across blocks

  // Split HTML into variant blocks - each variant appears in an <a> tag with class containing "sm:hidden"
  const mobileBlockPattern = /<a\s+href="\/library\/([^:]+):([^"]+)"[^>]*class="[^"]*sm:hidden[^"]*"[^>]*>[\s\S]*?<\/a>/gi;

  let blockMatch;
  while ((blockMatch = mobileBlockPattern.exec(html)) !== null) {
    const [fullBlock, matchedModelId, tag] = blockMatch;

    // Only process blocks for this model
    if (matchedModelId.toLowerCase() !== modelId.toLowerCase()) continue;

    const tagLower = tag.toLowerCase();
    if (seenTags.has(tagLower)) continue;
    seenTags.add(tagLower);

    // Extract size and context from within this specific block
    // Pattern 1 (normal): 4.9GB · 128K context window
    // Pattern 2 (cloud): 128K context window · Text (no size - runs on remote API)

    let size = "Unknown";
    let context = "Unknown";

    // Try normal pattern first: SIZE · CONTEXT context
    const normalMatch = fullBlock.match(/(\d+(?:\.\d+)?\s*[GMKTMB]+)\s*·\s*(\d+[KkMm]?)\s*context/i);
    if (normalMatch) {
      size = parseSize(normalMatch[1]);
      context = parseContext(normalMatch[2]);
    } else {
      // No size in HTML = cloud-hosted model (runs via API, no local download)
      // Pattern: just "128K context window" without preceding size
      const cloudMatch = fullBlock.match(/>(\d+[KkMm]?)\s*context\s*window/i);
      if (cloudMatch) {
        context = parseContext(cloudMatch[1]);
        // Informative message: no hardcoding, detected by absence of size in HTML
        size = "Cloud (API only)";
      }
    }

    // Extract parameters from tag name (e.g., "7b", "70b", "1.5b")
    let parameters = "Unknown";
    const paramMatch = tagLower.match(/(\d+(?:\.\d+)?)(b|m)/i);
    if (paramMatch) {
      parameters = parseParameters(`${paramMatch[1]}${paramMatch[2]}`);
    }

    variants.push({
      id: `${modelId}:${tagLower}`,
      name: tagLower,
      parameters,
      size,
      context,
      vision: isVisionModel,
      ...(isVisionModel ? { input_types: "Text, Image" } : {}),
    });
  }

  // Pattern 2: Desktop grid view fallback - if mobile pattern didn't find variants
  if (variants.length === 0) {
    // Grid pattern: <a href="/library/model:tag">...</a> ... <p class="col-span-2">SIZE</p> ... <p class="col-span-2">CONTEXT</p>
    const gridRowPattern = new RegExp(
      `<a\\s+href="/library/${modelId}:([^"]+)"[^>]*>.*?</a>` +
      `[\\s\\S]*?<p[^>]*col-span-2[^>]*>([^<]+)</p>` +
      `[\\s\\S]*?<p[^>]*col-span-2[^>]*>([^<]+)</p>`,
      "gi"
    );

    let match;
    while ((match = gridRowPattern.exec(html)) !== null) {
      const tag = match[1].toLowerCase();
      if (seenTags.has(tag)) continue;
      seenTags.add(tag);

      const size = parseSize(match[2].trim());
      const context = parseContext(match[3].trim());

      let parameters = "Unknown";
      const paramMatch = tag.match(/(\d+(?:\.\d+)?)(b|m)/i);
      if (paramMatch) {
        parameters = parseParameters(`${paramMatch[1]}${paramMatch[2]}`);
      }

      variants.push({
        id: `${modelId}:${tag}`,
        name: tag,
        parameters,
        size,
        context,
        vision: isVisionModel,
        ...(isVisionModel ? { input_types: "Text, Image" } : {}),
      });
    }
  }

  // Fallback: find tags from href links if detailed pattern didn't match
  if (variants.length === 0) {
    const tagMentions = html.matchAll(new RegExp(`href="/library/${modelId}:([^"]+)"`, "gi"));

    for (const match of tagMentions) {
      const tag = match[1].toLowerCase();
      if (seenTags.has(tag)) continue;
      seenTags.add(tag);

      // Extract parameters from tag name
      let parameters = "Unknown";
      const paramMatch = tag.match(/(\d+(?:\.\d+)?)(b|m)/i);
      if (paramMatch) {
        parameters = parseParameters(`${paramMatch[1]}${paramMatch[2]}`);
      }

      // Estimate size based on parameters (rough heuristic)
      let size = "Unknown";
      if (parameters !== "Unknown") {
        const paramNum = parseFloat(parameters);
        if (parameters.endsWith("B")) {
          size = `${Math.round(paramNum * 0.6)}GB`;
        } else if (parameters.endsWith("M")) {
          size = `${Math.round(paramNum * 2)}MB`;
        }
      }

      variants.push({
        id: `${modelId}:${tag}`,
        name: tag,
        parameters,
        size,
        context: "4K",
        vision: isVisionModel,
        ...(isVisionModel ? { input_types: "Text, Image" } : {}),
      });
    }
  }

  // Sort variants: latest first, then by parameter size (descending)
  variants.sort((a, b) => {
    if (a.name === "latest") return -1;
    if (b.name === "latest") return 1;

    const aParam = parseFloat(a.parameters) || 0;
    const bParam = parseFloat(b.parameters) || 0;
    return bParam - aParam;
  });

  return variants;
}

// ============================================================
// Main Scraper
// ============================================================

async function scrapeOllamaModels(): Promise<OllamaModelsJSON> {
  console.log("🦙 Ollama Models Scraper");
  console.log("========================\n");

  // Step 1: Get list of all models
  const modelIds = await fetchModelList();

  // Step 2: Fetch details for each model (with concurrency limit)
  console.log(`\n📊 Fetching details for ${modelIds.length} models...`);

  const models: OllamaModel[] = [];
  const chunks: string[][] = [];

  // Split into chunks for controlled concurrency
  for (let i = 0; i < modelIds.length; i += CONCURRENCY_LIMIT) {
    chunks.push(modelIds.slice(i, i + CONCURRENCY_LIMIT));
  }

  let processed = 0;
  for (const chunk of chunks) {
    const results = await Promise.all(
      chunk.map(async (modelId) => {
        const result = await fetchModelDetails(modelId);
        processed++;
        const progress = Math.round((processed / modelIds.length) * 100);
        console.log(`   [${progress}%] ${modelId}`);
        return result;
      })
    );

    for (const model of results) {
      if (model) models.push(model);
    }

    // Be nice to the server
    await delay(DELAY_MS);
  }

  // Step 3: Sort models by downloads (most popular first)
  models.sort((a, b) => b.downloads - a.downloads);

  // Step 4: Build final JSON
  const today = new Date().toISOString().split("T")[0];

  const output: OllamaModelsJSON = {
    version: "2.0",
    last_updated: today,
    total_models: models.length,
    models,
  };

  console.log(`\n✅ Successfully scraped ${models.length} models`);

  return output;
}

// ============================================================
// CLI Entry Point
// ============================================================

async function main() {
  const args = Deno.args;

  // Default: update HLVM's bundled JSON file
  const scriptDir = new URL(".", import.meta.url).pathname;
  const bundledPath = `${scriptDir}../src/data/ollama_models.json`;

  // Parse --output flag (overrides default)
  let outputPaths = [bundledPath];
  const outputIndex = args.indexOf("--output");
  if (outputIndex !== -1 && args[outputIndex + 1]) {
    outputPaths = [args[outputIndex + 1]];
  }

  // --sync flag: update HLVM plus external resource copy
  if (args.includes("--sync")) {
    const resourcePath = `${Deno.env.get("HOME")}/dev/HLVM/HLVM/Resources/ollama_models.json`;
    outputPaths = [bundledPath, resourcePath];
  }

  try {
    const result = await scrapeOllamaModels();
    const json = JSON.stringify(result, null, 2);

    // Write to all output paths
    for (const outputPath of outputPaths) {
      await Deno.writeTextFile(outputPath, json);
      console.log(`\n📁 Output written to: ${outputPath}`);
    }
    console.log(`   File size: ${(json.length / 1024).toFixed(1)} KB`);

    // Print summary
    console.log("\n📈 Summary:");
    console.log(`   Total models: ${result.total_models}`);
    console.log(`   Vision models: ${result.models.filter(m => m.vision).length}`);
    console.log(`   Embedding models: ${result.models.filter(m => m.model_type === "embedding").length}`);
    console.log(`   Most popular: ${result.models[0]?.id} (${result.models[0]?.downloads.toLocaleString()} pulls)`);

  } catch (error) {
    console.error("\n❌ Error:", error instanceof Error ? error.message : error);
    Deno.exit(1);
  }
}

// Run if executed directly
if (import.meta.main) {
  main();
}

export { scrapeOllamaModels, type OllamaModelsJSON, type OllamaModel, type OllamaVariant };
