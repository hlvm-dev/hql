/**
 * Web RAG Competitive E2E Benchmark
 *
 * Purpose:
 * - Validate advanced web-RAG capabilities expected in modern frontier CLIs
 *   (Codex / Claude Code / Gemini CLI / OpenClaw-style flows).
 * - Provide deterministic, infra-light E2E gates for core behavior.
 *
 * Notes:
 * - Uses a deterministic fake search provider to avoid flaky internet/search index behavior.
 * - Uses data: URLs for fetch-path determinism.
 */

import { assertEquals, assertRejects } from "jsr:@std/assert";
import type { AgentPolicy } from "../../src/hlvm/agent/policy.ts";
import type { SearchCallOptions } from "../../src/hlvm/agent/tools/web/search-provider.ts";
import {
  isAllowedByDomainFilters,
  registerSearchProvider,
  resolveSearchProvider,
  resetSearchProviders,
} from "../../src/hlvm/agent/tools/web/search-provider.ts";
import {
  initSearchProviders,
  resetSearchProviderBootstrap,
} from "../../src/hlvm/agent/tools/web/search-provider-bootstrap.ts";
import {
  canonicalizeResultUrl,
  rankSearchResults,
} from "../../src/hlvm/agent/tools/web/search-ranking.ts";
import { __testOnlyBuildSearchWebCacheKey, WEB_TOOLS } from "../../src/hlvm/agent/tools/web-tools.ts";
import { ValidationError } from "../../src/common/error.ts";
import { assertUrlAllowed } from "../../src/hlvm/agent/tools/web/fetch-core.ts";

interface CompetitiveGateResult {
  gate: string;
  alignedWith: string;
  pass: boolean;
  detail: string;
}

type SearchToolResponse = Record<string, unknown> & {
  results?: Array<{ title?: string; url?: string; snippet?: string }>;
  citations?: unknown[];
  retrievedAt?: string;
  cached?: boolean;
  count?: number;
};

type WebFetchSingleResponse = Record<string, unknown> & {
  citation?: unknown;
  retrievedAt?: string;
  status?: number;
  text?: string;
  cached?: boolean;
};

type WebFetchBatchResponse = Record<string, unknown> & {
  batch?: boolean;
  results?: Array<{ error?: string }>;
  count?: number;
  errors?: number;
};

const FAKE_PROVIDER_NAME = "duckduckgo";

function makeDataUrl(title: string, body: string): string {
  return `data:text/html,<html><title>${
    encodeURIComponent(title)
  }</title><body>${encodeURIComponent(body)}</body></html>`;
}

async function withIsolatedSearchRegistry(
  fn: () => Promise<void>,
): Promise<void> {
  resetSearchProviderBootstrap();
  resetSearchProviders();
  initSearchProviders();

  // Override default provider for deterministic E2E behavior.
  registerSearchProvider({
    name: FAKE_PROVIDER_NAME,
    displayName: "DuckDuckGo (deterministic-e2e)",
    requiresApiKey: false,
    async search(query: string, opts: SearchCallOptions) {
      assertUrlAllowed("https://example.com", opts.toolOptions);
      const corpus = [
        {
          title: "GitHub Main",
          url: "https://github.com/example/repo",
          snippet: "code host",
        },
        {
          title: "GitHub API",
          url: "https://api.github.com/repos/example/repo",
          snippet: "api host",
        },
        {
          title: "OpenAI",
          url: "https://openai.com/research",
          snippet: "openai domain",
        },
        {
          title: "HLVM Docs",
          url: "https://docs.example.com/hlvm?utm_source=feed&id=1",
          snippet: "hlvm docs reference",
        },
        {
          title: "HLVM Docs Canonical",
          url: "https://docs.example.com/hlvm?id=1&utm_medium=social",
          snippet: "hlvm docs full canonical duplicate",
        },
        {
          title: "HLVM Release Old",
          url: "https://news.example.com/hlvm-old",
          snippet: "Published 2020-01-01",
        },
        {
          title: "HLVM Release Recent",
          url: "https://news.example.com/hlvm-new",
          snippet: "published 1 day ago",
        },
        {
          title: "Same Host Doc A",
          url: "https://docs.example.com/a",
          snippet: "hlvm docs tutorial one",
        },
        {
          title: "Same Host Doc B",
          url: "https://docs.example.com/b",
          snippet: "hlvm docs tutorial two",
        },
        {
          title: "Alt Host Doc",
          url: "https://community.example.org/hlvm",
          snippet: "hlvm docs community guide",
        },
        {
          title: "Adversarial Similar Domain",
          url: "https://notgithub.com/fake",
          snippet: "should not match github.com allowlist",
        },
        {
          title: "Chain Source",
          url: makeDataUrl("Chain Source", `query:${query};fact:Deterministic chain content.`),
          snippet: "data-url chain source",
        },
      ];

      const filtered = corpus.filter((result) => {
        if (!result.url) return true;
        try {
          const hostname = new URL(result.url).hostname;
          return isAllowedByDomainFilters(
            hostname,
            opts.allowedDomains,
            opts.blockedDomains,
          );
        } catch {
          return true;
        }
      });

      const ranked = rankSearchResults(query, filtered, opts.timeRange ?? "all")
        .slice(0, opts.limit);

      return {
        query,
        provider: FAKE_PROVIDER_NAME,
        results: ranked,
        count: ranked.length,
      };
    },
  });

  try {
    await fn();
  } finally {
    resetSearchProviderBootstrap();
    resetSearchProviders();
    initSearchProviders();
  }
}

