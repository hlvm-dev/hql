import type { ToolExecutionOptions } from "../../registry.ts";
import {
  fetchWithRedirects,
  readResponseBody,
} from "./fetch-core.ts";
import {
  decodeHtmlEntities,
  isHtmlLikeResponse,
  parseAttributes,
  parseHtml,
} from "./html-parser.ts";
import {
  normalizeDomain,
  type SearchResult,
} from "./search-provider.ts";
import type { SearchQueryIntent } from "./query-strategy.ts";
import {
  buildDeterministicSearchResultScorer,
} from "./search-result-selector.ts";

const MAX_DISCOVERY_DOMAINS = 2;
const MAX_SEED_URLS_PER_DOMAIN = 5;
const MAX_LINKS_PER_SEED = 64;
const MAX_DISCOVERY_BYTES = 128_000;
const MAX_DISCOVERY_TEXT = 12_000;
const MAX_REDIRECTS = 2;

interface DiscoverAllowedDomainResultsInput {
  query: string;
  allowedDomains: string[];
  maxResults: number;
  intent?: SearchQueryIntent;
  timeoutMs?: number;
  fetchUserAgent: string;
  toolOptions?: ToolExecutionOptions;
}

export interface AllowedDomainDiscoveryDiagnostics {
  triggered: boolean;
  domains: string[];
  seedUrls: string[];
  fetchedSeedUrls: string[];
  discoveredResultCount: number;
}

export interface AllowedDomainDiscoveryResult {
  results: SearchResult[];
  diagnostics: AllowedDomainDiscoveryDiagnostics;
}

interface SeedPage {
  url: string;
  title: string;
  description: string;
  html: string;
}

interface CandidateScore {
  result: SearchResult;
  score: number;
}

function buildSeedPaths(intent?: SearchQueryIntent): string[] {
  const paths: string[] = ["/"];

  if (intent?.wantsOfficialDocs || intent?.wantsReference) {
    paths.push("/reference", "/learn", "/docs", "/api", "/guide");
  } else if (intent?.wantsReleaseNotes || intent?.wantsRecency) {
    paths.push("/releases", "/release-notes", "/changelog", "/blog");
  } else {
    paths.push("/docs", "/reference", "/learn", "/api");
  }

  if (intent?.wantsComparison || intent?.wantsMultiSourceSynthesis) {
    paths.push("/guide");
  }

  return [...new Set(paths)].slice(0, MAX_SEED_URLS_PER_DOMAIN);
}

function buildSeedUrls(domain: string, intent?: SearchQueryIntent): string[] {
  return buildSeedPaths(intent).map((path) =>
    path === "/" ? `https://${domain}` : `https://${domain}${path}`
  );
}

function stripAnchorText(value: string): string {
  return decodeHtmlEntities(
    value.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim(),
  );
}

function looksLikeAsset(url: URL): boolean {
  return /\.(?:avif|bmp|css|gif|ico|jpeg|jpg|js|json|map|pdf|png|svg|txt|webp|woff2?)$/i
    .test(url.pathname);
}

function canonicalizeDiscoveryUrl(
  href: string,
  baseUrl: string,
  allowedDomains: string[],
): string | undefined {
  const trimmed = decodeHtmlEntities(href).trim();
  if (
    !trimmed ||
    trimmed.startsWith("#") ||
    trimmed.toLowerCase().startsWith("javascript:") ||
    trimmed.toLowerCase().startsWith("mailto:") ||
    trimmed.toLowerCase().startsWith("tel:")
  ) {
    return undefined;
  }

  try {
    const url = new URL(trimmed, baseUrl);
    if (!["http:", "https:"].includes(url.protocol)) return undefined;
    if (!allowedDomains.some((domain) =>
      url.hostname === domain || url.hostname.endsWith(`.${domain}`)
    )) {
      return undefined;
    }
    if (looksLikeAsset(url)) return undefined;
    url.hash = "";
    return url.toString();
  } catch {
    return undefined;
  }
}

function titleFromUrl(url: string): string {
  try {
    const parsed = new URL(url);
    const last = parsed.pathname.split("/").filter(Boolean).at(-1) ?? parsed.hostname;
    const decoded = decodeURIComponent(last)
      .replace(/\.(html?|mdx?)$/i, "")
      .replace(/[-_]+/g, " ")
      .replace(/\b([a-z])([A-Z])/g, "$1 $2")
      .trim();
    return decoded.length > 0 ? decoded : parsed.hostname;
  } catch {
    return url;
  }
}

function shouldKeepDiscoveryUrl(
  url: string,
  intent?: SearchQueryIntent,
): boolean {
  try {
    const parsed = new URL(url);
    const segments = parsed.pathname.toLowerCase().split("/").filter(Boolean);
    if (segments.length === 0) return true;

    if (intent?.wantsOfficialDocs || intent?.wantsReference) {
      const blocked = new Set([
        "blog",
        "community",
        "contributors",
        "download",
        "downloads",
        "release",
        "releases",
        "versions",
      ]);
      if (segments.some((segment) => blocked.has(segment))) {
        return false;
      }
    }

    return true;
  } catch {
    return false;
  }
}

