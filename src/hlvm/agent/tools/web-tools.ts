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
import { getErrorMessage } from "../../../common/utils.ts";

// ============================================================
// Types
// ============================================================

interface FetchUrlArgs {
  url: string;
  maxBytes?: number;
  timeoutMs?: number;
}

interface ExtractUrlArgs {
  url: string;
  maxBytes?: number;
  timeoutMs?: number;
  maxTextLength?: number;
  maxLinks?: number;
}

interface ExtractHtmlArgs {
  html: string;
  maxTextLength?: number;
  maxLinks?: number;
}

interface SearchWebArgs {
  query: string;
  maxResults?: number;
  timeoutMs?: number;
}

interface SearchResult {
  title: string;
  url?: string;
  snippet?: string;
}

// ============================================================
// Internal Helpers
// ============================================================

const DEFAULT_WEB_MAX_BYTES = RESOURCE_LIMITS.maxTotalToolResultBytes;
const DEFAULT_WEB_RESULTS = 10;
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

function stripTagBlocks(html: string, tags: string[]): string {
  let output = html;
  for (const tag of tags) {
    const regex = new RegExp(
      `<${tag}\\b[^>]*>[\\s\\S]*?<\\/${tag}>`,
      "gi",
    );
    output = output.replace(regex, " ");
  }
  return output;
}

function stripBoilerplateByAttributes(html: string): string {
  const keywordGroup = BOILERPLATE_KEYWORDS.join("|");
  const regex = new RegExp(
    `<([a-zA-Z0-9]+)\\b[^>]*(?:class|id)\\s*=\\s*["'][^"']*(?:${keywordGroup})[^"']*["'][^>]*>[\\s\\S]*?<\\/\\1>`,
    "gi",
  );
  return html.replace(regex, " ");
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

async function extractUrl(
  args: unknown,
  _workspace: string,
  options?: ToolExecutionOptions,
): Promise<Record<string, unknown>> {
  if (!args || typeof args !== "object") {
    throw new ValidationError("args must be an object", "extract_url");
  }

  const { url, maxBytes, timeoutMs, maxTextLength, maxLinks } =
    args as ExtractUrlArgs;
  if (!url || typeof url !== "string") {
    throw new ValidationError("url is required", "extract_url");
  }

  const fetched = await fetchUrlInternal(url, maxBytes, timeoutMs, options);

  const textLimit = typeof maxTextLength === "number" && maxTextLength > 0
    ? maxTextLength
    : DEFAULT_HTML_TEXT_LIMIT;
  const linkLimit = typeof maxLinks === "number" && maxLinks > 0
    ? maxLinks
    : DEFAULT_HTML_LINKS;

  const parsed = parseHtml(fetched.text, textLimit, linkLimit);

  return {
    ...fetched,
    title: parsed.title,
    description: parsed.description,
    text: parsed.text,
    textTruncated: parsed.textTruncated,
    links: parsed.links,
    linkCount: parsed.linkCount,
  };
}

async function extractHtml(
  args: unknown,
  _workspace: string,
): Promise<Record<string, unknown>> {
  if (!args || typeof args !== "object") {
    throw new ValidationError("args must be an object", "extract_html");
  }

  const { html, maxTextLength, maxLinks } = args as ExtractHtmlArgs;
  if (!html || typeof html !== "string") {
    throw new ValidationError("html is required", "extract_html");
  }

  const textLimit = typeof maxTextLength === "number" && maxTextLength > 0
    ? maxTextLength
    : DEFAULT_HTML_TEXT_LIMIT;
  const linkLimit = typeof maxLinks === "number" && maxLinks > 0
    ? maxLinks
    : DEFAULT_HTML_LINKS;

  const parsed = parseHtml(html, textLimit, linkLimit);

  return {
    title: parsed.title,
    description: parsed.description,
    text: parsed.text,
    textTruncated: parsed.textTruncated,
    links: parsed.links,
    linkCount: parsed.linkCount,
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

  const { query, maxResults, timeoutMs } = args as SearchWebArgs;
  if (!query || typeof query !== "string") {
    throw new ValidationError("query is required", "search_web");
  }

  const limit = typeof maxResults === "number" && maxResults > 0
    ? maxResults
    : DEFAULT_WEB_RESULTS;

  const endpoint = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`;
  assertUrlAllowed(endpoint, options);

  interface DuckDuckGoResponse {
    AbstractText?: string;
    Heading?: string;
    RelatedTopics?: Array<{ Text?: string; FirstURL?: string; Topics?: Array<{ Text?: string; FirstURL?: string }> }>;
  }

  let data: DuckDuckGoResponse;
  try {
    data = await http.get<DuckDuckGoResponse>(endpoint, { timeout: timeoutMs });
  } catch (error) {
    throw new ValidationError(`search_web failed: ${getErrorMessage(error)}`, "search_web");
  }

  const results: SearchResult[] = [];
  if (data.AbstractText) {
    results.push({
      title: data.Heading ?? "Summary",
      snippet: data.AbstractText,
    });
  }

  const pushTopic = (topic?: { Text?: string; FirstURL?: string }) => {
    if (!topic?.Text) return;
    const [title, snippet] = topic.Text.split(" - ");
    results.push({
      title: title ?? topic.Text,
      url: topic.FirstURL,
      snippet: snippet ?? "",
    });
  };

  for (const topic of data.RelatedTopics ?? []) {
    if (topic.Topics && Array.isArray(topic.Topics)) {
      for (const sub of topic.Topics) {
        pushTopic(sub);
        if (results.length >= limit) break;
      }
    } else {
      pushTopic(topic);
    }
    if (results.length >= limit) break;
  }

  return {
    query,
    source: "duckduckgo",
    results: results.slice(0, limit),
    count: results.slice(0, limit).length,
  };
}

// ============================================================
// Tool Registry
// ============================================================

export const WEB_TOOLS: Record<string, ToolMetadata> = {
  search_web: {
    fn: searchWeb,
    description:
      "Search the web for a query (DuckDuckGo). Returns snippets and URLs.",
    args: {
      query: "string - Search query",
      maxResults: "number (optional) - Max results (default: 10)",
      timeoutMs: "number (optional) - Request timeout in ms",
    },
    returns: {
      results: "Array<{title, url?, snippet?}>",
      count: "number",
      source: "string",
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
  extract_url: {
    fn: extractUrl,
    description:
      "Fetch a URL and extract title/description/text/links from HTML.",
    args: {
      url: "string - URL to fetch",
      maxBytes: `number (optional) - Max bytes to read (default: ${DEFAULT_WEB_MAX_BYTES})`,
      timeoutMs: "number (optional) - Request timeout in ms",
      maxTextLength: `number (optional) - Max extracted text length (default: ${DEFAULT_HTML_TEXT_LIMIT})`,
      maxLinks: `number (optional) - Max links to return (default: ${DEFAULT_HTML_LINKS})`,
    },
    returns: {
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
    },
    safetyLevel: "L1",
    safety: "External network access (policy-gated).",
  },
  extract_html: {
    fn: extractHtml,
    description:
      "Extract title/description/text/links from raw HTML.",
    args: {
      html: "string - HTML to parse",
      maxTextLength: `number (optional) - Max extracted text length (default: ${DEFAULT_HTML_TEXT_LIMIT})`,
      maxLinks: `number (optional) - Max links to return (default: ${DEFAULT_HTML_LINKS})`,
    },
    returns: {
      title: "string",
      description: "string",
      text: "string",
      textTruncated: "boolean",
      links: "string[]",
      linkCount: "number",
    },
    safetyLevel: "L0",
    safety: "Pure parsing, no external access.",
  },
};
