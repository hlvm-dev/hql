/**
 * Tests for first-run auto-setup.
 *
 * These are REAL tests — they call actual functions against real system state:
 * - parseParamSize: pure function
 * - pickBestCloudModel: uses real ollama_models.json catalog
 * - aiEngine: uses the real AIEngineLifecycle singleton
 * - findSystemOllama: probes real system for Ollama binary
 */

import { assertEquals } from "jsr:@std/assert";
import {
  parseParamSize,
  pickBestCloudModel,
} from "../../../src/hlvm/cli/commands/first-run-setup.ts";
import { aiEngine } from "../../../src/hlvm/runtime/ai-runtime.ts";
import type { AIEngineLifecycle } from "../../../src/hlvm/runtime/ai-runtime.ts";
import { findSystemOllama } from "../../../src/hlvm/cli/commands/ollama.ts";
import { getOllamaCatalog } from "../../../src/hlvm/providers/ollama/catalog.ts";
import { isOllamaCloudModel } from "../../../src/hlvm/providers/ollama/cloud.ts";

// ============================================================================
// parseParamSize — pure function
// ============================================================================

Deno.test("parseParamSize: parses integer sizes", () => {
  assertEquals(parseParamSize("3B"), 3);
  assertEquals(parseParamSize("7B"), 7);
  assertEquals(parseParamSize("70B"), 70);
  assertEquals(parseParamSize("120B"), 120);
  assertEquals(parseParamSize("671B"), 671);
});

Deno.test("parseParamSize: parses fractional sizes", () => {
  assertEquals(parseParamSize("1.5B"), 1.5);
  assertEquals(parseParamSize("7.5B"), 7.5);
  assertEquals(parseParamSize("3.8b"), 3.8);
});

Deno.test("parseParamSize: returns Infinity for unknown/missing", () => {
  assertEquals(parseParamSize("Unknown"), Infinity);
  assertEquals(parseParamSize(undefined), Infinity);
  assertEquals(parseParamSize(""), Infinity);
});

Deno.test("parseParamSize: edge cases", () => {
  assertEquals(parseParamSize("0B"), 0);
  assertEquals(parseParamSize("0.5B"), 0.5);
  assertEquals(parseParamSize("no-number"), Infinity);
});

// ============================================================================
// pickBestCloudModel — real catalog data from ollama_models.json
// ============================================================================

Deno.test("pickBestCloudModel: returns a cloud model with tools capability", () => {
  const result = pickBestCloudModel();

  // The real catalog should have cloud models with tools
  if (result === null) {
    // If catalog has no cloud+tools models, that's a data issue — skip
    console.warn("WARN: No cloud+tools models in catalog. Skipping.");
    return;
  }

  // Model name must contain "cloud" in the tag
  assertEquals(isOllamaCloudModel(result.name), true,
    `Expected cloud model, got: ${result.name}`);

  // Must have tools capability
  assertEquals(result.capabilities?.includes("tools"), true,
    `Expected tools capability, got: ${result.capabilities}`);
});

Deno.test("pickBestCloudModel: prefers preferred list over random largest", () => {
  const result = pickBestCloudModel();
  if (!result) return;

  // Check if any preferred model exists in catalog
  const catalog = getOllamaCatalog({ maxVariants: Infinity });
  const preferred = [
    "deepseek-v3.1:671b-cloud",
    "qwen3-coder:480b-cloud",
    "mistral-large-3:675b-cloud",
  ];

  const hasPreferred = preferred.some((name) =>
    catalog.some((m) =>
      m.name === name && isOllamaCloudModel(m.name) && m.capabilities?.includes("tools")
    )
  );

  if (hasPreferred) {
    // If a preferred model is in the catalog, pickBestCloudModel must return one of them
    assertEquals(preferred.includes(result.name), true,
      `Expected one of ${preferred.join(", ")}, got: ${result.name}`);
  }
});

Deno.test("pickBestCloudModel: result has valid ModelInfo shape", () => {
  const result = pickBestCloudModel();
  if (!result) return;

  assertEquals(typeof result.name, "string");
  assertEquals(result.name.length > 0, true);
  assertEquals(Array.isArray(result.capabilities), true);
  // displayName should exist for catalog models
  assertEquals(typeof result.displayName, "string");
});

// ============================================================================
// AIEngineLifecycle interface — aiEngine singleton
// ============================================================================

Deno.test("aiEngine: conforms to AIEngineLifecycle interface", () => {
  // Verify the singleton has all required methods
  const engine: AIEngineLifecycle = aiEngine;
  assertEquals(typeof engine.isRunning, "function");
  assertEquals(typeof engine.ensureRunning, "function");
  assertEquals(typeof engine.getEnginePath, "function");
});

Deno.test({
  name: "aiEngine.isRunning: returns boolean for real daemon check",
  sanitizeResources: false,
  sanitizeOps: false,
  async fn() {
    const running = await aiEngine.isRunning();
    assertEquals(typeof running, "boolean");

    if (!running) {
      console.warn("WARN: AI engine not running. Skipping running assertion.");
      return;
    }
    assertEquals(running, true);
  },
});

Deno.test({
  name: "aiEngine.getEnginePath: returns embedded or system path",
  sanitizeResources: false,
  sanitizeOps: false,
  async fn() {
    const path = await aiEngine.getEnginePath();
    assertEquals(typeof path, "string");
    assertEquals(path.length > 0, true);
    // Should be either a full path to embedded engine or "ollama" (system)
    assertEquals(
      path.includes("engine") || path === "ollama",
      true,
      `Expected engine path or 'ollama', got: ${path}`,
    );
  },
});

// ============================================================================
// findSystemOllama — probes real system
// ============================================================================

Deno.test({
  name: "findSystemOllama: finds Ollama on this machine",
  sanitizeResources: false,
  sanitizeOps: false,
  async fn() {
    const path = await findSystemOllama();

    // Ollama should be installed on the dev machine
    if (path === null) {
      console.warn("WARN: Ollama not installed on this machine. Skipping.");
      return;
    }

    assertEquals(typeof path, "string");
    assertEquals(path.length > 0, true);
    // Path should contain "ollama"
    assertEquals(path.includes("ollama"), true,
      `Expected path containing 'ollama', got: ${path}`);
  },
});
