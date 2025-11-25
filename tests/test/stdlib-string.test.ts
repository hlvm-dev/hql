// @ts-nocheck: Testing HQL package integration
// Test suite for @hql/string package
// Tests embedded stdlib package imports using @hql/string syntax

import { assertEquals } from "jsr:@std/assert@1";
import { run } from "./helpers.ts";

Deno.test("@hql/string - split basic", async () => {
  const code = `
    (import [split] from "@hql/string")
    (split "a,b,c" ",")
  `;
  const result = await run(code);
  assertEquals(result, ["a", "b", "c"]);
});

Deno.test("@hql/string - split with different separator", async () => {
  const code = `
    (import [split] from "@hql/string")
    (split "hello-world-test" "-")
  `;
  const result = await run(code);
  assertEquals(result, ["hello", "world", "test"]);
});

Deno.test("@hql/string - join basic", async () => {
  const code = `
    (import [join] from "@hql/string")
    (join ["x" "y" "z"] "-")
  `;
  const result = await run(code);
  assertEquals(result, "x-y-z");
});

Deno.test("@hql/string - join with space", async () => {
  const code = `
    (import [join] from "@hql/string")
    (join ["hello" "world"] " ")
  `;
  const result = await run(code);
  assertEquals(result, "hello world");
});

Deno.test("@hql/string - trim whitespace", async () => {
  const code = `
    (import [trim] from "@hql/string")
    (trim "  hello  ")
  `;
  const result = await run(code);
  assertEquals(result, "hello");
});

Deno.test("@hql/string - upper-case", async () => {
  const code = `
    (import [upper-case] from "@hql/string")
    (upper-case "hello")
  `;
  const result = await run(code);
  assertEquals(result, "HELLO");
});

Deno.test("@hql/string - lower-case", async () => {
  const code = `
    (import [lower-case] from "@hql/string")
    (lower-case "WORLD")
  `;
  const result = await run(code);
  assertEquals(result, "world");
});

Deno.test("@hql/string - multiple imports together", async () => {
  const code = `
    (import [split, join, trim] from "@hql/string")
    (var parts (split "  a , b , c  " ","))
    (var trimmed (doall (map trim parts)))
    (join trimmed "-")
  `;
  const result = await run(code);
  assertEquals(result, "a-b-c");
});

Deno.test("@hql/string - aliased import", async () => {
  const code = `
    (import [split as str-split] from "@hql/string")
    (str-split "foo:bar" ":")
  `;
  const result = await run(code);
  assertEquals(result, ["foo", "bar"]);
});

Deno.test("@hql/string - works with core functions", async () => {
  const code = `
    (import [split, upper-case] from "@hql/string")
    (var words (split "hello world" " "))
    (doall (map upper-case words))
  `;
  const result = await run(code);
  assertEquals(result, ["HELLO", "WORLD"]);
});

Deno.test("@hql/string - starts-with? true case", async () => {
  const code = `
    (import [starts-with?] from "@hql/string")
    (starts-with? "hello world" "hello")
  `;
  const result = await run(code);
  assertEquals(result, true);
});

Deno.test("@hql/string - starts-with? false case", async () => {
  const code = `
    (import [starts-with?] from "@hql/string")
    (starts-with? "hello world" "world")
  `;
  const result = await run(code);
  assertEquals(result, false);
});

Deno.test("@hql/string - ends-with? true case", async () => {
  const code = `
    (import [ends-with?] from "@hql/string")
    (ends-with? "hello world" "world")
  `;
  const result = await run(code);
  assertEquals(result, true);
});

Deno.test("@hql/string - ends-with? false case", async () => {
  const code = `
    (import [ends-with?] from "@hql/string")
    (ends-with? "hello world" "hello")
  `;
  const result = await run(code);
  assertEquals(result, false);
});

Deno.test("@hql/string - replace basic", async () => {
  const code = `
    (import [replace] from "@hql/string")
    (replace "hello world" "world" "there")
  `;
  const result = await run(code);
  assertEquals(result, "hello there");
});

Deno.test("@hql/string - replace with empty string", async () => {
  const code = `
    (import [replace] from "@hql/string")
    (replace "hello world" " world" "")
  `;
  const result = await run(code);
  assertEquals(result, "hello");
});
