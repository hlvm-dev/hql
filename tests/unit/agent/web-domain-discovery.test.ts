import { assert, assertEquals } from "jsr:@std/assert";
import { discoverAllowedDomainResults } from "../../../src/hlvm/agent/tools/web/domain-discovery.ts";
import { detectSearchQueryIntent } from "../../../src/hlvm/agent/tools/web/query-strategy.ts";

function response(
  body: string,
  contentType: string,
  status = 200,
): Response {
  return new Response(body, {
    status,
    headers: { "Content-Type": contentType },
  });
}

function requestUrl(input: string | URL | Request): string {
  return typeof input === "string"
    ? input
    : input instanceof URL
    ? input.href
    : input.url;
}

async function withStubbedFetch(
  stub: (
    input: string | URL | Request,
    init?: RequestInit,
  ) => Promise<Response>,
  fn: () => Promise<void>,
): Promise<void> {
  const originalFetch = globalThis.fetch;
  globalThis.fetch =
    ((input: string | URL | Request, init?: RequestInit) =>
      stub(input, init)) as typeof globalThis.fetch;
  try {
    await fn();
  } finally {
    globalThis.fetch = originalFetch;
  }
}

async function runDiscovery(
  query: string,
  maxResults: number,
): Promise<Awaited<ReturnType<typeof discoverAllowedDomainResults>>> {
  return await discoverAllowedDomainResults({
    query,
    allowedDomains: ["docs.example.com"],
    maxResults,
    intent: detectSearchQueryIntent(query),
    fetchUserAgent: "HLVM-Test",
  });
}

Deno.test("web domain discovery uses robots.txt sitemap hints before later fallbacks", async () => {
  const seen: string[] = [];

  await withStubbedFetch(async (input) => {
    const url = requestUrl(input);
    seen.push(url);

    if (url === "https://docs.example.com/robots.txt") {
      return response(
        "User-agent: *\nSitemap: https://docs.example.com/custom-sitemap.xml\n",
        "text/plain",
      );
    }

    if (url === "https://docs.example.com/custom-sitemap.xml") {
      return response(
        `<?xml version="1.0" encoding="UTF-8"?>
        <urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
          <url><loc>https://docs.example.com/docs/authentication</loc></url>
          <url><loc>https://docs.example.com/reference/authentication-api</loc></url>
          <url><loc>https://docs.example.com/privacy</loc></url>
        </urlset>`,
        "application/xml",
      );
    }

    return response("not found", "text/plain", 404);
  }, async () => {
    const discovered = await runDiscovery(
      "official docs authentication",
      2,
    );

    assertEquals(seen, [
      "https://docs.example.com/robots.txt",
      "https://docs.example.com/custom-sitemap.xml",
    ]);
    assertEquals(
      discovered.results.map((result) => result.url),
      [
        "https://docs.example.com/docs/authentication",
        "https://docs.example.com/reference/authentication-api",
      ],
    );
    assertEquals(discovered.diagnostics.fetchedSeedUrls, seen);
  });
});

Deno.test("web domain discovery expands sitemap indexes from default sitemap.xml", async () => {
  const seen: string[] = [];

  await withStubbedFetch(async (input) => {
    const url = requestUrl(input);
    seen.push(url);

    if (url === "https://docs.example.com/robots.txt") {
      return response("User-agent: *\nDisallow:\n", "text/plain");
    }

    if (url === "https://docs.example.com/sitemap.xml") {
      return response(
        `<?xml version="1.0" encoding="UTF-8"?>
        <sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
          <sitemap><loc>https://docs.example.com/sitemaps/docs.xml</loc></sitemap>
          <sitemap><loc>https://docs.example.com/sitemaps/reference.xml</loc></sitemap>
        </sitemapindex>`,
        "application/xml",
      );
    }

    if (url === "https://docs.example.com/sitemaps/docs.xml") {
      return response(
        `<?xml version="1.0" encoding="UTF-8"?>
        <urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
          <url><loc>https://docs.example.com/docs/authentication</loc></url>
          <url><loc>https://docs.example.com/docs/authorization</loc></url>
        </urlset>`,
        "application/xml",
      );
    }

    if (url === "https://docs.example.com/sitemaps/reference.xml") {
      return response(
        `<?xml version="1.0" encoding="UTF-8"?>
        <urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
          <url><loc>https://docs.example.com/reference/authentication-api</loc></url>
          <url><loc>https://docs.example.com/reference/authorization-api</loc></url>
        </urlset>`,
        "application/xml",
      );
    }

    return response("not found", "text/plain", 404);
  }, async () => {
    const discovered = await runDiscovery(
      "official authentication authorization reference",
      3,
    );

    assertEquals(seen, [
      "https://docs.example.com/robots.txt",
      "https://docs.example.com/sitemap.xml",
      "https://docs.example.com/sitemaps/docs.xml",
      "https://docs.example.com/sitemaps/reference.xml",
    ]);
    assertEquals(
      discovered.results.map((result) => result.url),
      [
        "https://docs.example.com/reference/authentication-api",
        "https://docs.example.com/reference/authorization-api",
        "https://docs.example.com/docs/authentication",
      ],
    );
  });
});

