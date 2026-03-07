/**
 * Google News RSS: supplementary search source for recency/release queries.
 * Fetched in parallel with DuckDuckGo when intent signals recency interest.
 * Any failure → empty array (graceful degradation, never throws).
 */

import { http } from "../../../../common/http-client.ts";
import { withRetry } from "../../../../common/retry.ts";
import { DEFAULT_USER_AGENT } from "../../../../common/config/web-resolver.ts";
import { isTransientHttpError } from "./fetch-core.ts";
import { decodeHtmlEntities } from "./html-parser.ts";
import type { SearchResult } from "./search-provider.ts";

// ============================================================
// Constants
// ============================================================

const GOOGLE_NEWS_RSS_BASE = "https://news.google.com/rss/search";
const DEFAULT_LIMIT = 8;
const DEFAULT_TIMEOUT_MS = 3000;

// ============================================================
// RSS Parsing
// ============================================================

function stripCdata(text: string): string {
  return text.replace(/^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/, "$1");
}

function extractTag(xml: string, tag: string): string {
  const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, "i");
  const match = xml.match(re);
  if (!match?.[1]) return "";
  // Google News double-encodes HTML in descriptions (e.g. &amp;nbsp; and &lt;a&gt;).
  // Decode entities → strip resulting tags → decode again for any remaining entities.
  const decoded = decodeHtmlEntities(stripCdata(match[1]));
  const stripped = decoded.replace(/<[^>]+>/g, " ");
  return decodeHtmlEntities(stripped).replace(/\s+/g, " ").trim();
}

function extractTagRaw(xml: string, tag: string): string {
  const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, "i");
  const match = xml.match(re);
  if (!match?.[1]) return "";
  return stripCdata(match[1]).trim();
}

/** Parse Google News RSS XML into SearchResult[]. Exported for testing. */
export function parseGoogleNewsRss(xml: string): SearchResult[] {
  const items: SearchResult[] = [];
  const itemRegex = /<item>([\s\S]*?)<\/item>/gi;
  let match: RegExpExecArray | null;

  while ((match = itemRegex.exec(xml)) !== null) {
    const block = match[1];
    const title = extractTag(block, "title");
    const link = extractTagRaw(block, "link");
    if (!title || !link) continue;

    const description = extractTag(block, "description");
    const pubDate = extractTagRaw(block, "pubDate");
    const source = extractTag(block, "source");

    const snippet = source
      ? `${source}: ${description}`.slice(0, 300)
      : description.slice(0, 300);

    items.push({
      title,
      url: link,
      snippet: snippet || undefined,
      publishedDate: pubDate || undefined,
    });

    if (items.length >= DEFAULT_LIMIT) break;
  }

  return items;
}

// ============================================================
// Fetch
// ============================================================

export interface GoogleNewsOptions {
  limit?: number;
  timeoutMs?: number;
  locale?: string;
}

function resolveGoogleNewsLocale(locale?: string): { hl: string; gl: string; ceid: string } {
  if (!locale) return { hl: "en", gl: "US", ceid: "US:en" };

  const [countryPart, languagePart] = locale.toLowerCase().split("-");
  if (!countryPart || !languagePart) return { hl: "en", gl: "US", ceid: "US:en" };

  const gl = countryPart.toUpperCase();
  const hl = languagePart.toLowerCase();
  return { hl, gl, ceid: `${gl}:${hl}` };
}

/** Fetch Google News RSS results. Returns [] on any failure (never throws). */
export async function fetchGoogleNewsResults(
  query: string,
  opts?: GoogleNewsOptions,
): Promise<SearchResult[]> {
  try {
    const limit = Math.min(opts?.limit ?? DEFAULT_LIMIT, DEFAULT_LIMIT);
    const timeoutMs = Math.min(opts?.timeoutMs ?? DEFAULT_TIMEOUT_MS, DEFAULT_TIMEOUT_MS);
    const locale = resolveGoogleNewsLocale(opts?.locale);

    const params = new URLSearchParams({
      q: query,
      hl: locale.hl,
      gl: locale.gl,
      ceid: locale.ceid,
    });
    const url = `${GOOGLE_NEWS_RSS_BASE}?${params}`;

    const response = await withRetry(
      () => http.fetchRaw(url, {
        timeout: timeoutMs,
        headers: {
          "Accept": "application/rss+xml, application/xml, text/xml",
          "User-Agent": DEFAULT_USER_AGENT,
        },
      }),
      { maxAttempts: 2, initialDelayMs: 300, shouldRetry: isTransientHttpError },
    );

    if (!response.ok) return [];

    const xml = await response.text();
    return parseGoogleNewsRss(xml).slice(0, limit);
  } catch {
    return [];
  }
}
