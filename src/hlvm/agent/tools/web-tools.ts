/**
 * Web Tools - Internet search and fetch utilities (policy-gated)
 *
 * Provides minimal web capabilities:
 * - search_web: query a public search endpoint (DuckDuckGo Instant Answer)
 * - fetch_url: fetch a URL with byte limits and policy checks
 *
 * SSOT: Uses common/http-client.ts for HTTP.
 */

import { http } from "../../../common/http-client.ts";
import { ValidationError } from "../../../common/error.ts";
import { isNetworkAllowed, getNetworkPolicyDeniedUrl } from "../policy.ts";
import type { ToolExecutionOptions, ToolMetadata } from "../registry.ts";
import { RESOURCE_LIMITS } from "../constants.ts";
import { loadWebConfig } from "../web-config.ts";
import { getWebCacheValue, setWebCacheValue } from "../web-cache.ts";

// ============================================================
// Types
// ============================================================

interface FetchUrlArgs {
  url: string;
  maxBytes?: number;
  timeoutMs?: number;
}

interface SearchWebArgs {
  query: string;
  maxResults?: number;
  timeoutMs?: number;
  timeoutSeconds?: number;
}

interface WebFetchArgs {
  url: string;
  maxChars?: number;
  timeoutSeconds?: number;
}

interface SearchResult {
  title: string;
  url?: string;
  snippet?: string;
  score?: number;
}

// ============================================================
// Internal Helpers
// ============================================================

const DEFAULT_WEB_MAX_BYTES = RESOURCE_LIMITS.maxTotalToolResultBytes;
const DEFAULT_WEB_RESULTS = 5;
const DEFAULT_HTML_TEXT_LIMIT = 4000;
const DEFAULT_HTML_LINKS = 20;
const MAIN_CONTENT_MIN_CHARS = 200;
const BOILERPLATE_KEYWORDS = [
  "nav",
  "menu",
  "footer",
  "header",
  "sidebar",
  "sidenav",
  "breadcrumb",
  "ads",
  "advert",
  "promo",
  "sponsor",
  "cookie",
  "banner",
  "modal",
  "popup",
  "subscribe",
  "signin",
  "signup",
];

function tokenizeQuery(query: string): string[] {
  return query
    .toLowerCase()
    .split(/[\s\-_.]+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 3);
}

function scoreSearchResult(query: string, result: SearchResult): number {
  const tokens = tokenizeQuery(query);
  if (tokens.length === 0) return 0;
  const title = (result.title ?? "").toLowerCase();
  const snippet = (result.snippet ?? "").toLowerCase();
  const url = (result.url ?? "").toLowerCase();
  let score = 0;
  for (const token of tokens) {
    if (title.includes(token)) score += 3;
    if (snippet.includes(token)) score += 1;
    if (url.includes(token)) score += 1;
  }
  if (url.startsWith("https://")) score += 1;
  return score;
}

export function scoreSearchResults(
  query: string,
  results: SearchResult[],
): SearchResult[] {
  const scored = results.map((result) => ({
    ...result,
    score: scoreSearchResult(query, result),
  }));
  return scored.sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
}

function assertUrlAllowed(
  url: string,
  options?: ToolExecutionOptions,
): void {
  const policy = options?.policy ?? null;
  if (!isNetworkAllowed(policy, url)) {
    const denied = getNetworkPolicyDeniedUrl(policy, [url]) ?? url;
    throw new ValidationError(`URL denied by policy: ${denied}`, "network_policy");
  }
}

function toMillis(seconds: number | undefined): number | undefined {
  if (typeof seconds !== "number" || Number.isNaN(seconds)) return undefined;
  if (seconds <= 0) return 0;
  return Math.round(seconds * 1000);
}

function makeCacheKey(prefix: string, parts: Array<string | number | undefined>): string {
  const safe = parts.map((part) => String(part ?? "").trim()).join("|");
  return `${prefix}:${safe}`;
}

async function readResponseBody(
  response: Response,
  maxBytes: number,
): Promise<{ text: string; bytes: number; truncated: boolean }> {
  if (!response.body) {
    return { text: "", bytes: 0, truncated: false };
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  let truncated = false;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;

      const remaining = maxBytes - total;
      if (remaining <= 0) {
        truncated = true;
        break;
      }

      if (value.length > remaining) {
        chunks.push(value.slice(0, remaining));
        total += remaining;
        truncated = true;
        break;
      }

      chunks.push(value);
      total += value.length;
    }
  } finally {
    if (truncated) {
      try {
        await reader.cancel();
      } catch {
        // Best-effort cancellation
      }
    }
    reader.releaseLock();
  }

  const buffer = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    buffer.set(chunk, offset);
    offset += chunk.length;
  }

  return {
    text: new TextDecoder().decode(buffer),
    bytes: total,
    truncated,
  };
}

