import type { ToolExecutionOptions } from "../../registry.ts";
import { fetchWithRedirects, readResponseBody } from "./fetch-core.ts";
import {
  decodeHtmlEntities,
  isHtmlLikeResponse,
  parseAttributes,
  parseHtml,
} from "./html-parser.ts";
import {
  isAllowedByDomainFilters,
  normalizeDomain,
  type SearchResult,
} from "./search-provider.ts";
import type { SearchQueryIntent } from "./query-strategy.ts";
import {
  buildDeterministicSearchResultScorer,
} from "./search-result-selector.ts";
import { tokenizeSearchText } from "./search-ranking.ts";

const MAX_DISCOVERY_DOMAINS = 2;
const MAX_LINKS_PER_SEED = 64;
const MAX_DISCOVERY_BYTES = 128_000;
const MAX_DISCOVERY_TEXT = 12_000;
const MAX_REDIRECTS = 2;
const MAX_SITEMAP_FETCHES_PER_DOMAIN = 5;
const MAX_SITEMAP_URLS_PER_DOCUMENT = 96;
const MAX_NAV_SEEDS_PER_DOMAIN = 3;

const DISCOVERY_SIGNAL_TOKENS = new Set([
  "api",
  "blog",
  "changelog",
  "cli",
  "developer",
  "developers",
  "doc",
  "docs",
  "guide",
  "guides",
  "learn",
  "manual",
  "news",
  "reference",
  "release",
  "releases",
  "sdk",
  "tutorial",
  "tutorials",
  "updates",
]);

const BOILERPLATE_LINK_TOKENS = new Set([
  "about",
  "account",
  "billing",
  "career",
  "careers",
  "company",
  "contact",
  "cookie",
  "cookies",
  "help",
  "jobs",
  "legal",
  "login",
  "pricing",
  "privacy",
  "register",
  "shop",
  "signin",
  "signup",
  "status",
  "store",
  "support",
  "terms",
]);

const DOC_PATH_TOKENS = new Set([
  "doc",
  "docs",
  "guide",
  "guides",
  "learn",
  "manual",
  "tutorial",
  "tutorials",
]);

const REFERENCE_PATH_TOKENS = new Set([
  "api",
  "reference",
  "sdk",
]);

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

interface TextResource {
  url: string;
  text: string;
  contentType: string;
}

interface LinkCandidate {
  url: string;
  title: string;
  scoreAdjustment: number;
}

interface SitemapParseResult {
  childSitemaps: string[];
  pageUrls: string[];
}

function stripAnchorText(value: string): string {
  return decodeHtmlEntities(
    value.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim(),
  );
}

function stripXmlText(value: string): string {
  return decodeHtmlEntities(
    value
      .replace(/^<!\[CDATA\[/, "")
      .replace(/\]\]>$/, "")
      .replace(/\s+/g, " ")
      .trim(),
  );
}

function looksLikeAsset(url: URL): boolean {
  return /\.(?:avif|bmp|css|gif|ico|jpeg|jpg|js|json|map|pdf|png|svg|txt|webp|woff2?)$/i
    .test(url.pathname);
}

function isAllowedDiscoveryHost(
  hostname: string,
  allowedDomains: string[],
): boolean {
  return isAllowedByDomainFilters(hostname, allowedDomains, undefined);
}

function canonicalizeAllowedUrl(
  href: string,
  baseUrl: string,
  allowedDomains: string[],
  kind: "page" | "resource",
): string | undefined {
  const trimmed = stripXmlText(href);
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
    if (!isAllowedDiscoveryHost(url.hostname, allowedDomains)) return undefined;
    if (kind === "page" && looksLikeAsset(url)) return undefined;
    url.hash = "";
    return url.toString();
  } catch {
    return undefined;
  }
}

