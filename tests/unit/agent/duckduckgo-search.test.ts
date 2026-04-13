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
      // Follow-up queries should also be skipped on high confidence
      assertEquals((response.diagnostics?.followupQueries as string[])?.length ?? 0, 0);
      assertEquals(response.diagnostics?.followupFetched ?? false, false);
    });
  });
});

Deno.test("duckduckgo search: DuckDuckGo page parsing respects requested limit", async () => {
  await withStubbedFetch(async (input) => {
    const rawUrl = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const url = new URL(rawUrl);
    if (url.hostname !== "html.duckduckgo.com") {
      throw new Error(`Unexpected URL: ${rawUrl}`);
    }
    return new Response(ddgHtml([
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
  }, async () => {
    await withDuckDuckGoProvider(async (search) => {
      const response = await search("react useeffect cleanup", {
        limit: 1,
        timeRange: "all",
      }) as { count: number; diagnostics?: Record<string, unknown> };

      assertEquals(response.count, 1);
      assertEquals(response.diagnostics?.page1ParsedCount, 1);
      assertEquals((response.diagnostics?.page2RetryTriggered as boolean) ?? true, false);
    });
  });
});

Deno.test("duckduckgo search: Bing fallback parsing respects requested limit", async () => {
  await withStubbedFetch(async (input) => {
    const rawUrl = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const url = new URL(rawUrl);
    if (url.hostname === "html.duckduckgo.com") {
      return new Response(
        "<html><body><div class=\"anomaly-modal\">challenge</div></body></html>",
        { status: 200, headers: { "content-type": "text/html" } },
      );
    }
    if (url.hostname === "www.bing.com") {
      return new Response(`
        <html><body>
          <li class="b_algo">
            <h2><a href="https://react.dev/reference/react/useEffect">useEffect cleanup - React reference</a></h2>
            <div class="b_caption"><p>Official React reference for useEffect cleanup and cleanup timing details.</p></div>
          </li>
          <li class="b_algo">
            <h2><a href="https://react.dev/learn/synchronizing-with-effects">Synchronizing with Effects - React</a></h2>
            <div class="b_caption"><p>Learn when React effects run and how cleanup works in practice.</p></div>
          </li>
          <li class="b_algo">
            <h2><a href="https://developer.mozilla.org/docs/Web/API/AbortController">AbortController - MDN</a></h2>
            <div class="b_caption"><p>AbortController is commonly used to cancel fetches in React useEffect cleanup flows.</p></div>
          </li>
        </body></html>
      `, { status: 200, headers: { "content-type": "text/html" } });
    }
    throw new Error(`Unexpected URL: ${rawUrl}`);
  }, async () => {
    await withDuckDuckGoProvider(async (search) => {
      const response = await search("react useeffect cleanup", {
        limit: 1,
        timeRange: "all",
      }) as {
        count: number;
        provider: string;
        diagnostics?: Record<string, unknown>;
      };

      assertEquals(response.provider, "bing-html");
      assertEquals(response.count, 1);
      assertEquals(response.diagnostics?.page1ParsedCount, 1);
    });
  });
});

// ============================================================
// Follow-up Query Tests
// ============================================================

Deno.test("duckduckgo search: follow-up queries trigger on merged low confidence after page-2", async () => {
  const seenQueries: string[] = [];

  await withStubbedFetch(async (input) => {
    const rawUrl = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const url = new URL(rawUrl);
    if (url.hostname !== "html.duckduckgo.com") {
      throw new Error(`Unexpected URL: ${rawUrl}`);
    }
    seenQueries.push(url.searchParams.get("q") ?? "");

    // Return a single low-quality result for ALL queries (page 1, page 2, and follow-ups)
    // so that confidence stays low after page-2 and follow-ups get triggered.
    return new Response(ddgHtml([
      {
        title: "Unrelated blog post",
        url: `https://blog.example.com/post-${seenQueries.length}`,
        snippet: "This is a generic blog about random topics.",
      },
    ]), { status: 200, headers: { "content-type": "text/html" } });
  }, async () => {
    await withDuckDuckGoProvider(async (search) => {
      const response = await search("react useeffect cleanup best practices", {
        limit: 5,
        timeRange: "all",
      }) as { diagnostics?: Record<string, unknown> };

      // Should have more than 2 queries (page 1 + page 2 + at least 1 follow-up)
      assert(seenQueries.length > 2, `Expected >2 queries, got ${seenQueries.length}: ${JSON.stringify(seenQueries)}`);
      const followupQueriesDiag = response.diagnostics?.followupQueries as string[] | undefined;
      assert(
        followupQueriesDiag && followupQueriesDiag.length > 0,
        `Expected follow-up queries in diagnostics, got: ${JSON.stringify(followupQueriesDiag)}`,
      );
      assertEquals(
        new Set(followupQueriesDiag).size,
        followupQueriesDiag.length,
      );
      for (const query of followupQueriesDiag) {
        const normalized = query.trim().toLowerCase();
        assert(normalized.length > 0, `Follow-up query should not be empty: ${query}`);
        assert(
          normalized !== "react useeffect cleanup best practices",
          `Follow-up query should differ from the original query: ${query}`,
        );
        const anchorMatches = ["react", "useeffect", "cleanup"].filter((token) =>
          normalized.includes(token)
        );
        assert(
          anchorMatches.length >= 2,
          `Follow-up query drifted away from the original topic: ${query}`,
        );
      }
      assertEquals(response.diagnostics?.followupFetched, true);
    });
  });
});

Deno.test("duckduckgo search: reformulate false suppresses follow-up queries after page-2", async () => {
  const seenQueries: string[] = [];

  await withStubbedFetch(async (input) => {
    const rawUrl = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const url = new URL(rawUrl);
    if (url.hostname !== "html.duckduckgo.com") {
      throw new Error(`Unexpected URL: ${rawUrl}`);
    }
    seenQueries.push(url.searchParams.get("q") ?? "");

    return new Response(ddgHtml([
      {
        title: "Unrelated blog post",
        url: `https://blog.example.com/post-${seenQueries.length}`,
        snippet: "This is a generic blog about random topics.",
      },
    ]), { status: 200, headers: { "content-type": "text/html" } });
  }, async () => {
    await withDuckDuckGoProvider(async (search) => {
      const response = await search("react useeffect cleanup best practices", {
        limit: 5,
        timeRange: "all",
        reformulate: false,
      }) as { diagnostics?: Record<string, unknown> };

      assertEquals(seenQueries.length, 2);
      assertEquals((response.diagnostics?.followupQueries as string[])?.length ?? 0, 0);
      assertEquals(response.diagnostics?.followupFetched, false);
    });
  });
});