Deno.test("web domain discovery falls back to homepage nav crawling when sitemaps are unavailable", async () => {
  const seen: string[] = [];

  await withStubbedFetch(async (input) => {
    const url = requestUrl(input);
    seen.push(url);

    if (url === "https://docs.example.com/robots.txt") {
      return response("not found", "text/plain", 404);
    }

    if (url === "https://docs.example.com/sitemap.xml") {
      return response("not found", "text/plain", 404);
    }

    if (url === "https://docs.example.com") {
      return response(
        `<html><head><title>Example Docs</title></head><body>
          <nav>
            <a href="/docs">Documentation</a>
            <a href="/learn">Learn</a>
          </nav>
        </body></html>`,
        "text/html",
      );
    }

    if (url === "https://docs.example.com/docs") {
      return response(
        `<html><head><title>Documentation</title></head><body>
          <nav>
            <a href="/docs/authentication">Authentication</a>
            <a href="/docs/authorization">Authorization</a>
          </nav>
        </body></html>`,
        "text/html",
      );
    }

    if (url === "https://docs.example.com/learn") {
      return response(
        `<html><head><title>Learn</title></head><body>
          <nav>
            <a href="/learn/getting-started">Getting Started</a>
          </nav>
        </body></html>`,
        "text/html",
      );
    }

    return response("not found", "text/plain", 404);
  }, async () => {
    const discovered = await runDiscovery(
      "official docs authentication authorization",
      2,
    );

    assertEquals(
      discovered.results.map((result) => result.url),
      [
        "https://docs.example.com/docs/authentication",
        "https://docs.example.com/docs/authorization",
      ],
    );
    assert(seen.includes("https://docs.example.com"));
    assert(seen.includes("https://docs.example.com/docs"));
  });
});

Deno.test("web domain discovery suppresses boilerplate links so noisy homepage links do not dominate", async () => {
  await withStubbedFetch(async (input) => {
    const url = requestUrl(input);

    if (url === "https://docs.example.com/robots.txt") {
      return response("not found", "text/plain", 404);
    }

    if (url === "https://docs.example.com/sitemap.xml") {
      return response("not found", "text/plain", 404);
    }

    if (url === "https://docs.example.com") {
      return response(
        `<html><head><title>Platform</title></head><body>
          <nav>
            <a href="/pricing">Platform Pricing</a>
            <a href="/about">About Platform</a>
            <a href="/privacy">Privacy Policy</a>
            <a href="/contact">Contact</a>
            <a href="/docs/getting-started">Platform Docs</a>
            <a href="/reference/authentication-api">Authentication API</a>
          </nav>
        </body></html>`,
        "text/html",
      );
    }

    return response(
      `<html><body><nav><a href="/docs/getting-started">Platform Docs</a></nav></body></html>`,
      "text/html",
    );
  }, async () => {
    const discovered = await runDiscovery(
      "official platform docs",
      2,
    );

    assertEquals(
      discovered.results.map((result) => result.url),
      [
        "https://docs.example.com/docs/getting-started",
        "https://docs.example.com/reference/authentication-api",
      ],
    );
    assert(
      discovered.results.every((result) =>
        !["/pricing", "/about", "/privacy", "/contact"].some((suffix) =>
          result.url?.endsWith(suffix)
        )
      ),
    );
  });
});
