// @ts-nocheck: Testing HQL package integration
// Test suite for @hlvm/string package
// Tests embedded stdlib package imports using @hlvm/string syntax

import { assertEquals } from "jsr:@std/assert@1";
import { run } from "./helpers.ts";

Deno.test("@hlvm/string - split basic", async () => {
  const code = `
    (import [split] from "@hlvm/string")
    (split "a,b,c" ",")
  `;
  const result = await run(code);
  assertEquals(result, ["a", "b", "c"]);
});

Deno.test("@hlvm/string - split with different separator", async () => {
  const code = `
    (import [split] from "@hlvm/string")
    (split "hello-world-test" "-")
  `;
  const result = await run(code);
  assertEquals(result, ["hello", "world", "test"]);
});

Deno.test("@hlvm/string - join basic", async () => {
  const code = `
    (import [join] from "@hlvm/string")
    (join ["x" "y" "z"] "-")
  `;
  const result = await run(code);
  assertEquals(result, "x-y-z");
});

Deno.test("@hlvm/string - join with space", async () => {
  const code = `
    (import [join] from "@hlvm/string")
    (join ["hello" "world"] " ")
  `;
  const result = await run(code);
  assertEquals(result, "hello world");
});

Deno.test("@hlvm/string - trim whitespace", async () => {
  const code = `
    (import [trim] from "@hlvm/string")
    (trim "  hello  ")
  `;
  const result = await run(code);
  assertEquals(result, "hello");
});

Deno.test("@hlvm/string - upper-case", async () => {
  const code = `
    (import [upper-case] from "@hlvm/string")
    (upper-case "hello")
  `;
  const result = await run(code);
  assertEquals(result, "HELLO");
});

Deno.test("@hlvm/string - lower-case", async () => {
  const code = `
    (import [lower-case] from "@hlvm/string")
    (lower-case "WORLD")
  `;
  const result = await run(code);
  assertEquals(result, "world");
});

Deno.test("@hlvm/string - multiple imports together", async () => {
  const code = `
    (import [split, join, trim] from "@hlvm/string")
    (var parts (split "  a , b , c  " ","))
    (var trimmed (doall (map trim parts)))
    (join trimmed "-")
  `;
  const result = await run(code);
  assertEquals(result, "a-b-c");
});

Deno.test("@hlvm/string - aliased import", async () => {
  const code = `
    (import [split as str-split] from "@hlvm/string")
    (str-split "foo:bar" ":")
  `;
  const result = await run(code);
  assertEquals(result, ["foo", "bar"]);
});

Deno.test("@hlvm/string - works with core functions", async () => {
  const code = `
    (import [split, upper-case] from "@hlvm/string")
    (var words (split "hello world" " "))
    (doall (map upper-case words))
  `;
  const result = await run(code);
  assertEquals(result, ["HELLO", "WORLD"]);
});

Deno.test("@hlvm/string - starts-with? true case", async () => {
  const code = `
    (import [starts-with?] from "@hlvm/string")
    (starts-with? "hello world" "hello")
  `;
  const result = await run(code);
  assertEquals(result, true);
});

Deno.test("@hlvm/string - starts-with? false case", async () => {
  const code = `
    (import [starts-with?] from "@hlvm/string")
    (starts-with? "hello world" "world")
  `;
  const result = await run(code);
  assertEquals(result, false);
});

Deno.test("@hlvm/string - ends-with? true case", async () => {
  const code = `
    (import [ends-with?] from "@hlvm/string")
    (ends-with? "hello world" "world")
  `;
  const result = await run(code);
  assertEquals(result, true);
});

Deno.test("@hlvm/string - ends-with? false case", async () => {
  const code = `
    (import [ends-with?] from "@hlvm/string")
    (ends-with? "hello world" "hello")
  `;
  const result = await run(code);
  assertEquals(result, false);
});

Deno.test("@hlvm/string - replace basic", async () => {
  const code = `
    (import [replace] from "@hlvm/string")
    (replace "hello world" "world" "there")
  `;
  const result = await run(code);
  assertEquals(result, "hello there");
});

Deno.test("@hlvm/string - replace with empty string", async () => {
  const code = `
    (import [replace] from "@hlvm/string")
    (replace "hello world" " world" "")
  `;
  const result = await run(code);
  assertEquals(result, "hello");
});
