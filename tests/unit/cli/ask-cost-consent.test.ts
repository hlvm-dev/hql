import { assertEquals } from "jsr:@std/assert";
import {
  extractProvider,
  isPaidProvider,
} from "../../../src/hlvm/cli/commands/ask.ts";
import { validateValue } from "../../../src/common/config/types.ts";

Deno.test("ask cost consent: extractProvider normalizes valid provider prefixes", () => {
  assertEquals(extractProvider("openai/gpt-4o"), "openai");
  assertEquals(extractProvider("Anthropic/claude-sonnet-4-5-20250929"), "anthropic");
  assertEquals(extractProvider("ollama/llama3.1:8b"), "ollama");
});

Deno.test("ask cost consent: extractProvider rejects bare and malformed model ids", () => {
  assertEquals(extractProvider("gpt-4o"), null);
  assertEquals(extractProvider(""), null);
  assertEquals(extractProvider("/gpt-4o"), null);
});

Deno.test("ask cost consent: isPaidProvider only flags paid remote providers", () => {
  assertEquals(isPaidProvider("openai/gpt-4o"), true);
  assertEquals(isPaidProvider("anthropic/claude-sonnet-4-5-20250929"), true);
  assertEquals(isPaidProvider("google/gemini-2.0-flash"), true);
  assertEquals(isPaidProvider("ollama/llama3.1:8b"), false);
  assertEquals(isPaidProvider("ollama/deepseek-v3.1:671b-cloud"), false);
  assertEquals(isPaidProvider("gpt-4o"), false);
});

Deno.test("ask cost consent: approvedProviders validation accepts only string arrays", () => {
  assertEquals(validateValue("approvedProviders", ["openai", "anthropic"]).valid, true);
  assertEquals(validateValue("approvedProviders", []).valid, true);
  assertEquals(validateValue("approvedProviders", undefined).valid, true);
  assertEquals(validateValue("approvedProviders", "openai").valid, false);
  assertEquals(validateValue("approvedProviders", ["openai", 123]).valid, false);
});