async function fetchWithRedirects(
  url: string,
  timeoutMs: number | undefined,
  headers: Record<string, string>,
  maxRedirects: number,
  options?: ToolExecutionOptions,
): Promise<{ finalUrl: string; response: Response; redirects: string[] }> {
  let current = url;
  const redirects: string[] = [];
  const visited = new Set<string>();
  const redirectLimit = Math.max(0, maxRedirects);

  for (let attempt = 0; attempt <= redirectLimit; attempt++) {
    assertUrlAllowed(current, options);
    const response = await http.fetchRaw(current, {
      timeout: timeoutMs,
      headers,
      redirect: "manual",
    });
    const status = response.status;
    const isRedirect = status === 301 || status === 302 || status === 303 || status === 307 || status === 308;
    if (!isRedirect) {
      return { finalUrl: current, response, redirects };
    }
    const location = response.headers.get("location");
    if (!location) {
      return { finalUrl: current, response, redirects };
    }
    const nextUrl = new URL(location, current).toString();
    if (visited.has(nextUrl)) {
      throw new ValidationError(`Redirect loop detected for ${url}`, "web_fetch");
    }
    visited.add(nextUrl);
    redirects.push(nextUrl);
    current = nextUrl;
  }

  throw new ValidationError(`Too many redirects for ${url}`, "web_fetch");
}

function truncateText(
  text: string,
  maxChars: number,
): { text: string; truncated: boolean } {
  if (maxChars <= 0) return { text, truncated: false };
  if (text.length <= maxChars) return { text, truncated: false };
  return { text: text.slice(0, maxChars), truncated: true };
}

async function extractReadableContent(
  html: string,
  url: string,
): Promise<{ title?: string; content?: string; text?: string } | null> {
  try {
    const { JSDOM } = await import("npm:jsdom@22.1.0");
    const { Readability } = await import("npm:@mozilla/readability@0.5.0");
    const dom = new JSDOM(html, { url });
    const reader = new Readability(dom.window.document);
    const article = reader.parse();
    if (!article) return null;
    return {
      title: article.title ?? undefined,
      content: article.content ?? undefined,
      text: article.textContent ?? undefined,
    };
  } catch {
    return null;
  }
}

async function fetchWithFirecrawl(
  url: string,
  config: {
    apiKey?: string;
    baseUrl: string;
    onlyMainContent: boolean;
    maxAgeMs: number;
    timeoutSeconds: number;
  },
  options?: ToolExecutionOptions,
): Promise<{ content?: string; markdown?: string; title?: string; description?: string } | null> {
  if (!config.apiKey) return null;
  const base = config.baseUrl.replace(/\/+$/, "");
  const endpoint = base.endsWith("/v1/scrape") ? base : `${base}/v1/scrape`;
  assertUrlAllowed(endpoint, options);

  const timeoutMs = toMillis(config.timeoutSeconds);
  const headers: Record<string, string> = {
    "x-api-key": config.apiKey,
    "Authorization": `Bearer ${config.apiKey}`,
  };
  try {
    const response = await http.post<Record<string, unknown>>(
      endpoint,
      {
        url,
        formats: ["markdown", "html"],
        onlyMainContent: config.onlyMainContent,
        maxAge: config.maxAgeMs,
        timeout: timeoutMs,
      },
      { timeout: timeoutMs, headers },
    );

    const data = response as Record<string, unknown>;
    const payload = (data.data as Record<string, unknown> | undefined) ?? data;
    if (!payload || typeof payload !== "object") return null;
    const markdown = typeof payload.markdown === "string" ? payload.markdown : undefined;
    const content = typeof payload.content === "string" ? payload.content : undefined;
    const metadata = (payload.metadata as Record<string, unknown> | undefined) ?? undefined;
    const title = metadata && typeof metadata.title === "string" ? metadata.title : undefined;
    const description = metadata && typeof metadata.description === "string" ? metadata.description : undefined;
    return { content, markdown, title, description };
  } catch {
    return null;
  }
}

