/**
 * Search ranking SSOT for DDG web search.
 * Provides canonical URL deduplication plus relevance/recency/diversity scoring.
 */

import type { SearchResult, SearchTimeRange } from "./search-provider.ts";

const DAY_MS = 24 * 60 * 60 * 1000;

const TRACKING_QUERY_PARAMS = new Set([
  "fbclid",
  "gclid",
  "igshid",
  "mc_cid",
  "mc_eid",
  "msclkid",
  "ref",
  "source",
  "utm_campaign",
  "utm_content",
  "utm_id",
  "utm_medium",
  "utm_source",
  "utm_term",
  "ved",
]);

const TIME_RANGE_MAX_DAYS: Record<SearchTimeRange, number> = {
  day: 1,
  week: 7,
  month: 31,
  year: 366,
  all: Number.POSITIVE_INFINITY,
};

function tokenizeQuery(query: string): string[] {
  return query
    .toLowerCase()
    .split(/[\s\-_.]+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 2);
}

function normalizePathname(pathname: string): string {
  if (pathname.length > 1 && pathname.endsWith("/")) {
    return pathname.slice(0, -1);
  }
  return pathname;
}

function toAgeDays(timestampMs: number): number | undefined {
  if (!Number.isFinite(timestampMs)) return undefined;
  const diffMs = Date.now() - timestampMs;
  if (diffMs < 0) return 0;
  return diffMs / DAY_MS;
}

function parseAbsoluteDate(input: string): number | undefined {
  if (!input.trim()) return undefined;
  const parsedMs = Date.parse(input);
  if (!Number.isNaN(parsedMs)) return parsedMs;

  const ymd = input.match(/\b(\d{4})[-/](\d{1,2})[-/](\d{1,2})\b/);
  if (ymd) {
    const [_, y, m, d] = ymd;
    const ms = Date.UTC(Number(y), Number(m) - 1, Number(d));
    return Number.isNaN(ms) ? undefined : ms;
  }

  const monthNamed = input.match(
    /\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+(\d{1,2}),?\s+(\d{4})\b/i,
  );
  if (monthNamed) {
    const ms = Date.parse(`${monthNamed[1]} ${monthNamed[2]} ${monthNamed[3]}`);
    return Number.isNaN(ms) ? undefined : ms;
  }

  return undefined;
}

function parseRelativeAgeDays(text: string): number | undefined {
  const lower = text.toLowerCase();
  if (lower.includes("yesterday")) return 1;
  if (lower.includes("today")) return 0;

  const relative = lower.match(
    /\b(\d+)\s*(minute|hour|day|week|month|year)s?\s+ago\b/,
  );
  if (!relative) return undefined;

  const amount = Number(relative[1]);
  const unit = relative[2];
  if (!Number.isFinite(amount)) return undefined;
  switch (unit) {
    case "minute":
      return amount / (24 * 60);
    case "hour":
      return amount / 24;
    case "day":
      return amount;
    case "week":
      return amount * 7;
    case "month":
      return amount * 30;
    case "year":
      return amount * 365;
    default:
      return undefined;
  }
}

function resultHost(url?: string): string | undefined {
  if (!url) return undefined;
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return undefined;
  }
}

function recencyBoost(ageDays: number | undefined, timeRange: SearchTimeRange): number {
  if (ageDays === undefined) return 0;
  if (timeRange === "all") {
    return Math.max(0, (30 - ageDays) / 30) * 1.5;
  }
  const maxDays = TIME_RANGE_MAX_DAYS[timeRange];
  return Math.max(0, (maxDays - ageDays) / maxDays) * 3;
}

function relevanceScore(query: string, result: SearchResult): number {
  const tokens = tokenizeQuery(query);
  if (tokens.length === 0) return 0;

  const title = (result.title ?? "").toLowerCase();
  const snippet = (result.snippet ?? "").toLowerCase();
  const url = (result.url ?? "").toLowerCase();

  return tokens.reduce((score, token) => {
    let next = score;
    if (title.includes(token)) next += 3;
    if (snippet.includes(token)) next += 1;
    if (url.includes(token)) next += 1;
    return next;
  }, url.startsWith("https://") ? 1 : 0);
}

