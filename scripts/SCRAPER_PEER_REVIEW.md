# Ollama Models Scraper - Peer Review Documentation

## Overview

Created a TypeScript scraper (`scripts/scrape-ollama-models.ts`) that generates `ollama_models.json` with the **exact same structure** as the HLVM Swift app uses. Both HQL and HLVM GUI can share this JSON file.

## Problem

- Ollama has **no official API** to list all available models from their registry
- The `/api/tags` endpoint only returns locally installed models
- HLVM has a manually curated `ollama_models.json` (178 models, last updated 2025-08-07)
- Need an automated way to generate/update this file

## Solution

Port the scraping logic from HLVM's `OllamaLibraryClient.swift` (found in git history at commit `af75c6a27`) to TypeScript.

## JSON Structure Verification

### Required Fields - MATCH ✅

| Level | Field | HLVM | Ours | Match |
|-------|-------|------|------|-------|
| Root | `version` | string | string | ✅ |
| Root | `last_updated` | string | string | ✅ |
| Root | `total_models` | number | number | ✅ |
| Root | `models` | array | array | ✅ |
| Model | `description` | string | string | ✅ |
| Model | `id` | string | string | ✅ |
| Model | `name` | string | string | ✅ |
| Model | `variants` | array | array | ✅ |
| Model | `vision` | boolean | boolean | ✅ |
| Model | `ollamaUrl` | string | string | ✅ |
| Model | `downloads` | number | number | ✅ |
| Variant | `id` | string | string | ✅ |
| Variant | `name` | string | string | ✅ |
| Variant | `parameters` | string | string | ✅ |
| Variant | `size` | string | string | ✅ |
| Variant | `context` | string | string | ✅ |
| Variant | `vision` | boolean | boolean | ✅ |

### Optional Fields - MATCH ✅

| Level | Field | HLVM | Ours | Match |
|-------|-------|------|------|-------|
| Model | `model_type` | "embedding" | "embedding" | ✅ |
| Variant | `input_types` | "Text, Image" | "Text, Image" | ✅ |

## Side-by-Side Data Comparison

### Test 1: Regular Model (llama3)

```
HLVM:  {"id": "llama3", "name": "Llama3", "downloads": 13600000, ...}
OURS:  {"id": "llama3", "name": "Llama3", "downloads": 13600000, ...}
```
**Result: IDENTICAL** ✅

### Test 2: Vision Model (llava)

```
HLVM:  {"id": "llava", "vision": true, "variants": [{"input_types": "Text, Image", ...}]}
OURS:  {"id": "llava", "vision": true, "variants": [{"input_types": "Text, Image", ...}]}
```
**Result: IDENTICAL** ✅

### Test 3: Embedding Model (nomic-embed-text)

```
HLVM:  {"id": "nomic-embed-text", "model_type": "embedding", ...}
OURS:  {"id": "nomic-embed-text", "model_type": "embedding", ...}
```
**Result: IDENTICAL** ✅

## Statistics Comparison

| Metric | HLVM (old) | Ours (new) |
|--------|------------|------------|
| Total models | 178 | 205 |
| Vision models | ~20 | 20 |
| Embedding models | 11 | 11 |
| Top model | varies | llama3.1 (108.6M) |

## How the Scraper Works

1. **Fetch model list** from `ollama.com/library`
   - Extracts model IDs from `href="/library/{modelId}"` links

2. **For each model**, fetch detail page and extract:
   - **Description**: From `<meta name="description">` tag
   - **Downloads**: From `<span x-test-pull-count>13.6M</span>`
   - **Vision**: From badge `<span>vision</span>` or description keywords
   - **Variants**: From links like `href="/library/llama3:8b"`
   - **Size/Context**: From pattern `"4.7GB · 8K context window"`

3. **Output JSON** matching HLVM's exact structure

## Testing Performed

### 1. JSON Structure Verification ✅

```bash
# Ran automated comparison between HLVM and our output
# Result: 100% structure match
#
# ROOT LEVEL: ['last_updated', 'models', 'total_models', 'version'] ✅
# MODEL LEVEL: ['description', 'downloads', 'id', 'name', 'ollamaUrl', 'variants', 'vision'] ✅
# VARIANT LEVEL: ['context', 'id', 'name', 'parameters', 'size', 'vision'] ✅
```

### 2. Vision Model Detection - 15/15 Verified Against ollama.com ✅

Each model was checked against the actual `<span>vision</span>` badge on ollama.com:

