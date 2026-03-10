import { assertEquals } from "jsr:@std/assert";
import { resolveQueryToolAllowlist } from "../../../src/hlvm/agent/query-tool-routing.ts";

Deno.test("query-tool-routing: preserves explicit allowlists and removes duplicates", () => {
  const allowlist = resolveQueryToolAllowlist(
    "macbook pro m5 max price",
    ["search_web", "web_fetch", "search_web"],
  );

  assertEquals(allowlist, ["search_web", "web_fetch"]);
});

Deno.test("query-tool-routing: no longer infers tool routing from query text", () => {
  const allowlist = resolveQueryToolAllowlist(
    "official docs: what does the TaskGroup class do in Python asyncio?",
  );

  assertEquals(allowlist, undefined);
});