function decodeHtmlEntities(input: string): string {
  const map: Record<string, string> = {
    "&amp;": "&",
    "&lt;": "<",
    "&gt;": ">",
    "&quot;": "\"",
    "&#39;": "'",
    "&apos;": "'",
    "&nbsp;": " ",
  };
  return input.replace(
    /&(amp|lt|gt|quot|#39|apos|nbsp);/g,
    (match) => map[match] ?? match,
  );
}

function findLargestTagBlock(html: string, tag: string): string | null {
  const regex = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, "gi");
  let match: RegExpExecArray | null;
  let best = "";
  while ((match = regex.exec(html)) !== null) {
    const candidate = match[1] ?? "";
    if (candidate.length > best.length) {
      best = candidate;
    }
  }
  return best.length > 0 ? best : null;
}

function pickMainHtml(html: string): string {
  const main = findLargestTagBlock(html, "main");
  if (main && main.length >= MAIN_CONTENT_MIN_CHARS) return main;

  const article = findLargestTagBlock(html, "article");
  if (article && article.length >= MAIN_CONTENT_MIN_CHARS) return article;

  const body = findLargestTagBlock(html, "body");
  if (body) return body;

  return html;
}

/** Cache compiled tag-block regexes (single alternation per tag set) */
const _tagBlockRegexCache = new Map<string, RegExp>();

function stripTagBlocks(html: string, tags: string[]): string {
  const key = tags.join(",");
  let regex = _tagBlockRegexCache.get(key);
  if (!regex) {
    const alternation = tags.join("|");
    regex = new RegExp(
      `<(?:${alternation})\\b[^>]*>[\\s\\S]*?<\\/(?:${alternation})>`,
      "gi",
    );
    _tagBlockRegexCache.set(key, regex);
  }
  regex.lastIndex = 0;
  return html.replace(regex, " ");
}

/** Pre-compiled boilerplate regex (keywords never change at runtime) */
const BOILERPLATE_ATTR_REGEX = new RegExp(
  `<([a-zA-Z0-9]+)\\b[^>]*(?:class|id)\\s*=\\s*["'][^"']*(?:${BOILERPLATE_KEYWORDS.join("|")})[^"']*["'][^>]*>[\\s\\S]*?<\\/\\1>`,
  "gi",
);

function stripBoilerplateByAttributes(html: string): string {
  BOILERPLATE_ATTR_REGEX.lastIndex = 0;
  return html.replace(BOILERPLATE_ATTR_REGEX, " ");
}

function stripBoilerplateByRole(html: string): string {
  const roleRegex = new RegExp(
    `<([a-zA-Z0-9]+)\\b[^>]*\\brole\\s*=\\s*["'](?:navigation|banner|contentinfo|complementary)["'][^>]*>[\\s\\S]*?<\\/\\1>`,
    "gi",
  );
  return html.replace(roleRegex, " ");
}

function normalizeHtmlForExtraction(html: string): string {
  let output = pickMainHtml(html);
  output = output.replace(/<!--[\s\S]*?-->/g, " ");
  output = stripTagBlocks(output, [
    "script",
    "style",
    "noscript",
    "svg",
    "canvas",
    "iframe",
    "template",
    "figure",
    "form",
    "button",
    "select",
    "textarea",
    "option",
  ]);
  output = stripTagBlocks(output, [
    "nav",
    "header",
    "footer",
    "aside",
    "menu",
  ]);
  output = stripBoilerplateByRole(output);
  output = stripBoilerplateByAttributes(output);
  return output;
}

function parseAttributes(tag: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const attrRegex =
    /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^"\s>]+))/g;
  let match: RegExpExecArray | null;
  while ((match = attrRegex.exec(tag)) !== null) {
    const key = match[1].toLowerCase();
    const value = match[2] ?? match[3] ?? match[4] ?? "";
    attrs[key] = value;
  }
  return attrs;
}

function extractTitle(html: string): string {
  const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (!match?.[1]) return "";
  return decodeHtmlEntities(match[1].replace(/\s+/g, " ").trim());
}

function extractMetaDescription(html: string): string {
  const metaRegex = /<meta\s+[^>]*>/gi;
  let match: RegExpExecArray | null;
  while ((match = metaRegex.exec(html)) !== null) {
    const attrs = parseAttributes(match[0]);
    const name = (attrs.name ?? attrs.property ?? "").toLowerCase();
    if (name === "description" || name === "og:description") {
      const content = attrs.content ?? "";
      if (content) {
        return decodeHtmlEntities(content.replace(/\s+/g, " ").trim());
      }
    }
  }
  return "";
}

