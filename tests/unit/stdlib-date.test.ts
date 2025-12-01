// @ts-nocheck: Testing HQL package integration
// Test suite for @hql/date package

import { assertEquals } from "jsr:@std/assert@1";
import { assert } from "jsr:@std/assert@1";
import { run } from "./helpers.ts";

Deno.test("@hql/date - now returns timestamp", async () => {
  const code = `
    (import [now] from "@hql/date")
    (now)
  `;
  const result = await run(code);
  assert(typeof result === "number");
  assert(result > 1600000000000); // After Sep 2020
});

Deno.test("@hql/date - parse ISO string", async () => {
  const code = `
    (import [parse] from "@hql/date")
    (parse "2024-01-01T00:00:00.000Z")
  `;
  const result = await run(code);
  assertEquals(result, 1704067200000);
});

Deno.test("@hql/date - format timestamp", async () => {
  const code = `
    (import [format] from "@hql/date")
    (format 1704067200000)
  `;
  const result = await run(code);
  assertEquals(result, "2024-01-01T00:00:00.000Z");
});

Deno.test("@hql/date - add milliseconds", async () => {
  const code = `
    (import [add] from "@hql/date")
    (add 1704067200000 3600000)
  `;
  const result = await run(code);
  assertEquals(result, 1704070800000);
});

Deno.test("@hql/date - diff timestamps", async () => {
  const code = `
    (import [diff] from "@hql/date")
    (diff 1704070800000 1704067200000)
  `;
  const result = await run(code);
  assertEquals(result, 3600000);
});

Deno.test("@hql/date - parse and format roundtrip", async () => {
  const code = `
    (import [parse, format] from "@hql/date")
    (var timestamp (parse "2024-06-15T10:30:00.000Z"))
    (format timestamp)
  `;
  const result = await run(code);
  assertEquals(result, "2024-06-15T10:30:00.000Z");
});

Deno.test("@hql/date - now and format", async () => {
  const code = `
    (import [now, format] from "@hql/date")
    (var timestamp (now))
    (format timestamp)
  `;
  const result = await run(code);
  assert(typeof result === "string");
  assert(result.includes("T"));
  assert(result.includes("Z"));
});

Deno.test("@hql/date - add one day", async () => {
  const code = `
    (import [parse, add, format] from "@hql/date")
    (var start (parse "2024-01-01T00:00:00.000Z"))
    (var next-day (add start 86400000))
    (format next-day)
  `;
  const result = await run(code);
  assertEquals(result, "2024-01-02T00:00:00.000Z");
});

Deno.test("@hql/date - diff negative", async () => {
  const code = `
    (import [diff] from "@hql/date")
    (diff 1704067200000 1704070800000)
  `;
  const result = await run(code);
  assertEquals(result, -3600000);
});

Deno.test("@hql/date - multiple operations", async () => {
  const code = `
    (import [parse, add, diff, format] from "@hql/date")
    (var start (parse "2024-01-01T00:00:00.000Z"))
    (var end (add start 7200000))
    (var elapsed (diff end start))
    [elapsed (format end)]
  `;
  const result = await run(code);
  assertEquals(result, [7200000, "2024-01-01T02:00:00.000Z"]);
});
