// @ts-nocheck: Testing HQL package integration
// Test suite for @hlvm/date package

import { assertEquals } from "jsr:@std/assert@1";
import { assert } from "jsr:@std/assert@1";
import { run } from "./helpers.ts";

Deno.test("@hlvm/date - now returns timestamp", async () => {
  const code = `
    (import [now] from "@hlvm/date")
    (now)
  `;
  const result = await run(code);
  assert(typeof result === "number");
  assert(result > 1600000000000); // After Sep 2020
});

Deno.test("@hlvm/date - parse ISO string", async () => {
  const code = `
    (import [parse] from "@hlvm/date")
    (parse "2024-01-01T00:00:00.000Z")
  `;
  const result = await run(code);
  assertEquals(result, 1704067200000);
});

Deno.test("@hlvm/date - format timestamp", async () => {
  const code = `
    (import [format] from "@hlvm/date")
    (format 1704067200000)
  `;
  const result = await run(code);
  assertEquals(result, "2024-01-01T00:00:00.000Z");
});

Deno.test("@hlvm/date - add milliseconds", async () => {
  const code = `
    (import [add] from "@hlvm/date")
    (add 1704067200000 3600000)
  `;
  const result = await run(code);
  assertEquals(result, 1704070800000);
});

Deno.test("@hlvm/date - diff timestamps", async () => {
  const code = `
    (import [diff] from "@hlvm/date")
    (diff 1704070800000 1704067200000)
  `;
  const result = await run(code);
  assertEquals(result, 3600000);
});

Deno.test("@hlvm/date - parse and format roundtrip", async () => {
  const code = `
    (import [parse, format] from "@hlvm/date")
    (var timestamp (parse "2024-06-15T10:30:00.000Z"))
    (format timestamp)
  `;
  const result = await run(code);
  assertEquals(result, "2024-06-15T10:30:00.000Z");
});

Deno.test("@hlvm/date - multiple operations", async () => {
  const code = `
    (import [parse, add, diff, format] from "@hlvm/date")
    (var start (parse "2024-01-01T00:00:00.000Z"))
    (var end (add start 7200000))
    (var elapsed (diff end start))
    [elapsed (format end)]
  `;
  const result = await run(code);
  assertEquals(result, [7200000, "2024-01-01T02:00:00.000Z"]);
});

Deno.test("@hlvm/date - sequential runs keep imported fn bindings isolated", async () => {
  const first = await run(`
    (import [now] from "@hlvm/date")
    (now)
  `);
  assert(typeof first === "number");

  const second = await run(`
    (import [parse, format] from "@hlvm/date")
    (format (parse "2024-01-01T00:00:00.000Z"))
  `);
  assertEquals(second, "2024-01-01T00:00:00.000Z");
});
