import { assertEquals, assertExists } from "jsr:@std/assert";
import { createRouter } from "../../../src/hlvm/cli/repl/http-router.ts";

Deno.test("http router: exact routes and parameterized routes both match with decoded params", () => {
  const router = createRouter();
  router.add("GET", "/api/sessions", () => new Response("ok"));
  router.add("GET", "/api/sessions/:id", () => new Response("session"));
  router.add("GET", "/api/sessions/:id/messages/:messageId", () => new Response("message"));

  const exact = router.match("GET", "/api/sessions");
  const single = router.match("GET", "/api/sessions/hello%20world");
  const multiple = router.match("GET", "/api/sessions/sess-1/messages/42");

  assertExists(exact);
  assertEquals(exact.params, {});
  assertExists(single);
  assertEquals(single.params.id, "hello world");
  assertExists(multiple);
  assertEquals(multiple.params.id, "sess-1");
  assertEquals(multiple.params.messageId, "42");
});

Deno.test("http router: mismatched methods and paths do not match", () => {
  const router = createRouter();
  router.add("POST", "/api/sessions", () => new Response("ok"));
  router.add("GET", "/api/sessions/:id", () => new Response("ok"));

  assertEquals(router.match("GET", "/api/sessions"), null);
  assertEquals(router.match("GET", "/api/users"), null);
  assertEquals(router.match("GET", "/api/sessions"), null);
  assertEquals(router.match("GET", "/api/sessions/abc/extra"), null);
  assertEquals(createRouter().match("GET", "/anything"), null);
});

Deno.test("http router: method matching is case-insensitive and keeps methods distinct on the same path", () => {
  const router = createRouter();
  router.add("get", "/api/test", () => new Response("ok"));
  router.add("GET", "/api/sessions/:id", () => new Response("get"));
  router.add("DELETE", "/api/sessions/:id", () => new Response("delete"));
  router.add("PATCH", "/api/sessions/:id", () => new Response("patch"));

  assertExists(router.match("GET", "/api/test"));
  assertExists(router.match("get", "/api/test"));
  assertExists(router.match("GET", "/api/sessions/1"));
  assertExists(router.match("DELETE", "/api/sessions/1"));
  assertExists(router.match("PATCH", "/api/sessions/1"));
  assertEquals(router.match("POST", "/api/sessions/1"), null);
});

Deno.test("http router: the first matching route wins when patterns overlap", () => {
  const router = createRouter();
  let hitFirst = false;
  let hitSecond = false;
  router.add("GET", "/api/sessions/:id", () => {
    hitFirst = true;
    return new Response("first");
  });
  router.add("GET", "/api/sessions/:name", () => {
    hitSecond = true;
    return new Response("second");
  });

  const match = router.match("GET", "/api/sessions/abc");
  assertExists(match);
  match.handler(new Request("http://localhost/"), match.params);
  assertEquals(hitFirst, true);
  assertEquals(hitSecond, false);
});
