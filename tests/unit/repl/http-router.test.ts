/**
 * HTTP Router Tests
 *
 * Verifies route matching, param extraction, method filtering, and edge cases.
 */

import { assertEquals, assertExists } from "jsr:@std/assert";
import { createRouter } from "../../../src/hlvm/cli/repl/http-router.ts";

Deno.test({
  name: "Router: exact path match",
  fn() {
    const router = createRouter();
    router.add("GET", "/api/sessions", () => new Response("ok"));

    const match = router.match("GET", "/api/sessions");
    assertExists(match);
    assertEquals(Object.keys(match!.params).length, 0);
  },
});

Deno.test({
  name: "Router: single param extraction",
  fn() {
    const router = createRouter();
    router.add("GET", "/api/sessions/:id", () => new Response("ok"));

    const match = router.match("GET", "/api/sessions/abc-123");
    assertExists(match);
    assertEquals(match!.params.id, "abc-123");
  },
});

Deno.test({
  name: "Router: multiple param extraction",
  fn() {
    const router = createRouter();
    router.add("GET", "/api/sessions/:id/messages/:messageId", () => new Response("ok"));

    const match = router.match("GET", "/api/sessions/sess-1/messages/42");
    assertExists(match);
    assertEquals(match!.params.id, "sess-1");
    assertEquals(match!.params.messageId, "42");
  },
});

Deno.test({
  name: "Router: method mismatch returns null",
  fn() {
    const router = createRouter();
    router.add("POST", "/api/sessions", () => new Response("ok"));

    assertEquals(router.match("GET", "/api/sessions"), null);
  },
});

Deno.test({
  name: "Router: path mismatch returns null",
  fn() {
    const router = createRouter();
    router.add("GET", "/api/sessions", () => new Response("ok"));

    assertEquals(router.match("GET", "/api/users"), null);
  },
});

Deno.test({
  name: "Router: segment count mismatch returns null",
  fn() {
    const router = createRouter();
    router.add("GET", "/api/sessions/:id", () => new Response("ok"));

    assertEquals(router.match("GET", "/api/sessions"), null);
    assertEquals(router.match("GET", "/api/sessions/abc/extra"), null);
  },
});

Deno.test({
  name: "Router: no routes returns null",
  fn() {
    const router = createRouter();
    assertEquals(router.match("GET", "/anything"), null);
  },
});

Deno.test({
  name: "Router: method matching is case-insensitive",
  fn() {
    const router = createRouter();
    router.add("get", "/api/test", () => new Response("ok"));

    assertExists(router.match("GET", "/api/test"));
    assertExists(router.match("get", "/api/test"));
  },
});

Deno.test({
  name: "Router: URL-encoded params are decoded",
  fn() {
    const router = createRouter();
    router.add("GET", "/api/sessions/:id", () => new Response("ok"));

    const match = router.match("GET", "/api/sessions/hello%20world");
    assertExists(match);
    assertEquals(match!.params.id, "hello world");
  },
});

Deno.test({
  name: "Router: first matching route wins",
  fn() {
    const router = createRouter();
    let hitFirst = false;
    let hitSecond = false;
    router.add("GET", "/api/sessions/:id", () => { hitFirst = true; return new Response("first"); });
    router.add("GET", "/api/sessions/:name", () => { hitSecond = true; return new Response("second"); });

    const match = router.match("GET", "/api/sessions/abc");
    assertExists(match);
    match!.handler(new Request("http://localhost/"), match!.params);
    assertEquals(hitFirst, true);
    assertEquals(hitSecond, false);
  },
});

Deno.test({
  name: "Router: same path different methods",
  fn() {
    const router = createRouter();
    router.add("GET", "/api/sessions/:id", () => new Response("get"));
    router.add("DELETE", "/api/sessions/:id", () => new Response("delete"));
    router.add("PATCH", "/api/sessions/:id", () => new Response("patch"));

    assertExists(router.match("GET", "/api/sessions/1"));
    assertExists(router.match("DELETE", "/api/sessions/1"));
    assertExists(router.match("PATCH", "/api/sessions/1"));
    assertEquals(router.match("POST", "/api/sessions/1"), null);
  },
});
