import { assertEquals } from "jsr:@std/assert";
import {
  extractWebSearchQueryCandidate,
  getQueryToolAllowlist,
  shouldShortCircuitWeakTierWebQuery,
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

Deno.test("query-tool-routing: explicit web-only instructions override local-code keywords", () => {
  const allowlist = getQueryToolAllowlist(
    "Search the public web only. Do not inspect local files or repository code. Answer with citations from the web: What does the useEffect cleanup function do in React?",
  );

  assertEquals(allowlist, [...WEB_RESEARCH_TOOL_ALLOWLIST]);
});

Deno.test("query-tool-routing: official docs questions override ambiguous code nouns", () => {
  const allowlist = getQueryToolAllowlist(
    "official docs: what does the TaskGroup class do in Python asyncio?",
  );

  assertEquals(allowlist, [...WEB_RESEARCH_TOOL_ALLOWLIST]);
});

Deno.test("query-tool-routing: web-search instructions override ambiguous code nouns", () => {
  const allowlist = getQueryToolAllowlist(
    "Use web search to explain what the useEffect cleanup function does in React docs",
  );

  assertEquals(allowlist, [...WEB_RESEARCH_TOOL_ALLOWLIST]);
});

Deno.test("query-tool-routing: extractWebSearchQueryCandidate keeps the actual question", () => {
  const query = extractWebSearchQueryCandidate(
    "Search the public web only. Do not inspect local files or repository code. Answer with citations from the web: What does the useEffect cleanup function do in React?",
  );

  assertEquals(
    query,
    "What does the useEffect cleanup function do in React?",
  );
});

Deno.test("query-tool-routing: extractWebSearchQueryCandidate preserves authoritative qualifiers that change retrieval intent", () => {
  const query = extractWebSearchQueryCandidate(
    "official docs: what does the TaskGroup class do in Python asyncio?",
  );

  assertEquals(
    query,
    "official docs what does the TaskGroup class do in Python asyncio?",
  );
});

Deno.test("query-tool-routing: weak-tier web short-circuit recognizes docs intent without explicit web-only phrasing", () => {
  const shouldShortCircuit = shouldShortCircuitWeakTierWebQuery(
    "official docs: what does the TaskGroup class do in Python asyncio?",
  );

  assertEquals(shouldShortCircuit, true);
});

Deno.test("query-tool-routing: weak-tier web short-circuit does not hijack local code prompts", () => {
  const shouldShortCircuit = shouldShortCircuitWeakTierWebQuery(
    "find the TaskGroup class in src/runtime and explain how it works",
  );

  assertEquals(shouldShortCircuit, false);
});