function qualityScore(result: SearchResult): number {
  return (result.title?.length ?? 0) + (result.snippet?.length ?? 0) + ((result.score ?? 0) * 8);
}

function isInsideTimeRange(ageDays: number | undefined, timeRange: SearchTimeRange): boolean {
  if (timeRange === "all") return true;
  if (ageDays === undefined) return true;
  return ageDays <= TIME_RANGE_MAX_DAYS[timeRange];
}

export function canonicalizeResultUrl(url?: string): string | undefined {
  if (!url) return undefined;
  try {
    const parsed = new URL(url);
    parsed.hash = "";
    parsed.hostname = parsed.hostname.toLowerCase();

    if ((parsed.protocol === "https:" && parsed.port === "443") ||
      (parsed.protocol === "http:" && parsed.port === "80")) {
      parsed.port = "";
    }

    parsed.pathname = normalizePathname(parsed.pathname);

    const cleanedParams = [...parsed.searchParams.entries()]
      .filter(([key]) => !TRACKING_QUERY_PARAMS.has(key.toLowerCase()))
      .sort(([a], [b]) => a.localeCompare(b));

    parsed.search = "";
    cleanedParams.forEach(([key, value]) => parsed.searchParams.append(key, value));

    return parsed.toString();
  } catch {
    return url.trim();
  }
}

export function extractResultAgeDays(result: SearchResult): number | undefined {
  const publishedAtMs = parseAbsoluteDate(result.publishedDate ?? "");
  if (publishedAtMs !== undefined) return toAgeDays(publishedAtMs);

  const combined = `${result.title ?? ""} ${result.snippet ?? ""}`.trim();
  const absoluteMs = parseAbsoluteDate(combined);
  if (absoluteMs !== undefined) return toAgeDays(absoluteMs);

  return parseRelativeAgeDays(combined);
}

export function dedupeSearchResults(results: SearchResult[]): SearchResult[] {
  const bestByCanonical = new Map<string, SearchResult>();

  for (const result of results) {
    const key = canonicalizeResultUrl(result.url) ??
      `no-url:${(result.title ?? "").toLowerCase()}:${(result.snippet ?? "").toLowerCase()}`;
    const existing = bestByCanonical.get(key);
    if (!existing) {
      bestByCanonical.set(key, result);
      continue;
    }
    if (qualityScore(result) > qualityScore(existing)) {
      bestByCanonical.set(key, result);
    }
  }

  return [...bestByCanonical.values()];
}

export function rankSearchResults(
  query: string,
  results: SearchResult[],
  timeRange: SearchTimeRange = "all",
): SearchResult[] {
  const deduped = dedupeSearchResults(results);

  const scored = deduped
    .map((result) => {
      const ageDays = extractResultAgeDays(result);
      const score = relevanceScore(query, result) + recencyBoost(ageDays, timeRange);
      return { result, ageDays, baseScore: score, host: resultHost(result.url) };
    })
    .filter((entry) => isInsideTimeRange(entry.ageDays, timeRange));

  const candidates = (scored.length > 0 ? scored : deduped.map((result) => ({
    result,
    ageDays: extractResultAgeDays(result),
    baseScore: relevanceScore(query, result),
    host: resultHost(result.url),
  }))).sort((a, b) => b.baseScore - a.baseScore);

  const seenByHost = new Map<string, number>();
  const diversified = candidates.map((entry) => {
    const seenCount = entry.host ? (seenByHost.get(entry.host) ?? 0) : 0;
    if (entry.host) seenByHost.set(entry.host, seenCount + 1);
    const diversityPenalty = seenCount * 1.25;
    return {
      ...entry.result,
      score: entry.baseScore - diversityPenalty,
    };
  });

  return diversified.sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
}
