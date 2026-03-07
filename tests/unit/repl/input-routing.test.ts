import { assertEquals } from "jsr:@std/assert@1";
import { looksLikeNaturalLanguage } from "../../../src/hlvm/cli/repl/input-routing.ts";

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
