import { assertEquals } from "jsr:@std/assert@1";
import {
  looksLikeNaturalLanguage,
  resolveConversationMode,
} from "../../../src/hlvm/cli/repl/input-routing.ts";

Deno.test("looksLikeNaturalLanguage routes plain unbound identifiers to chat", () => {
  assertEquals(looksLikeNaturalLanguage("hello"), true);
});

Deno.test("looksLikeNaturalLanguage keeps bound identifiers on the code path", () => {
  assertEquals(
    looksLikeNaturalLanguage("hello", {
      hasBinding: (name: string) => name === "hello",
    }),
    false,
  );
});

Deno.test("looksLikeNaturalLanguage treats full operator expressions as code", () => {
  assertEquals(looksLikeNaturalLanguage("x - y"), false);
  assertEquals(looksLikeNaturalLanguage("count+1"), false);
  assertEquals(looksLikeNaturalLanguage("foo.bar"), false);
});

Deno.test("looksLikeNaturalLanguage keeps hyphenated natural-language prompts in chat", () => {
  assertEquals(
    looksLikeNaturalLanguage("hello - go apple.com and find any new macbook stuff"),
    true,
  );
});

Deno.test("looksLikeNaturalLanguage keeps domain-led prompts in chat when they are not code", () => {
  assertEquals(
    looksLikeNaturalLanguage("apple.com find any new macbook stuff"),
    true,
  );
});

Deno.test("resolveConversationMode sends weak models to chat", () => {
  assertEquals(
    resolveConversationMode("ollama/llama3.2:1b", {
      parameterSize: "1.2B",
    }),
    "chat",
  );
});

Deno.test("resolveConversationMode sends strong models to agent", () => {
  assertEquals(
    resolveConversationMode("ollama/qwen2.5-coder:14b", {
      parameterSize: "14.8B",
    }),
    "agent",
  );
  assertEquals(resolveConversationMode("openai/gpt-5", null), "agent");
});
