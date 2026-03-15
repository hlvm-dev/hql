import { assert, assertEquals } from "jsr:@std/assert";
import { registerDuckDuckGo } from "../../../src/hlvm/agent/tools/web/duckduckgo.ts";
import {
  resetSearchProviders,
  resolveSearchProvider,
  type SearchCallOptions,
} from "../../../src/hlvm/agent/tools/web/search-provider.ts";

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

async function withDuckDuckGoProvider(
  fn: (search: (query: string, opts: SearchCallOptions) => Promise<unknown>) => Promise<void>,
): Promise<void> {
  resetSearchProviders();
  registerDuckDuckGo();
  const provider = resolveSearchProvider("duckduckgo", false);
  try {
    await fn((query, opts) => provider.search(query, opts));
  } finally {
    resetSearchProviders();
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

Deno.test("duckduckgo search: low-confidence first page fetches page 2 once and merges results", async () => {
  const seenOffsets: Array<string | null> = [];

  await withStubbedFetch(async (input) => {
    const rawUrl = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const url = new URL(rawUrl);
    if (url.hostname !== "html.duckduckgo.com") {
      throw new Error(`Unexpected URL: ${rawUrl}`);
    }
    const offset = url.searchParams.get("s");
    seenOffsets.push(offset);

    if (offset === "30") {
      return new Response(ddgHtml([
        {
          title: "useEffect cleanup - React",
          url: "https://react.dev/reference/react/useEffect",
          snippet: "Official React reference for useEffect cleanup and cleanup function behavior.",
        },
        {
          title: "AbortController - MDN",
          url: "https://developer.mozilla.org/docs/Web/API/AbortController",
          snippet: "AbortController is commonly used to cancel fetches in React useEffect cleanup flows.",
        },
      ]), { status: 200, headers: { "content-type": "text/html" } });
    }

    return new Response(ddgHtml([
      {
        title: "Frontend patterns",
        url: "https://blog.example.com/frontend-patterns",
        snippet: "General component patterns and UI notes.",
      },
    ]), { status: 200, headers: { "content-type": "text/html" } });
  }, async () => {
    await withDuckDuckGoProvider(async (search) => {
      const response = await search("react useeffect cleanup", {
        limit: 3,
        timeRange: "all",
      }) as {
        count: number;
        results: Array<{ url?: string }>;
        diagnostics?: Record<string, unknown>;
      };

      assertEquals(seenOffsets, [null, "30"]);
      assertEquals(response.count, 3);
      assertEquals(response.results.some((result) => result.url === "https://react.dev/reference/react/useEffect"), true);
      assertEquals((response.diagnostics?.page2RetryTriggered as boolean) ?? false, true);
      assertEquals((response.diagnostics?.page2Fetched as boolean) ?? false, true);
      assertEquals((response.diagnostics?.initialLowConfidence as boolean) ?? false, true);
      assertEquals((response.diagnostics?.mergedLowConfidence as boolean) ?? true, false);
    });
  });
});

Deno.test("duckduckgo search: high-confidence first page stays single page", async () => {
  const seenOffsets: Array<string | null> = [];

  await withStubbedFetch(async (input) => {
    const rawUrl = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const url = new URL(rawUrl);
    seenOffsets.push(url.searchParams.get("s"));
    return new Response(ddgHtml([
      {
        title: "useEffect cleanup - React reference",
        url: "https://react.dev/reference/react/useEffect",
        snippet: "Official React reference for useEffect cleanup, dependencies, and cleanup timing details.",
      },
      {
        title: "Synchronizing with Effects - React",
        url: "https://react.dev/learn/synchronizing-with-effects",
        snippet: "Learn when React effects run and how cleanup works in practice.",
      },
    ]), { status: 200, headers: { "content-type": "text/html" } });
  }, async () => {
    await withDuckDuckGoProvider(async (search) => {
      const response = await search("react useeffect cleanup", {
        limit: 3,
        timeRange: "all",
      }) as { diagnostics?: Record<string, unknown> };

      assertEquals(seenOffsets, [null]);
      assertEquals((response.diagnostics?.page2RetryTriggered as boolean) ?? true, false);
      assertEquals((response.diagnostics?.page2Fetched as boolean) ?? true, false);
    });
  });
});

Deno.test("duckduckgo search: bing fallback does not attempt page 2 recovery", async () => {
  const seenUrls: string[] = [];

  await withStubbedFetch(async (input) => {
    const rawUrl = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    seenUrls.push(rawUrl);
    const url = new URL(rawUrl);
    if (url.hostname === "html.duckduckgo.com") {
      return new Response(
        "<html><body><div class=\"anomaly-modal\">Unfortunately, bots use DuckDuckGo too</div></body></html>",
        { status: 200, headers: { "content-type": "text/html" } },
      );
    }
    if (url.hostname === "www.bing.com") {
      return new Response(
        `
          <html><body>
            <li class="b_algo">
              <h2><a href="https://example.com/unfocused">Generic result</a></h2>
              <div class="b_caption"><p>General frontend guide.</p></div>
            </li>
          </body></html>
        `,
        { status: 200, headers: { "content-type": "text/html" } },
      );
    }
    throw new Error(`Unexpected URL: ${rawUrl}`);
  }, async () => {
    await withDuckDuckGoProvider(async (search) => {
      const response = await search("react useeffect cleanup", {
        limit: 3,
        timeRange: "all",
      }) as { provider: string; diagnostics?: Record<string, unknown> };

      assertEquals(response.provider, "bing-html");
      assertEquals((response.diagnostics?.page2RetryTriggered as boolean) ?? true, false);
      assertEquals(seenUrls.some((url) => url.includes("html.duckduckgo.com") && url.includes("s=30")), false);
    });
  });
});