function extractLinks(html: string, maxLinks: number): string[] {
  const links: string[] = [];
  const seen = new Set<string>();
  const linkRegex = /<a\s+[^>]*>/gi;
  let match: RegExpExecArray | null;
  while ((match = linkRegex.exec(html)) !== null) {
    const attrs = parseAttributes(match[0]);
    const href = attrs.href;
    if (!href) continue;
    const decoded = decodeHtmlEntities(href.trim());
    if (
      decoded === "" ||
      decoded.startsWith("#") ||
      decoded.toLowerCase().startsWith("javascript:")
    ) {
      continue;
    }
    if (!seen.has(decoded)) {
      seen.add(decoded);
      links.push(decoded);
      if (links.length >= maxLinks) break;
    }
  }
  return links;
}

function extractTextContent(
  html: string,
  maxTextLength: number,
): { text: string; truncated: boolean } {
  const blockTags = [
    "p",
    "div",
    "br",
    "li",
    "h1",
    "h2",
    "h3",
    "h4",
    "h5",
    "h6",
    "tr",
    "td",
    "th",
    "section",
    "article",
    "header",
    "footer",
    "nav",
    "aside",
    "ul",
    "ol",
    "table",
    "tbody",
    "thead",
    "tfoot",
    "hr",
  ];
  const blockRegex = new RegExp(
    `<\\/?(?:${blockTags.join("|")})\\b[^>]*>`,
    "gi",
  );

  let text = html
    .replace(blockRegex, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/\r/g, "");

  text = decodeHtmlEntities(text);
  text = text.replace(/[ \t]+/g, " ").replace(/\n\s*\n+/g, "\n\n").trim();

  let truncated = false;
  if (text.length > maxTextLength) {
    text = text.slice(0, maxTextLength);
    truncated = true;
  }

  return { text, truncated };
}

function parseHtml(
  html: string,
  maxTextLength: number,
  maxLinks: number,
): {
  title: string;
  description: string;
  text: string;
  textTruncated: boolean;
  links: string[];
  linkCount: number;
} {
  const normalized = normalizeHtmlForExtraction(html);
  const title = extractTitle(html);
  const description = extractMetaDescription(html);
  const { text, truncated } = extractTextContent(normalized, maxTextLength);
  const links = extractLinks(normalized, maxLinks);

  return {
    title,
    description,
    text,
    textTruncated: truncated,
    links,
    linkCount: links.length,
  };
}

async function fetchUrlInternal(
  url: string,
  maxBytes: number | undefined,
  timeoutMs: number | undefined,
  options?: ToolExecutionOptions,
): Promise<{
  url: string;
  status: number;
  ok: boolean;
  contentType: string;
  bytes: number;
  truncated: boolean;
  text: string;
}> {
  assertUrlAllowed(url, options);

  const response = await http.fetchRaw(url, {
    timeout: timeoutMs,
  });

  const limit = typeof maxBytes === "number" && maxBytes > 0
    ? maxBytes
    : DEFAULT_WEB_MAX_BYTES;
  const body = await readResponseBody(response, limit);

  return {
    url,
    status: response.status,
    ok: response.ok,
    contentType: response.headers.get("content-type") ?? "",
    bytes: body.bytes,
    truncated: body.truncated,
    text: body.text,
  };
}

// ============================================================
// Tool Implementations
// ============================================================

async function fetchUrl(
  args: unknown,
  _workspace: string,
  options?: ToolExecutionOptions,
): Promise<Record<string, unknown>> {
  if (!args || typeof args !== "object") {
    throw new ValidationError("args must be an object", "fetch_url");
  }

  const { url, maxBytes, timeoutMs } = args as FetchUrlArgs;
  if (!url || typeof url !== "string") {
    throw new ValidationError("url is required", "fetch_url");
  }

  return await fetchUrlInternal(url, maxBytes, timeoutMs, options);
}