function extractAnchorCandidates(
  html: string,
  baseUrl: string,
  allowedDomains: string[],
): Array<{ url: string; title: string }> {
  const candidates: Array<{ url: string; title: string }> = [];
  const seen = new Set<string>();
  const anchorRegex = /<a\b[^>]*>[\s\S]*?<\/a>/gi;
  let match: RegExpExecArray | null;

  while ((match = anchorRegex.exec(html)) !== null) {
    const anchor = match[0] ?? "";
    const openTag = anchor.match(/^<a\b[^>]*>/i)?.[0] ?? "";
    if (!openTag) continue;
    const attrs = parseAttributes(openTag);
    const href = attrs.href;
    if (!href) continue;
    const url = canonicalizeDiscoveryUrl(href, baseUrl, allowedDomains);
    if (!url || seen.has(url)) continue;

    const rawTitle = anchor.slice(openTag.length, anchor.length - "</a>".length);
    const title = stripAnchorText(rawTitle) || titleFromUrl(url);
    seen.add(url);
    candidates.push({ url, title });
    if (candidates.length >= MAX_LINKS_PER_SEED) break;
  }

  return candidates;
}

async function fetchSeedPage(
  url: string,
  timeoutMs: number | undefined,
  fetchUserAgent: string,
  toolOptions?: ToolExecutionOptions,
): Promise<SeedPage | null> {
  try {
    const { finalUrl, response } = await fetchWithRedirects(
      url,
      timeoutMs,
      { "User-Agent": fetchUserAgent },
      MAX_REDIRECTS,
      toolOptions,
    );
    const body = await readResponseBody(response, MAX_DISCOVERY_BYTES);
    if (!isHtmlLikeResponse(response.headers.get("content-type") ?? "", body.text)) {
      return null;
    }

    const parsed = parseHtml(body.text, MAX_DISCOVERY_TEXT, 0);
    return {
      url: finalUrl,
      title: parsed.title || titleFromUrl(finalUrl),
      description: parsed.description,
      html: body.text,
    };
  } catch {
    return null;
  }
}

function mergeCandidate(
  target: Map<string, CandidateScore>,
  candidate: SearchResult,
  score: number,
): void {
  const existing = target.get(candidate.url ?? "");
  if (!candidate.url) return;

  if (!existing || score > existing.score) {
    target.set(candidate.url, {
      result: candidate,
      score,
    });
    return;
  }

  if (!existing.result.snippet && candidate.snippet) {
    existing.result.snippet = candidate.snippet;
  }
  if (!existing.result.title && candidate.title) {
    existing.result.title = candidate.title;
  }
}

export async function discoverAllowedDomainResults(
  input: DiscoverAllowedDomainResultsInput,
): Promise<AllowedDomainDiscoveryResult> {
  const domains = input.allowedDomains
    .map(normalizeDomain)
    .filter((domain) => domain.length > 0)
    .slice(0, MAX_DISCOVERY_DOMAINS);

  const diagnostics: AllowedDomainDiscoveryDiagnostics = {
    triggered: domains.length > 0,
    domains,
    seedUrls: [],
    fetchedSeedUrls: [],
    discoveredResultCount: 0,
  };

  if (domains.length === 0 || input.maxResults <= 0) {
    return { results: [], diagnostics };
  }

  const scorer = buildDeterministicSearchResultScorer({
    query: input.query,
    intent: input.intent,
    allowedDomains: input.allowedDomains,
  });
  const candidates = new Map<string, CandidateScore>();
  const fallbackSeedCandidates: CandidateScore[] = [];
  const seedUrlQueue = domains.flatMap((domain) => buildSeedUrls(domain, input.intent));
  diagnostics.seedUrls = seedUrlQueue;

  for (const seedUrl of seedUrlQueue) {
    const seedPage = await fetchSeedPage(
      seedUrl,
      input.timeoutMs,
      input.fetchUserAgent,
      input.toolOptions,
    );
    if (!seedPage) continue;
    diagnostics.fetchedSeedUrls.push(seedPage.url);

    const positiveLinks: CandidateScore[] = [];
    for (const link of extractAnchorCandidates(seedPage.html, seedPage.url, domains)) {
      if (!shouldKeepDiscoveryUrl(link.url, input.intent)) continue;
      const candidate: SearchResult = {
        title: link.title,
        url: link.url,
        snippet: seedPage.title
          ? `Discovered from ${seedPage.title}.`
          : undefined,
      };
      const score = scorer(candidate);
      if (score <= 0) continue;
      positiveLinks.push({
        result: { ...candidate, score },
        score,
      });
    }

    for (const link of positiveLinks) {
      mergeCandidate(candidates, link.result, link.score);
    }

    if (positiveLinks.length === 0) {
      const seedCandidate: SearchResult = {
        title: seedPage.title,
        url: seedPage.url,
        snippet: seedPage.description,
      };
      const seedScore = scorer(seedCandidate);
      if (seedScore > 0) {
        fallbackSeedCandidates.push({
          result: { ...seedCandidate, score: seedScore },
          score: seedScore,
        });
      }
    }
  }

  if (candidates.size === 0) {
    for (const seedCandidate of fallbackSeedCandidates) {
      mergeCandidate(candidates, seedCandidate.result, seedCandidate.score);
    }
  }

  const results = [...candidates.values()]
    .sort((a, b) =>
      b.score - a.score ||
      (a.result.url?.length ?? 0) - (b.result.url?.length ?? 0) ||
      (a.result.url ?? "").localeCompare(b.result.url ?? "")
    )
    .slice(0, Math.max(input.maxResults, 1))
    .map((entry) => entry.result);

  diagnostics.discoveredResultCount = results.length;
  return { results, diagnostics };
}
