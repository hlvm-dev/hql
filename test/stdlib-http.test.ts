// @ts-nocheck: Testing HQL package integration
// Test suite for @hql/http package
// NOTE: These tests verify function exports without requiring network access

import { assertEquals } from "jsr:@std/assert@1";
import { run } from "./helpers.ts";

Deno.test("@hql/http - request is exported as function", async () => {
  const code = `
    (import [request] from "@hql/http")
    (= (typeof request) "function")
  `;
  const result = await run(code);
  assertEquals(result, true);
});

Deno.test("@hql/http - get is exported as function", async () => {
  const code = `
    (import [get] from "@hql/http")
    (= (typeof get) "function")
  `;
  const result = await run(code);
  assertEquals(result, true);
});

Deno.test("@hql/http - post is exported as function", async () => {
  const code = `
    (import [post] from "@hql/http")
    (= (typeof post) "function")
  `;
  const result = await run(code);
  assertEquals(result, true);
});

Deno.test("@hql/http - all functions exported together", async () => {
  const code = `
    (import [request, get, post] from "@hql/http")
    (and (= (typeof request) "function")
         (= (typeof get) "function")
         (= (typeof post) "function"))
  `;
  const result = await run(code);
  assertEquals(result, true);
});
