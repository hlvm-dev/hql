// @ts-nocheck: Testing HQL package integration
// Test suite for @hlvm/http package
// NOTE: These tests verify function exports without requiring network access

import { assertEquals } from "jsr:@std/assert@1";
import { run } from "./helpers.ts";

Deno.test("@hlvm/http - request is exported as function", async () => {
  const code = `
    (import [request] from "@hlvm/http")
    (=== (typeof request) "function")
  `;
  const result = await run(code);
  assertEquals(result, true);
});

Deno.test("@hlvm/http - get is exported as function", async () => {
  const code = `
    (import [get] from "@hlvm/http")
    (=== (typeof get) "function")
  `;
  const result = await run(code);
  assertEquals(result, true);
});

Deno.test("@hlvm/http - post is exported as function", async () => {
  const code = `
    (import [post] from "@hlvm/http")
    (=== (typeof post) "function")
  `;
  const result = await run(code);
  assertEquals(result, true);
});

Deno.test("@hlvm/http - all functions exported together", async () => {
  const code = `
    (import [request, get, post] from "@hlvm/http")
    (and (=== (typeof request) "function")
         (=== (typeof get) "function")
         (=== (typeof post) "function"))
  `;
  const result = await run(code);
  assertEquals(result, true);
});