function titleFromUrl(url: string): string {
  try {
    const parsed = new URL(url);
    const last = parsed.pathname.split("/").filter(Boolean).at(-1) ??
      parsed.hostname;
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

function discoveryTokenMatches(
  url: string,
  title: string,
  allowedDomains: string[],
  tokens: Set<string>,
): number {
  const discovered = new Set<string>([
    ...tokenizeSearchText(title),
    ...tokenizeSearchText(url),
  ]);

  for (const domain of allowedDomains) {
    for (const token of tokenizeSearchText(normalizeDomain(domain))) {
      discovered.delete(token);
    }
  }

  let matches = 0;
  for (const token of discovered) {
    if (tokens.has(token)) matches += 1;
  }
  return matches;
}

function discoveryScoreAdjustment(
  url: string,
  title: string,
  allowedDomains: string[],
  contextBoost: number,
  intent?: SearchQueryIntent,
): number {
  const signalMatches = discoveryTokenMatches(
    url,
    title,
    allowedDomains,
    DISCOVERY_SIGNAL_TOKENS,
  );
  const noiseMatches = discoveryTokenMatches(
    url,
    title,
    allowedDomains,
    BOILERPLATE_LINK_TOKENS,
  );

  const urlAndTitleTokens = new Set<string>(tokenizeSearchText(title));
  try {
    const parsedUrl = new URL(url);
    for (const token of tokenizeSearchText(parsedUrl.pathname)) {
      urlAndTitleTokens.add(token);
    }
  } catch {
    for (const token of tokenizeSearchText(url)) {
      urlAndTitleTokens.add(token);
    }
  }

  let intentBoost = 0;
  if (intent?.wantsReference) {
    for (const token of urlAndTitleTokens) {
      if (REFERENCE_PATH_TOKENS.has(token)) {
        intentBoost += 0.9;
      } else if (DOC_PATH_TOKENS.has(token)) {
        intentBoost += 0.25;
      }
    }
  } else if (intent?.wantsOfficialDocs) {
    for (const token of urlAndTitleTokens) {
      if (DOC_PATH_TOKENS.has(token)) {
        intentBoost += 2.25;
      } else if (REFERENCE_PATH_TOKENS.has(token)) {
        intentBoost -= 0.5;
      }
    }
  }

  if (noiseMatches > 0 && signalMatches === 0) {
    return -8;
  }

  return contextBoost +
    intentBoost +
    Math.min(2.25, signalMatches * 0.75) -
    Math.min(5, noiseMatches * 1.75);
}

function extractAnchorCandidates(
  html: string,
  baseUrl: string,
  allowedDomains: string[],
  contextBoost = 0,
  intent?: SearchQueryIntent,
): LinkCandidate[] {
  const candidates: LinkCandidate[] = [];
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
    const url = canonicalizeAllowedUrl(href, baseUrl, allowedDomains, "page");
    if (!url || seen.has(url)) continue;

    const rawTitle = anchor.slice(
      openTag.length,
      anchor.length - "</a>".length,
    );
    const title = stripAnchorText(rawTitle) || titleFromUrl(url);
    seen.add(url);
    candidates.push({
      url,
      title,
      scoreAdjustment: discoveryScoreAdjustment(
        url,
        title,
        allowedDomains,
        contextBoost,
        intent,
      ),
    });
    if (candidates.length >= MAX_LINKS_PER_SEED) break;
  }

  return candidates;
}

function extractTaggedBlocks(html: string, pattern: RegExp): string[] {
  const blocks: string[] = [];
  let match: RegExpExecArray | null;

  pattern.lastIndex = 0;
  while ((match = pattern.exec(html)) !== null) {
    if (match[0]) blocks.push(match[0]);
  }

  return blocks;
}

function extractNavDiscoveryCandidates(
  html: string,
  baseUrl: string,
  allowedDomains: string[],
  intent?: SearchQueryIntent,
): LinkCandidate[] {
  const sections = [
    ...extractTaggedBlocks(html, /<nav\b[^>]*>[\s\S]*?<\/nav>/gi),
    ...extractTaggedBlocks(
      html,
      /<([a-z0-9]+)\b[^>]*\brole\s*=\s*["']navigation["'][^>]*>[\s\S]*?<\/\1>/gi,
    ),
    ...extractTaggedBlocks(
      html,
      /<(?:main|article)\b[^>]*>[\s\S]*?<\/(?:main|article)>/gi,
    ),
  ];

  if (sections.length === 0) {
    sections.push(html);
  }

  const byUrl = new Map<string, LinkCandidate>();
  for (const section of sections) {
    const isNavSection = /<nav\b|role\s*=\s*["']navigation["']/i.test(section);
    const contextBoost = isNavSection ? 1.5 : 0.5;
    for (
      const candidate of extractAnchorCandidates(
        section,
        baseUrl,
        allowedDomains,
        contextBoost,
        intent,
      )
    ) {
      const existing = byUrl.get(candidate.url);
      if (!existing || candidate.scoreAdjustment > existing.scoreAdjustment) {
        byUrl.set(candidate.url, candidate);
      }
    }
  }

  return [...byUrl.values()]
    .sort((a, b) =>
      b.scoreAdjustment - a.scoreAdjustment ||
      a.url.localeCompare(b.url) ||
      a.url.length - b.url.length
    )
    .slice(0, MAX_LINKS_PER_SEED);
}

async function fetchTextResource(
  url: string,
  timeoutMs: number | undefined,
  fetchUserAgent: string,
  toolOptions?: ToolExecutionOptions,
): Promise<TextResource | null> {
  try {
    const { finalUrl, response } = await fetchWithRedirects(
      url,
      timeoutMs,
      { "User-Agent": fetchUserAgent },
      MAX_REDIRECTS,
      toolOptions,
    );
    if (!response.ok) return null;
    const body = await readResponseBody(response, MAX_DISCOVERY_BYTES);
    return {
      url: finalUrl,
      text: body.text,
      contentType: response.headers.get("content-type") ?? "",
    };
  } catch {
    return null;
  }
}

async function fetchSeedPage(
  url: string,
  timeoutMs: number | undefined,
  fetchUserAgent: string,
  toolOptions?: ToolExecutionOptions,
): Promise<SeedPage | null> {
  const resource = await fetchTextResource(
    url,
    timeoutMs,
    fetchUserAgent,
    toolOptions,
  );
  if (!resource) return null;
  if (!isHtmlLikeResponse(resource.contentType, resource.text)) {
    return null;
  }

  const parsed = parseHtml(resource.text, MAX_DISCOVERY_TEXT, 0);
  return {
    url: resource.url,
    title: parsed.title || titleFromUrl(resource.url),
    description: parsed.description,
    html: resource.text,
  };
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

function pushUnique(target: string[], seen: Set<string>, value?: string): void {
  if (!value || seen.has(value)) return;
  seen.add(value);
  target.push(value);
}

function buildCandidateScore(
  candidate: SearchResult,
  scoreAdjustment: number,
  scorer: (result: SearchResult) => number,
): CandidateScore | null {
  const score = scorer(candidate) + scoreAdjustment;
  if (score <= 0) return null;
  return {
    result: { ...candidate, score },
    score,
  };
}

function parseRobotsSitemapHints(
  text: string,
  baseUrl: string,
  allowedDomains: string[],
): string[] {
  const sitemapUrls: string[] = [];
  const seen = new Set<string>();

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/\s+#.*$/, "").trim();
    const match = /^sitemap\s*:\s*(.+)$/i.exec(line);
    if (!match?.[1]) continue;
    pushUnique(
      sitemapUrls,
      seen,
      canonicalizeAllowedUrl(match[1], baseUrl, allowedDomains, "resource"),
    );
  }

  return sitemapUrls;
}

function extractXmlLocs(xml: string, entryTag: string): string[] {
  const values: string[] = [];
  const entryRegex = new RegExp(
    `<(?:[a-z0-9_-]+:)?${entryTag}\\b[^>]*>([\\s\\S]*?)<\\/(?:[a-z0-9_-]+:)?${entryTag}>`,
    "gi",
  );
  let entryMatch: RegExpExecArray | null;

  while ((entryMatch = entryRegex.exec(xml)) !== null) {
    const block = entryMatch[1] ?? "";
    const locMatch =
      /<(?:[a-z0-9_-]+:)?loc\b[^>]*>([\s\S]*?)<\/(?:[a-z0-9_-]+:)?loc>/i.exec(
        block,
      );
    if (!locMatch?.[1]) continue;
    values.push(stripXmlText(locMatch[1]));
  }

  return values;
}

function parseLineDelimitedUrls(
  text: string,
  baseUrl: string,
  allowedDomains: string[],
): string[] {
  const pageUrls: string[] = [];
  const seen = new Set<string>();

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!/^https?:\/\//i.test(line)) continue;
    pushUnique(
      pageUrls,
      seen,
      canonicalizeAllowedUrl(line, baseUrl, allowedDomains, "page"),
    );
    if (pageUrls.length >= MAX_SITEMAP_URLS_PER_DOCUMENT) break;
  }

  return pageUrls;
}

function parseSitemapDocument(
  text: string,
  baseUrl: string,
  allowedDomains: string[],
): SitemapParseResult {
  const childSitemaps: string[] = [];
  const pageUrls: string[] = [];
  const seenChildren = new Set<string>();
  const seenPages = new Set<string>();

  if (/<(?:[a-z0-9_-]+:)?sitemapindex\b/i.test(text)) {
    for (const loc of extractXmlLocs(text, "sitemap")) {
      pushUnique(
        childSitemaps,
        seenChildren,
        canonicalizeAllowedUrl(loc, baseUrl, allowedDomains, "resource"),
      );
      if (childSitemaps.length >= MAX_SITEMAP_FETCHES_PER_DOMAIN) break;
    }
  }

  if (/<(?:[a-z0-9_-]+:)?urlset\b/i.test(text)) {
    for (const loc of extractXmlLocs(text, "url")) {
      pushUnique(
        pageUrls,
        seenPages,
        canonicalizeAllowedUrl(loc, baseUrl, allowedDomains, "page"),
      );
      if (pageUrls.length >= MAX_SITEMAP_URLS_PER_DOCUMENT) break;
    }
  }

  if (childSitemaps.length === 0 && pageUrls.length === 0) {
    for (const url of parseLineDelimitedUrls(text, baseUrl, allowedDomains)) {
      pushUnique(pageUrls, seenPages, url);
    }
  }

  return { childSitemaps, pageUrls };
}

async function collectSitemapCandidates(
  initialSitemapUrls: string[],
  input: DiscoverAllowedDomainResultsInput,
  allowedDomains: string[],
  scorer: (result: SearchResult) => number,
  diagnostics: AllowedDomainDiscoveryDiagnostics,
  seedSeen: Set<string>,
  fetchedSeen: Set<string>,
): Promise<CandidateScore[]> {
  const queue: string[] = [];
  const seenSitemaps = new Set<string>();
  const candidates: CandidateScore[] = [];

  for (const sitemapUrl of initialSitemapUrls) {
    pushUnique(queue, seenSitemaps, sitemapUrl);
  }

  let fetchCount = 0;
  while (queue.length > 0 && fetchCount < MAX_SITEMAP_FETCHES_PER_DOMAIN) {
    const sitemapUrl = queue.shift()!;
    pushUnique(diagnostics.seedUrls, seedSeen, sitemapUrl);
    const resource = await fetchTextResource(
      sitemapUrl,
      input.timeoutMs,
      input.fetchUserAgent,
      input.toolOptions,
    );
    fetchCount += 1;
    if (!resource) continue;
    pushUnique(diagnostics.fetchedSeedUrls, fetchedSeen, resource.url);

    const parsed = parseSitemapDocument(
      resource.text,
      resource.url,
      allowedDomains,
    );

    for (const childSitemap of parsed.childSitemaps) {
      if (fetchCount + queue.length >= MAX_SITEMAP_FETCHES_PER_DOMAIN) break;
      pushUnique(queue, seenSitemaps, childSitemap);
    }

    for (const pageUrl of parsed.pageUrls) {
      if (!shouldKeepDiscoveryUrl(pageUrl, input.intent)) continue;
      const title = titleFromUrl(pageUrl);
      const candidate = buildCandidateScore(
        {
          title,
          url: pageUrl,
          snippet: "Discovered via sitemap.",
        },
        discoveryScoreAdjustment(
          pageUrl,
          title,
          allowedDomains,
          0.5,
          input.intent,
        ),
        scorer,
      );
      if (!candidate) continue;
      candidates.push(candidate);
    }
  }

  return candidates;
}

function rankNavSeeds(candidates: CandidateScore[]): CandidateScore[] {
  return [...candidates]
    .sort((a, b) =>
      b.score - a.score ||
      (a.result.url ?? "").localeCompare(b.result.url ?? "") ||
      (a.result.url?.length ?? 0) - (b.result.url?.length ?? 0)
    )
    .slice(0, MAX_NAV_SEEDS_PER_DOMAIN);
}

function pageCandidateScore(
  page: SeedPage,
  scorer: (result: SearchResult) => number,
): CandidateScore | null {
  return buildCandidateScore(
    {
      title: page.title,
      url: page.url,
      snippet: page.description,
    },
    0,
    scorer,
  );
}

async function collectHomepageCandidates(
  domain: string,
  input: DiscoverAllowedDomainResultsInput,
  allowedDomains: string[],
  scorer: (result: SearchResult) => number,
  diagnostics: AllowedDomainDiscoveryDiagnostics,
  seedSeen: Set<string>,
  fetchedSeen: Set<string>,
): Promise<{ candidates: CandidateScore[]; fallbackPages: CandidateScore[] }> {
  const homepageUrl = `https://${domain}`;
  pushUnique(diagnostics.seedUrls, seedSeen, homepageUrl);
  const homepage = await fetchSeedPage(
    homepageUrl,
    input.timeoutMs,
    input.fetchUserAgent,
    input.toolOptions,
  );
  if (!homepage) {
    return { candidates: [], fallbackPages: [] };
  }
  pushUnique(diagnostics.fetchedSeedUrls, fetchedSeen, homepage.url);

  const candidates: CandidateScore[] = [];
  const fallbackPages: CandidateScore[] = [];
  const homepageLinks = extractNavDiscoveryCandidates(
    homepage.html,
    homepage.url,
    allowedDomains,
    input.intent,
  );

  for (const link of homepageLinks) {
    if (!shouldKeepDiscoveryUrl(link.url, input.intent)) continue;
    const candidate = buildCandidateScore(
      {
        title: link.title,
        url: link.url,
        snippet: homepage.title
          ? `Discovered from ${homepage.title}.`
          : undefined,
      },
      link.scoreAdjustment,
      scorer,
    );
    if (!candidate) continue;
    candidates.push(candidate);
  }

  if (candidates.length === 0) {
    const fallback = pageCandidateScore(homepage, scorer);
    if (fallback) fallbackPages.push(fallback);
  }

  for (const navSeed of rankNavSeeds(candidates)) {
    if (!navSeed.result.url || navSeed.result.url === homepage.url) continue;
    pushUnique(diagnostics.seedUrls, seedSeen, navSeed.result.url);
    const linkedPage = await fetchSeedPage(
      navSeed.result.url,
      input.timeoutMs,
      input.fetchUserAgent,
      input.toolOptions,
    );
    if (!linkedPage) continue;
    pushUnique(diagnostics.fetchedSeedUrls, fetchedSeen, linkedPage.url);

    const navLinks = extractNavDiscoveryCandidates(
      linkedPage.html,
      linkedPage.url,
      allowedDomains,
      input.intent,
    );
    let producedLink = false;
    for (const link of navLinks) {
      if (!shouldKeepDiscoveryUrl(link.url, input.intent)) continue;
      const candidate = buildCandidateScore(
        {
          title: link.title,
          url: link.url,
          snippet: linkedPage.title
            ? `Discovered from ${linkedPage.title}.`
            : undefined,
        },
        link.scoreAdjustment + 0.5,
        scorer,
      );
      if (!candidate) continue;
      candidates.push(candidate);
      producedLink = true;
    }

    if (!producedLink) {
      const fallback = pageCandidateScore(linkedPage, scorer);
      if (fallback) fallbackPages.push(fallback);
    }
  }

  return { candidates, fallbackPages };
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
  const seedSeen = new Set<string>();
  const fetchedSeen = new Set<string>();
  const targetCount = Math.max(input.maxResults, 1);

  for (const domain of domains) {
    if (candidates.size >= targetCount) break;

    const robotsUrl = `https://${domain}/robots.txt`;
    pushUnique(diagnostics.seedUrls, seedSeen, robotsUrl);
    const robots = await fetchTextResource(
      robotsUrl,
      input.timeoutMs,
      input.fetchUserAgent,
      input.toolOptions,
    );
    let robotsSitemaps: string[] = [];
    if (robots) {
      pushUnique(diagnostics.fetchedSeedUrls, fetchedSeen, robots.url);
      robotsSitemaps = parseRobotsSitemapHints(
        robots.text,
        robots.url,
        domains,
      );
    }

    if (robotsSitemaps.length > 0 && candidates.size < targetCount) {
      for (
        const candidate of await collectSitemapCandidates(
          robotsSitemaps,
          input,
          domains,
          scorer,
          diagnostics,
          seedSeen,
          fetchedSeen,
        )
      ) {
        mergeCandidate(candidates, candidate.result, candidate.score);
      }
    }

    const defaultSitemapUrl = `https://${domain}/sitemap.xml`;
    if (
      candidates.size < targetCount &&
      !robotsSitemaps.some((url) => url === defaultSitemapUrl)
    ) {
      for (
        const candidate of await collectSitemapCandidates(
          [defaultSitemapUrl],
          input,
          domains,
          scorer,
          diagnostics,
          seedSeen,
          fetchedSeen,
        )
      ) {
        mergeCandidate(candidates, candidate.result, candidate.score);
      }
    }

    if (candidates.size < targetCount) {
      const homepageDiscovery = await collectHomepageCandidates(
        domain,
        input,
        domains,
        scorer,
        diagnostics,
        seedSeen,
        fetchedSeen,
      );
      for (const candidate of homepageDiscovery.candidates) {
        mergeCandidate(candidates, candidate.result, candidate.score);
      }
      fallbackSeedCandidates.push(...homepageDiscovery.fallbackPages);
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
      (a.result.url ?? "").localeCompare(b.result.url ?? "") ||
      (a.result.url?.length ?? 0) - (b.result.url?.length ?? 0)
    )
    .slice(0, targetCount)
    .map((entry) => entry.result);

  diagnostics.discoveredResultCount = results.length;
  return { results, diagnostics };
}
