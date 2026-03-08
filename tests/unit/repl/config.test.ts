import { assertEquals } from "jsr:@std/assert@1";
import {
  CONFIG_KEYS,
  createDefaultToolsConfig,
  parseValue,
  validateValue,
} from "../../../src/common/config/types.ts";
import { isConfigKey } from "../../../src/common/config/storage.ts";

Deno.test("ConfigTypes: createDefaultToolsConfig deep-clones nested defaults", () => {
  const first = createDefaultToolsConfig();
  const second = createDefaultToolsConfig();

  first.web!.search!.enabled = false;

  assertEquals(second.web?.search?.enabled, true);
});

Deno.test("ConfigTypes: CONFIG_KEYS and isConfigKey stay aligned", () => {
  assertEquals(CONFIG_KEYS, [
    "model",
    "endpoint",
    "temperature",
    "maxTokens",
    "theme",
    "keybindings",
    "tools",
    "modelConfigured",
    "approvedProviders",
    "agentMode",
    "sessionMemory",
    "permissionMode",
    "agentMaxThreads",
    "agentMaxDepth",
  ]);

  for (const key of CONFIG_KEYS) {
    assertEquals(isConfigKey(key), true);
  }

  assertEquals(isConfigKey("version"), false);
  assertEquals(isConfigKey("invalid"), false);
  assertEquals(isConfigKey(""), false);
});

Deno.test("ConfigTypes: validateValue accepts representative valid values for each config family", () => {
  assertEquals(validateValue("model", "ollama/llama3.2").valid, true);
  assertEquals(validateValue("endpoint", "http://localhost:11434").valid, true);
  assertEquals(validateValue("temperature", 0.7).valid, true);
  assertEquals(validateValue("maxTokens", 4096).valid, true);
  assertEquals(validateValue("theme", "sicp").valid, true);
  assertEquals(validateValue("keybindings", { "show-palette": "Ctrl+P" }).valid, true);
  assertEquals(validateValue("tools", {}).valid, true);
  assertEquals(validateValue("modelConfigured", true).valid, true);
  assertEquals(validateValue("approvedProviders", ["openai", "anthropic"]).valid, true);
  assertEquals(validateValue("agentMode", "hlvm").valid, true);
  assertEquals(validateValue("sessionMemory", false).valid, true);
  assertEquals(validateValue("permissionMode", "auto-edit").valid, true);
});

Deno.test("ConfigTypes: validateValue rejects representative invalid values for each config family", () => {
  assertEquals(validateValue("model", "just-model-name").valid, false);
  assertEquals(validateValue("endpoint", "localhost:11434").valid, false);
  assertEquals(validateValue("temperature", 2.1).valid, false);
  assertEquals(validateValue("maxTokens", 1.5).valid, false);
  assertEquals(validateValue("theme", "unknown").valid, false);
  assertEquals(validateValue("keybindings", { "show-palette": 123 }).valid, false);
  assertEquals(validateValue("tools", []).valid, false);
  assertEquals(validateValue("modelConfigured", "true").valid, false);
  assertEquals(validateValue("approvedProviders", ["openai", 123]).valid, false);
  assertEquals(validateValue("agentMode", "agent").valid, false);
  assertEquals(validateValue("sessionMemory", null).valid, false);
  assertEquals(validateValue("permissionMode", "free-for-all").valid, false);
});

Deno.test("ConfigTypes: parseValue coerces numeric and boolean keys and leaves strings untouched", () => {
  assertEquals(parseValue("temperature", "0.7"), 0.7);
  assertEquals(parseValue("maxTokens", "4096"), 4096);
  assertEquals(parseValue("sessionMemory", "true"), true);
  assertEquals(parseValue("modelConfigured", "false"), false);
  assertEquals(parseValue("model", "ollama/mistral"), "ollama/mistral");
  assertEquals(parseValue("endpoint", "http://localhost:11434"), "http://localhost:11434");
  assertEquals(parseValue("theme", "dracula"), "dracula");
});