function printAsciiScoreboard(results: CompetitiveGateResult[]): void {
  const passCount = results.filter((r) => r.pass).length;
  const total = results.length;
  const lines = [
    "+--------------------------------------------------------------------------------------+",
    "| Web RAG Competitive E2E Scoreboard                                                  |",
    "+----+------------------------------------------+----------------------+---------------+",
    "| #  | Gate                                     | Aligned With         | Status        |",
    "+----+------------------------------------------+----------------------+---------------+",
  ];
  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    const idx = String(i + 1).padEnd(2, " ");
    const gate = r.gate.slice(0, 40).padEnd(40, " ");
    const aligned = r.alignedWith.slice(0, 20).padEnd(20, " ");
    const status = (r.pass ? "PASS" : "FAIL").padEnd(13, " ");
    lines.push(`| ${idx} | ${gate} | ${aligned} | ${status} |`);
  }
  lines.push("+----+------------------------------------------+----------------------+---------------+");
  lines.push(`| Score: ${passCount}/${total}                                                                    |`);
  lines.push("+--------------------------------------------------------------------------------------+");
  for (const line of lines) console.log(line);
}

Deno.test({
  name: "E2E Web RAG Competitive: advanced deterministic capability benchmark",
  sanitizeResources: false,
  sanitizeOps: false,
  async fn() {
    const results: CompetitiveGateResult[] = [];
    const record = (
      gate: string,
      alignedWith: string,
      pass: boolean,
      detail: string,
    ) => {
      results.push({ gate, alignedWith, pass, detail });
      if (!pass) {
        console.error(`FAIL DETAIL | ${gate} | ${detail}`);
      }
    };

    await withIsolatedSearchRegistry(async () => {
      // 1) Explicit-provider fail-fast semantics.
      let explicitFailFast = false;
      try {
        resolveSearchProvider("unknown-provider", true);
      } catch (error) {
        explicitFailFast = error instanceof ValidationError;
      }
      record(
        "explicit unknown provider fails fast",
        "Claude/Codex",
        explicitFailFast,
        "Expected ValidationError for explicit unknown provider",
      );

      // 2) Domain allowlist strictness (exact/subdomain only).
      const allowed = await WEB_TOOLS.search_web.fn(
        {
          query: "competitive-domain-allow",
          maxResults: 8,
          allowedDomains: ["github.com"],
        },
        "/tmp",
      ) as SearchToolResponse;
      const allowUrls = (allowed.results ?? [])
        .map((r) => String(r.url ?? ""))
        .filter((u) => u.length > 0);
      const strictAllow = allowUrls.every((url) => {
        const host = new URL(url).hostname;
        return host === "github.com" || host.endsWith(".github.com");
      }) && !allowUrls.some((url) => new URL(url).hostname === "notgithub.com");
      record(
        "allowlist uses exact/subdomain matching",
        "Claude/Gemini",
        strictAllow,
        `URLs: ${allowUrls.join(", ")}`,
      );

      // 3) Domain blocklist enforcement.
      const blocked = await WEB_TOOLS.search_web.fn(
        {
          query: "competitive-domain-block",
          maxResults: 8,
          blockedDomains: ["openai.com"],
        },
        "/tmp",
      ) as SearchToolResponse;
      const blockUrls = (blocked.results ?? [])
        .map((r) => String(r.url ?? ""))
        .filter((u) => u.length > 0);
      const strictBlock = blockUrls.every((url) => {
        const host = new URL(url).hostname;
        return !(host === "openai.com" || host.endsWith(".openai.com"));
      });
      record(
        "blocklist excludes blocked hosts",
        "Claude/Codex",
        strictBlock,
        `URLs: ${blockUrls.join(", ")}`,
      );

      // 4) Provenance metadata on search responses.
      const hasSearchProvenance =
        Array.isArray(allowed.citations) &&
        typeof allowed.retrievedAt === "string";
      record(
        "search responses include provenance fields",
        "Claude/Codex/Gemini",
        hasSearchProvenance,
        `citations=${Array.isArray(allowed.citations) ? allowed.citations.length : 0}`,
      );

      // 5) Cache key domain awareness + order invariance.
      const keyA = __testOnlyBuildSearchWebCacheKey(
        "duckduckgo",
        "q",
        5,
        ["a.com", "b.com"],
      );
      const keyB = __testOnlyBuildSearchWebCacheKey(
        "duckduckgo",
        "q",
        5,
        ["b.com", "a.com"],
      );
      const keyC = __testOnlyBuildSearchWebCacheKey(
        "duckduckgo",
        "q",
        5,
        ["a.com"],
        ["x.com"],
      );
      const keyDay = __testOnlyBuildSearchWebCacheKey(
        "duckduckgo",
        "q",
        5,
        undefined,
        undefined,
        "day",
      );
      const cacheDomainAware = keyA === keyB && keyA !== keyC && keyA !== keyDay;
      record(
        "cache key is domain/time-aware and order-invariant",
        "Codex/Gemini",
        cacheDomainAware,
        `keyA==keyB=${keyA === keyB}, keyA!=keyC=${keyA !== keyC}, keyA!=keyDay=${keyA !== keyDay}`,
      );

      // 6) retrievedAt freshness on cache hit (search).
      const cacheSeed = `cache-competitive-${Date.now()}`;
      const firstSearch = await WEB_TOOLS.search_web.fn(
        { query: cacheSeed, maxResults: 4 },
        "/tmp",
      ) as SearchToolResponse;
      await new Promise((resolve) => setTimeout(resolve, 10));
      const secondSearch = await WEB_TOOLS.search_web.fn(
        { query: cacheSeed, maxResults: 4 },
        "/tmp",
      ) as SearchToolResponse;
      const refreshedSearchTs = Boolean(secondSearch.cached) &&
        firstSearch.retrievedAt !== secondSearch.retrievedAt;
      record(
        "search cache-hit keeps fresh retrieval timestamp",
        "Codex",
        refreshedSearchTs,
        `cached=${Boolean(secondSearch.cached)}`,
      );

      // 7) web_fetch additive provenance fields.
      const single = await WEB_TOOLS.web_fetch.fn(
        { url: makeDataUrl("Single", "single fetch body"), maxChars: 4000 },
        "/tmp",
      ) as WebFetchSingleResponse;
      const webFetchProvenance = typeof single.citation === "object" &&
        typeof single.retrievedAt === "string";
      record(
        "web_fetch single response includes provenance",
        "Claude/OpenClaw",
        webFetchProvenance,
        `status=${String(single.status ?? "n/a")}`,
      );

      // 8) web_fetch batch behavior with partial failures.
      const batch = await WEB_TOOLS.web_fetch.fn(
        {
          urls: [makeDataUrl("A", "aaa"), "not-a-real-url", makeDataUrl("B", "bbb")],
          maxChars: 3000,
        },
        "/tmp",
      ) as WebFetchBatchResponse;
      const batchResults = (batch.results ?? []) as Array<{ error?: string }>;
      const batchCompetitive = batch.batch === true &&
        batchResults.length === 3 &&
        batchResults.some((r) => typeof r.error === "string");
      record(
        "web_fetch batch supports partial-failure resilience",
        "Gemini/OpenClaw",
        batchCompetitive,
        `count=${String(batch.count ?? "n/a")} errors=${String(batch.errors ?? "n/a")}`,
      );

      // 9) Network policy enforcement remains strict.
      const denyAllPolicy: AgentPolicy = {
        version: 1,
        networkRules: { deny: ["*"] },
      };
      const denyQuery = `policy-check-${Date.now()}`;
      await assertRejects(
        () =>
          WEB_TOOLS.search_web.fn(
            { query: denyQuery },
            "/tmp",
            { policy: denyAllPolicy },
          ),
        ValidationError,
      );
      await assertRejects(
        () =>
          WEB_TOOLS.fetch_url.fn(
            { url: "https://example.com" },
            "/tmp",
            { policy: denyAllPolicy },
          ),
        ValidationError,
      );
      record(
        "network deny policy blocks web tools",
        "Claude/Codex",
        true,
        "search_web + fetch_url denied as expected",
      );

      // 10) Multi-hop chain: search result URL -> web_fetch.
      const chainSearch = await WEB_TOOLS.search_web.fn(
        { query: "competitive-chain", maxResults: 5 },
        "/tmp",
      ) as SearchToolResponse;
      const chainUrl = (chainSearch.results ?? [])
        .map((r) => String(r.url ?? ""))
        .find((url) => url.startsWith("data:text/html"));
      let chainPass = false;
      if (chainUrl) {
        const chainFetch = await WEB_TOOLS.web_fetch.fn(
          { url: chainUrl, maxChars: 5000 },
          "/tmp",
        ) as WebFetchSingleResponse;
        chainPass = String(chainFetch.text ?? "").includes("Deterministic chain content.");
      }
      record(
        "multi-hop search -> fetch chain works deterministically",
        "Claude/Codex/Gemini/OpenClaw",
        chainPass,
        `chainUrlFound=${Boolean(chainUrl)}`,
      );

      // 11) timeRange influences ranking/filtering for freshness-sensitive queries.
      const recentOnly = await WEB_TOOLS.search_web.fn(
        { query: "hlvm release", maxResults: 8, timeRange: "week" },
        "/tmp",
      ) as SearchToolResponse;
      const recentTitles = (recentOnly.results ?? []).map((r) => String(r.title ?? ""));
      const timeRangeWorks = recentTitles.includes("HLVM Release Recent") &&
        !recentTitles.includes("HLVM Release Old");
      record(
        "timeRange filters older results for recency",
        "Claude/Codex/Gemini",
        timeRangeWorks,
        `titles=${recentTitles.join(", ")}`,
      );

      // 12) Canonical dedup removes tracking-param duplicates.
      const dedupQuery = await WEB_TOOLS.search_web.fn(
        { query: "hlvm docs", maxResults: 10 },
        "/tmp",
      ) as SearchToolResponse;
      const canonicalUrls = (dedupQuery.results ?? [])
        .map((r) => canonicalizeResultUrl(String(r.url ?? "")) ?? "")
        .filter((u) => u.length > 0);
      const dedupWorks = new Set(canonicalUrls).size === canonicalUrls.length;
      record(
        "canonical URL dedup removes duplicate variants",
        "Codex/OpenClaw",
        dedupWorks,
        `unique=${new Set(canonicalUrls).size} total=${canonicalUrls.length}`,
      );

      // 13) Diversity rerank reduces same-host monopolization at top results.
      const diversity = await WEB_TOOLS.search_web.fn(
        { query: "hlvm docs tutorial", maxResults: 5 },
        "/tmp",
      ) as SearchToolResponse;
      const topHosts = (diversity.results ?? [])
        .slice(0, 3)
        .map((r) => {
          try {
            return new URL(String(r.url ?? "")).hostname;
          } catch {
            return "";
          }
        })
        .filter((h) => h.length > 0);
      const topTwoDistinct = new Set(topHosts.slice(0, 2)).size === 2;
      record(
        "diversity rerank avoids same-host top-2 lock-in",
        "Claude/OpenClaw",
        topTwoDistinct,
        `hosts=${topHosts.join(", ")}`,
      );
    });

    printAsciiScoreboard(results);

    const passCount = results.filter((r) => r.pass).length;
    const total = results.length;

    // Strong bar: this benchmark should be fully green in deterministic mode.
    assertEquals(passCount, total);
  },
});
