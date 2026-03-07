import { assertEquals } from "jsr:@std/assert";
import {
  getQueryToolAllowlist,
  WEB_RESEARCH_TOOL_ALLOWLIST,
} from "../../../src/hlvm/agent/query-tool-routing.ts";

Deno.test("query-tool-routing: explicit domains force web research tools", () => {
  const allowlist = getQueryToolAllowlist(
    "hello - go apple.com and find any new macbook stuff",
  );

  assertEquals(allowlist, [...WEB_RESEARCH_TOOL_ALLOWLIST]);
});

Deno.test("query-tool-routing: release-note style web queries prefer web tools", () => {
  const allowlist = getQueryToolAllowlist("latest React release notes");

  assertEquals(allowlist, [...WEB_RESEARCH_TOOL_ALLOWLIST]);
});

Deno.test("query-tool-routing: local code queries do not force web tools", () => {
  const allowlist = getQueryToolAllowlist(
    "search code for the release notes parser in src/",
  );

  assertEquals(allowlist, undefined);
});
