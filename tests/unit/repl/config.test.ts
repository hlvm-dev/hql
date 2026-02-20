/**
 * Unit tests for config module
 */

import { assertEquals } from "jsr:@std/assert@1";
import {
  createDefaultToolsConfig,
  CONFIG_KEYS,
  validateValue,
  parseValue,
} from "../../../src/common/config/types.ts";
import { isConfigKey } from "../../../src/common/config/storage.ts";

// ============================================================
// Defaults tests
// ============================================================

Deno.test("createDefaultToolsConfig - returns deep-cloned defaults", () => {
  const first = createDefaultToolsConfig();
  const second = createDefaultToolsConfig();

  first.web!.search!.enabled = false;
  first.web!.fetch!.firecrawl!.enabled = true;

  assertEquals(second.web?.search?.enabled, true);
  assertEquals(second.web?.fetch?.firecrawl?.enabled, false);
});

// ============================================================
// CONFIG_KEYS tests
// ============================================================

Deno.test("CONFIG_KEYS - exact user-settable keys", () => {
  assertEquals(CONFIG_KEYS, [
    "model",
    "endpoint",
    "temperature",
    "maxTokens",
    "theme",
    "tools",
    "modelConfigured",
    "approvedProviders",
    "agentMode",
    "sessionMemory",
  ]);
});

Deno.test("isConfigKey - accepts all CONFIG_KEYS", () => {
  for (const key of CONFIG_KEYS) {
    assertEquals(isConfigKey(key), true);
  }
});

Deno.test("isConfigKey - invalid keys", () => {
  assertEquals(isConfigKey("invalid"), false);
  assertEquals(isConfigKey("version"), false); // version is not user-settable
  assertEquals(isConfigKey(""), false);
});

// ============================================================
// validateValue tests
// ============================================================

Deno.test("validateValue - model valid", () => {
  assertEquals(validateValue("model", "ollama/llama3.2").valid, true);
  assertEquals(validateValue("model", "openai/gpt-4").valid, true);
  assertEquals(validateValue("model", "anthropic/claude-3").valid, true);
});

Deno.test("validateValue - model invalid", () => {
  assertEquals(validateValue("model", "just-model-name").valid, false);
  assertEquals(validateValue("model", "").valid, false);
  assertEquals(validateValue("model", 123).valid, false);
});

Deno.test("validateValue - endpoint valid", () => {
  assertEquals(validateValue("endpoint", "http://localhost:11434").valid, true);
  assertEquals(validateValue("endpoint", "https://api.openai.com").valid, true);
});

Deno.test("validateValue - endpoint invalid", () => {
  assertEquals(validateValue("endpoint", "localhost:11434").valid, false);
  assertEquals(validateValue("endpoint", "not-a-url").valid, false);
  assertEquals(validateValue("endpoint", 123).valid, false);
});

Deno.test("validateValue - temperature valid", () => {
  assertEquals(validateValue("temperature", 0).valid, true);
  assertEquals(validateValue("temperature", 0.7).valid, true);
  assertEquals(validateValue("temperature", 2).valid, true);
});

Deno.test("validateValue - temperature invalid", () => {
  assertEquals(validateValue("temperature", -0.1).valid, false);
  assertEquals(validateValue("temperature", 2.1).valid, false);
  assertEquals(validateValue("temperature", "0.7").valid, false);
});

Deno.test("validateValue - maxTokens valid", () => {
  assertEquals(validateValue("maxTokens", 1).valid, true);
  assertEquals(validateValue("maxTokens", 4096).valid, true);
  assertEquals(validateValue("maxTokens", 100000).valid, true);
});

Deno.test("validateValue - maxTokens invalid", () => {
  assertEquals(validateValue("maxTokens", 0).valid, false);
  assertEquals(validateValue("maxTokens", -1).valid, false);
  assertEquals(validateValue("maxTokens", 1.5).valid, false);
  assertEquals(validateValue("maxTokens", "4096").valid, false);
});

Deno.test("validateValue - theme valid", () => {
  assertEquals(validateValue("theme", "sicp").valid, true);
});

Deno.test("validateValue - tools valid", () => {
  assertEquals(validateValue("tools", {}).valid, true);
});

Deno.test("validateValue - tools invalid", () => {
  assertEquals(validateValue("tools", null).valid, false);
  assertEquals(validateValue("tools", []).valid, false);
  assertEquals(validateValue("tools", "nope").valid, false);
});

Deno.test("validateValue - theme invalid", () => {
  assertEquals(validateValue("theme", "unknown").valid, false);
  assertEquals(validateValue("theme", "").valid, false);
  assertEquals(validateValue("theme", 123).valid, false);
});

Deno.test("validateValue - sessionMemory valid", () => {
  assertEquals(validateValue("sessionMemory", true).valid, true);
  assertEquals(validateValue("sessionMemory", false).valid, true);
  assertEquals(validateValue("sessionMemory", undefined).valid, true);
});

Deno.test("validateValue - sessionMemory invalid", () => {
  assertEquals(validateValue("sessionMemory", "true").valid, false);
  assertEquals(validateValue("sessionMemory", 1).valid, false);
  assertEquals(validateValue("sessionMemory", null).valid, false);
});

// ============================================================
// parseValue tests
// ============================================================

Deno.test("parseValue - temperature", () => {
  assertEquals(parseValue("temperature", "0.7"), 0.7);
  assertEquals(parseValue("temperature", "1"), 1);
  assertEquals(parseValue("temperature", "2.0"), 2.0);
});

Deno.test("parseValue - maxTokens", () => {
  assertEquals(parseValue("maxTokens", "4096"), 4096);
  assertEquals(parseValue("maxTokens", "1000"), 1000);
});

Deno.test("parseValue - string values pass through", () => {
  assertEquals(parseValue("model", "ollama/mistral"), "ollama/mistral");
  assertEquals(parseValue("endpoint", "http://localhost:11434"), "http://localhost:11434");
  assertEquals(parseValue("theme", "dracula"), "dracula");
});
