/**
 * Web-RAG smoke benchmark (deterministic, network-free).
 * Purpose: catch regressions in stitched search -> dedupe -> diversity -> fetch formatting.
 */

import {
  assert,
  assertEquals,
  assertStringIncludes,
} from "jsr:@std/assert";
import { __testOnlyResetWebCache } from "../../src/hlvm/agent/web-cache.ts";
import {
  initSearchProviders,
  resetSearchProviderBootstrap,
} from "../../src/hlvm/agent/tools/web/search-provider-bootstrap.ts";
import { resetSearchProviders } from "../../src/hlvm/agent/tools/web/search-provider.ts";
import {
  __testOnlyFormatSearchWebResult,
  resetWebToolBudget,
  WEB_TOOLS,
} from "../../src/hlvm/agent/tools/web-tools.ts";
import { withTempHlvmDir } from "../unit/helpers.ts";

async function withStubbedFetch(
  stub: (input: string | URL | Request, init?: RequestInit) => Promise<Response>,
  fn: () => Promise<void>,
): Promise<void> {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = ((input: string | URL | Request, init?: RequestInit) =>
    stub(input, init)) as typeof globalThis.fetch;
  try {
    await fn();
  } finally {
    globalThis.fetch = originalFetch;
  }
}

function ddgHtml(results: Array<{ title: string; url: string; snippet: string }>): string {
  const lines: string[] = ["<html><body>"];
  for (const result of results) {
    lines.push(`<a class="result__a" href="${result.url}">${result.title}</a>`);
    lines.push(`<a class="result__snippet">${result.snippet}</a>`);
  }
  lines.push("</body></html>");
  return lines.join("");
}

Deno.test({
  name: "web-rag smoke benchmark: deterministic stitched web flow stays grounded",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    await withTempHlvmDir(async () => {
      await __testOnlyResetWebCache();
      resetSearchProviderBootstrap();
      resetSearchProviders();
      initSearchProviders();

      try {
        await withStubbedFetch(async (input) => {
          const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
          if (url.startsWith("https://html.duckduckgo.com/html/?")) {
            return new Response(ddgHtml([
              {
                title: "Home",
                url: "https://react.dev/reference/react/useEffect?utm_source=feed",
                snippet: "Short result copy.",
              },
              {
                title: "useEffect cleanup - React reference",
                url: "https://react.dev/reference/react/useEffect",
                snippet: "Official React reference for useEffect cleanup and cleanup timing details.",
              },
              {
                title: "Synchronizing with Effects - React",
                url: "https://react.dev/learn/synchronizing-with-effects",
                snippet: "Learn when React effects run and how cleanup works in practice.",
              },
              {
                title: "AbortController - MDN",
                url: "https://developer.mozilla.org/docs/Web/API/AbortController",
                snippet: "AbortController is commonly used to cancel fetches in React useEffect cleanup flows.",
              },
            ]), { status: 200, headers: { "content-type": "text/html" } });
          }
          if (url.startsWith("https://react.dev/reference/react/useEffect")) {
            return new Response(
              `<html><body><article><p>The cleanup function runs before the effect re-runs and after the component unmounts.</p></article></body></html>`,
              { status: 200, headers: { "content-type": "text/html" } },
            );
          }
          if (url === "https://react.dev/learn/synchronizing-with-effects") {
            return new Response(
              `<html><body><article><p>Effects synchronize components with external systems.</p></article></body></html>`,
              { status: 200, headers: { "content-type": "text/html" } },
            );
          }
          if (url === "https://developer.mozilla.org/docs/Web/API/AbortController") {
            return new Response(
              `<html><body><article><p>AbortController lets apps cancel fetch requests during React effect cleanup.</p></article></body></html>`,
              { status: 200, headers: { "content-type": "text/html" } },
            );
          }
          throw new Error(`Unexpected fetch: ${url}`);
        }, async () => {
          resetWebToolBudget();
          const raw = await WEB_TOOLS.search_web.fn(
            {
              query: "react useeffect cleanup",
              maxResults: 3,
              prefetch: true,
              reformulate: false,
            },
            "/tmp",
          ) as Record<string, unknown>;

          const results = raw.results as Array<Record<string, unknown>>;
          const diagnostics = raw.diagnostics as Record<string, unknown>;
          const prefetch = diagnostics.prefetch as Record<string, unknown>;
          const targetUrls = prefetch.targetUrls as string[];

          assertEquals(results.length, 3);
          assertEquals(results[0]?.title, "useEffect cleanup - React reference");
          assertEquals(
            results.filter((result) =>
              String(result.url ?? "").startsWith(
                "https://react.dev/reference/react/useEffect",
              )
            ).length,
            1,
          );
          assert(
            targetUrls[0]?.startsWith("https://react.dev/reference/react/useEffect"),
          );
          assertEquals(
            targetUrls[1],
            "https://developer.mozilla.org/docs/Web/API/AbortController",
          );
          assert(
            String(results[0]?.url ?? "").startsWith(
              "https://react.dev/reference/react/useEffect",
            ),
          );
          assertEquals(
            results[1]?.url,
            "https://developer.mozilla.org/docs/Web/API/AbortController",
          );
          assertEquals(results[0]?.selectedForFetch, true);
          assertEquals(results[1]?.selectedForFetch, true);
          assert(
            (results[0]?.passages as string[] | undefined)?.some((passage) =>
              /cleanup|effect/i.test(passage)
            ) ?? false,
          );

          const formatted = __testOnlyFormatSearchWebResult(raw);
          assert(formatted !== null);
          assertStringIncludes(formatted!.llmContent, "Fetched sources:");
          assertStringIncludes(
            formatted!.llmContent,
            "cleanup function runs before the effect re-runs",
          );
        });
      } finally {
        resetSearchProviderBootstrap();
        resetSearchProviders();
        await __testOnlyResetWebCache();
      }
    });
  },
});