| Model | Has Badge | Detected | Method |
|-------|-----------|----------|--------|
| gemma3 | ✅ | ✅ | badge |
| llava | ✅ | ✅ | badge+desc+name |
| minicpm-v | ✅ | ✅ | badge+desc |
| llama3.2-vision | ✅ | ✅ | badge+name |
| llava-llama3 | ✅ | ✅ | badge+name |
| qwen2.5vl | ✅ | ✅ | badge |
| llama4 | ✅ | ✅ | badge+desc |
| mistral-small3.2 | ✅ | ✅ | badge |
| qwen3-vl | ✅ | ✅ | badge |
| granite3.2-vision | ✅ | ✅ | badge+name |
| moondream | ✅ | ✅ | badge |
| mistral-small3.1 | ✅ | ✅ | badge |
| bakllava | ✅ | ✅ | badge |
| ministral-3 | ✅ | ✅ | badge |
| llava-phi3 | ✅ | ✅ | badge |

### 3. False Positive Check - 5/5 Non-Vision Models ✅

Verified these models are correctly NOT marked as vision:

| Model | Has Badge | Detected | Result |
|-------|-----------|----------|--------|
| llama3.2 | ❌ | ❌ | ✅ Correct |
| qwen2.5 | ❌ | ❌ | ✅ Correct |
| deepseek-r1 | ❌ | ❌ | ✅ Correct |
| codestral | ❌ | ❌ | ✅ Correct |
| mistral | ❌ | ❌ | ✅ Correct |

### 4. Embedding Model Detection - 11/11 Verified ✅

| Model | Detection Method |
|-------|------------------|
| nomic-embed-text | name pattern |
| mxbai-embed-large | name pattern |
| bge-m3 | html pattern |
| all-minilm | html pattern |
| snowflake-arctic-embed | name pattern |
| embeddinggemma | name pattern |
| qwen3-embedding | name pattern |
| snowflake-arctic-embed2 | name pattern |
| bge-large | html pattern |
| granite-embedding | name pattern |
| nomic-embed-text-v2-moe | name pattern |

### 5. Side-by-Side Data Comparison ✅

```bash
# llama3: IDENTICAL (id, name, vision=false, variants count)
# llava: IDENTICAL (vision=true, input_types="Text, Image")
# nomic-embed-text: IDENTICAL (model_type="embedding")
```

## Usage

```bash
# Generate fresh ollama_models.json
deno run --allow-net --allow-write --allow-read scripts/scrape-ollama-models.ts

# Output to specific path
deno run --allow-net --allow-write --allow-read scripts/scrape-ollama-models.ts --output ~/dev/HLVM/HLVM/Resources/ollama_models.json
```

## Files

- **Scraper**: `scripts/scrape-ollama-models.ts`
- **Output**: `ollama_models.json` (compatible with both HQL and HLVM)
- **Reference**: `~/dev/HLVM/HLVM/Resources/ollama_models.json`

## Comprehensive Testing Results (2026-01-12)

### Gap 1: All 205 Models Verified ✅
```
Total models: 205
Total variants: 742
ERRORS (must fix): 0
```

### Gap 2: Variant Size/Context Accuracy - 100% ✅
Tested against **live ollama.com pages** (not cached data):

| Test Phase | Sample Size | Accuracy | Notes |
|------------|-------------|----------|-------|
| Initial | 10 | 10/10 (100%) | llama3.1, gemma3, qwen3, etc. |
| Broad random | 30 | 28/30 (93%) | Found context parsing bug |
| **After fix** | **50** | **50/50 (100%)** | ✅ Final verification |

### Gap 3: Data Quality Metrics ✅
```
Total variants: 742
Context: 742/742 (100%) ← Fixed cloud variant parsing
Size: 713/742 (96.1%)
  └─ Missing = 29 cloud-only models (no local file size - EXPECTED)
```
*Cloud variants (gemini, *-cloud) legitimately have no file size - they run on remote servers*

### Gap 4: JSON Structure - HLVM Compatible ✅
```
ROOT LEVEL: ['last_updated', 'models', 'total_models', 'version'] ✅
MODEL LEVEL: ['description', 'downloads', 'id', 'name', 'ollamaUrl', 'variants', 'vision'] ✅
VARIANT LEVEL: ['context', 'id', 'name', 'parameters', 'size', 'vision'] ✅
```

### Remaining Gaps (Not Tested)
1. **HLVM Swift Integration**: Structure verified, runtime not tested
2. **Download Count Accuracy**: Not compared against any ground truth
3. **Network Failure Handling**: Not tested what happens if ollama.com is down
4. **Long-term Stability**: HTML structure changes on ollama.com will break scraper

## Caveats

1. Scraper depends on ollama.com HTML structure (may break if they change)
2. Rate limited to 5 concurrent requests with 200ms delay
3. Cloud-hosted models (gemini, *-cloud) have no local file size - this is expected
4. Vision detection relies on badge or keywords - new patterns may not be caught
5. Embedding detection relies on name/html patterns - may miss future models