async function webFetch(
  args: unknown,
  _workspace: string,
  options?: ToolExecutionOptions,
): Promise<Record<string, unknown>> {
  if (!args || typeof args !== "object") {
    throw new ValidationError("args must be an object", "web_fetch");
  }

  const { url, maxChars, timeoutSeconds } = args as WebFetchArgs;
  if (!url || typeof url !== "string") {
    throw new ValidationError("url is required", "web_fetch");
  }

  const webConfig = await loadWebConfig();
  if (!webConfig.fetch.enabled) {
    throw new ValidationError("web fetch is disabled", "web_fetch");
  }

  const resolvedMaxChars = typeof maxChars === "number" && maxChars > 0
    ? maxChars
    : webConfig.fetch.maxChars;
  const timeoutMs = toMillis(timeoutSeconds ?? webConfig.fetch.timeoutSeconds);

  const cacheKey = makeCacheKey("web_fetch", [url, resolvedMaxChars]);
  if (webConfig.fetch.cacheTtlMinutes > 0) {
    const cached = await getWebCacheValue<Record<string, unknown>>(cacheKey);
    if (cached) {
      return { ...cached, cached: true };
    }
  }

  const headers: Record<string, string> = {
    "User-Agent": webConfig.fetch.userAgent,
    "Accept":
      "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  };

  const { finalUrl, response, redirects } = await fetchWithRedirects(
    url,
    timeoutMs,
    headers,
    webConfig.fetch.maxRedirects,
    options,
  );

  const maxBytes = Math.max(
    DEFAULT_WEB_MAX_BYTES,
    Math.max(1, resolvedMaxChars) * 4,
  );
  const body = await readResponseBody(response, maxBytes);
  const contentType = response.headers.get("content-type") ?? "";
  const html = body.text ?? "";

  const parsed = parseHtml(html, resolvedMaxChars, DEFAULT_HTML_LINKS);

  let text = parsed.text;
  let textTruncated = parsed.textTruncated;
  let content: string | undefined;
  let usedReadability = false;
  let usedFirecrawl = false;

  if (webConfig.fetch.readability && html) {
    const readable = await extractReadableContent(html, finalUrl);
    if (readable?.text) {
      usedReadability = true;
      text = readable.text;
      content = readable.content ?? content;
      if (readable.title) {
        parsed.title = readable.title;
      }
      const truncated = truncateText(text, resolvedMaxChars);
      text = truncated.text;
      textTruncated = textTruncated || truncated.truncated;
    }
  }

  if (
    (text?.trim().length ?? 0) < MAIN_CONTENT_MIN_CHARS &&
    webConfig.fetch.firecrawl.enabled
  ) {
    const firecrawl = await fetchWithFirecrawl(
      finalUrl,
      webConfig.fetch.firecrawl,
      options,
    );
    if (firecrawl?.content || firecrawl?.markdown) {
      usedFirecrawl = true;
      content = firecrawl.markdown ?? firecrawl.content ?? content;
      if (content) {
        const truncated = truncateText(content, resolvedMaxChars);
        text = truncated.text;
        textTruncated = truncated.truncated;
      }
      if (firecrawl.title) parsed.title = firecrawl.title;
      if (firecrawl.description) parsed.description = firecrawl.description;
    }
  }

  const result = {
    url: finalUrl,
    status: response.status,
    ok: response.ok,
    contentType,
    bytes: body.bytes,
    truncated: body.truncated,
    title: parsed.title,
    description: parsed.description,
    text,
    textTruncated,
    links: parsed.links,
    linkCount: parsed.linkCount,
    content,
    readability: usedReadability,
    firecrawl: usedFirecrawl,
    redirects,
  };

  if (webConfig.fetch.cacheTtlMinutes > 0) {
    await setWebCacheValue(cacheKey, result, webConfig.fetch.cacheTtlMinutes);
  }

  return result;
}

async function braveSearch(
  query: string,
  limit: number,
  timeoutMs: number | undefined,
  apiKey: string,
  options?: ToolExecutionOptions,
): Promise<Record<string, unknown>> {
  const endpoint =
    `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=${limit}`;
  assertUrlAllowed(endpoint, options);

  interface BraveResponse {
    web?: {
      results?: Array<{ title?: string; url?: string; description?: string; snippet?: string }>;
    };
  }

  const data = await http.fetchJson<BraveResponse>(endpoint, {
    timeout: timeoutMs,
    headers: {
      "Accept": "application/json",
      "X-Subscription-Token": apiKey,
    },
  });

  const results = (data.web?.results ?? []).map((entry) => ({
    title: entry.title ?? "",
    url: entry.url ?? "",
    snippet: entry.description ?? entry.snippet ?? "",
  })).filter((entry) => entry.title || entry.url || entry.snippet);
  const scored = scoreSearchResults(query, results);

  return {
    query,
    provider: "brave",
    results: scored.slice(0, limit),
    count: scored.slice(0, limit).length,
  };
}

async function serpApiSearch(
  query: string,
  limit: number,
  timeoutMs: number | undefined,
  config: { apiKey: string; baseUrl: string },
  options?: ToolExecutionOptions,
): Promise<Record<string, unknown>> {
  const baseUrl = config.baseUrl.replace(/\/+$/, "");
  const endpoint =
    `${baseUrl}/search.json?q=${encodeURIComponent(query)}&engine=google&num=${limit}&api_key=${config.apiKey}`;
  assertUrlAllowed(endpoint, options);

  interface SerpApiResponse {
    organic_results?: Array<{ title?: string; link?: string; snippet?: string }>;
    answer_box?: { answer?: string; snippet?: string; title?: string; link?: string };
  }

  const data = await http.fetchJson<SerpApiResponse>(endpoint, {
    timeout: timeoutMs,
    headers: { "Accept": "application/json" },
  });

  const results = (data.organic_results ?? []).map((entry) => ({
    title: entry.title ?? "",
    url: entry.link ?? "",
    snippet: entry.snippet ?? "",
  })).filter((entry) => entry.title || entry.url || entry.snippet);

  const scored = scoreSearchResults(query, results);
  const answer = data.answer_box?.answer ?? data.answer_box?.snippet ?? "";
  const citations = data.answer_box?.link ? [data.answer_box.link] : [];

  return {
    query,
    provider: "serpapi",
    answer,
    citations,
    results: scored.slice(0, limit),
    count: scored.slice(0, limit).length,
  };
}

async function chatCompletionsSearch(
  query: string,
  limit: number,
  timeoutMs: number | undefined,
  config: { apiKey: string; baseUrl: string; model: string },
  provider: string,
  options?: ToolExecutionOptions,
): Promise<Record<string, unknown>> {
  const endpoint = `${config.baseUrl.replace(/\/+$/, "")}/chat/completions`;
  assertUrlAllowed(endpoint, options);

  const data = await http.post<Record<string, unknown>>(
    endpoint,
    {
      model: config.model,
      messages: [
        {
          role: "system",
          content:
            "Search the web and answer with citations. Return citations as URLs when possible.",
        },
        { role: "user", content: query },
      ],
      temperature: 0.2,
    },
    {
      timeout: timeoutMs,
      headers: {
        "Authorization": `Bearer ${config.apiKey}`,
      },
    },
  );

  const choices = (data as { choices?: Array<{ message?: { content?: string; citations?: string[] } }> }).choices ??
    [];
  const answer = choices[0]?.message?.content ?? "";
  const citations = (data as { citations?: string[] }).citations ??
    choices[0]?.message?.citations ??
    [];

  return {
    query,
    provider,
    answer,
    citations,
    count: Math.min(limit, citations.length),
  };
}

async function searchWeb(
  args: unknown,
  _workspace: string,
  options?: ToolExecutionOptions,
): Promise<Record<string, unknown>> {
  if (!args || typeof args !== "object") {
    throw new ValidationError("args must be an object", "search_web");
  }

  const { query, maxResults, timeoutMs, timeoutSeconds } = args as SearchWebArgs;
  if (!query || typeof query !== "string") {
    throw new ValidationError("query is required", "search_web");
  }

  const webConfig = await loadWebConfig();
  if (!webConfig.search.enabled) {
    throw new ValidationError("web search is disabled", "search_web");
  }

  const limit = typeof maxResults === "number" && maxResults > 0
    ? maxResults
    : webConfig.search.maxResults ?? DEFAULT_WEB_RESULTS;
  const timeout = typeof timeoutMs === "number" && timeoutMs > 0
    ? timeoutMs
    : toMillis(timeoutSeconds ?? webConfig.search.timeoutSeconds);

  const cacheKey = makeCacheKey(`search_web:${webConfig.search.provider}`, [
    query,
    limit,
  ]);
  if (webConfig.search.cacheTtlMinutes > 0) {
    const cached = await getWebCacheValue<Record<string, unknown>>(cacheKey);
    if (cached) {
      return { ...cached, cached: true };
    }
  }

  let result: Record<string, unknown>;
  switch (webConfig.search.provider) {
    case "perplexity": {
      const apiKey = webConfig.search.perplexity.apiKey;
      if (!apiKey) {
        throw new ValidationError(
          "Perplexity API key missing. Set tools.web.search.perplexity.apiKey or PERPLEXITY_API_KEY.",
          "search_web",
        );
      }
      result = await chatCompletionsSearch(
        query,
        limit,
        timeout,
        {
          apiKey,
          baseUrl: webConfig.search.perplexity.baseUrl,
          model: webConfig.search.perplexity.model,
        },
        "perplexity",
        options,
      );
      break;
    }
    case "openrouter": {
      const apiKey = webConfig.search.openrouter.apiKey;
      if (!apiKey) {
        throw new ValidationError(
          "OpenRouter API key missing. Set tools.web.search.openrouter.apiKey or OPENROUTER_API_KEY.",
          "search_web",
        );
      }
      result = await chatCompletionsSearch(
        query,
        limit,
        timeout,
        {
          apiKey,
          baseUrl: webConfig.search.openrouter.baseUrl,
          model: webConfig.search.openrouter.model,
        },
        "openrouter",
        options,
      );
      break;
    }
    case "serpapi": {
      const apiKey = webConfig.search.serpapi.apiKey;
      if (!apiKey) {
        throw new ValidationError(
          "SerpAPI key missing. Set tools.web.search.serpapi.apiKey or SERPAPI_API_KEY.",
          "search_web",
        );
      }
      result = await serpApiSearch(
        query,
        limit,
        timeout,
        {
          apiKey,
          baseUrl: webConfig.search.serpapi.baseUrl,
        },
        options,
      );
      break;
    }
    case "brave":
    default: {
      const apiKey = webConfig.search.brave.apiKey;
      if (!apiKey) {
        throw new ValidationError(
          "Brave API key missing. Set tools.web.search.brave.apiKey or BRAVE_API_KEY.",
          "search_web",
        );
      }
      result = await braveSearch(query, limit, timeout, apiKey, options);
      break;
    }
  }

  if (webConfig.search.cacheTtlMinutes > 0) {
    await setWebCacheValue(cacheKey, result, webConfig.search.cacheTtlMinutes);
  }

  return result;
}

// ============================================================
// Tool Registry
// ============================================================

export const WEB_TOOLS: Record<string, ToolMetadata> = {
  search_web: {
    fn: searchWeb,
    description:
      "Search the web for a query (OpenClaw-style: Brave/Perplexity). Returns snippets and URLs or an answer with citations.",
    args: {
      query: "string - Search query",
      maxResults: "number (optional) - Max results (default: 5)",
      timeoutMs: "number (optional) - Request timeout in ms",
      timeoutSeconds: "number (optional) - Request timeout in seconds",
    },
    returns: {
      results: "Array<{title, url?, snippet?}>",
      answer: "string (optional)",
      citations: "string[] (optional)",
      count: "number",
      provider: "string",
    },
    safetyLevel: "L1",
    safety: "External network access (policy-gated).",
  },
  fetch_url: {
    fn: fetchUrl,
    description:
      "Fetch a URL and return text content with size limits.",
    args: {
      url: "string - URL to fetch",
      maxBytes: `number (optional) - Max bytes to read (default: ${DEFAULT_WEB_MAX_BYTES})`,
      timeoutMs: "number (optional) - Request timeout in ms",
    },
    returns: {
      status: "number",
      ok: "boolean",
      contentType: "string",
      bytes: "number",
      truncated: "boolean",
      text: "string",
    },
    safetyLevel: "L1",
    safety: "External network access (policy-gated).",
  },
  web_fetch: {
    fn: webFetch,
    description:
      "OpenClaw-style fetch with readability + Firecrawl fallback. Returns main content.",
    args: {
      url: "string - URL to fetch",
      maxChars: "number (optional) - Max extracted text length (default: 50000)",
      timeoutSeconds: "number (optional) - Request timeout in seconds",
    },
    returns: {
      url: "string",
      status: "number",
      ok: "boolean",
      contentType: "string",
      bytes: "number",
      truncated: "boolean",
      title: "string",
      description: "string",
      text: "string",
      textTruncated: "boolean",
      links: "string[]",
      linkCount: "number",
      content: "string (optional)",
      readability: "boolean",
      firecrawl: "boolean",
      redirects: "string[]",
    },
    safetyLevel: "L1",
    safety: "External network access (policy-gated).",
  },
};
