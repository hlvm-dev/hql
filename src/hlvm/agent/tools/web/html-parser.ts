/**
 * HTML parsing: content extraction, boilerplate stripping, metadata extraction.
 * Extracted from web-tools.ts for modularity.
 */

// ============================================================
// Constants
// ============================================================

export const MAIN_CONTENT_MIN_CHARS = 200;
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

// ============================================================
// Entity Decoding & Attribute Parsing
// ============================================================

export function decodeHtmlEntities(input: string): string {
  const map: Record<string, string> = {
    "&amp;": "&",
    "&lt;": "<",
    "&gt;": ">",
    "&quot;": '"',
    "&#39;": "'",
    "&apos;": "'",
    "&nbsp;": " ",
  };
  return input.replace(
    /&(amp|lt|gt|quot|#39|apos|nbsp);/g,
    (match) => map[match] ?? match,
  );
}

export function parseAttributes(tag: string): Record<string, string> {
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

// ============================================================
// Structure Extraction
// ============================================================

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

// ============================================================
// Boilerplate Stripping
// ============================================================

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
  `<([a-zA-Z0-9]+)\\b[^>]*(?:class|id)\\s*=\\s*["'][^"']*(?:${
    BOILERPLATE_KEYWORDS.join("|")
  })[^"']*["'][^>]*>[\\s\\S]*?<\\/\\1>`,
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

// ============================================================
// Content Extraction
// ============================================================

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

// ============================================================
// Public API
// ============================================================

export function parseHtml(
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

/**
 * Extract publication date from HTML structured metadata.
 * Checks article:published_time, meta date/publish_date, JSON-LD datePublished,
 * and <time datetime>.
 */
export function extractPublicationDate(html: string): string | undefined {
  const isValidDate = (value: string): boolean => !Number.isNaN(Date.parse(value));
  const findJsonLdDate = (value: unknown): string | undefined => {
    if (Array.isArray(value)) {
      for (const item of value) {
        const fromArray = findJsonLdDate(item);
        if (fromArray) return fromArray;
      }
      return undefined;
    }
    if (!value || typeof value !== "object") return undefined;
    const record = value as Record<string, unknown>;
    const direct = record.datePublished ?? record.dateCreated ?? record.uploadDate;
    if (typeof direct === "string") {
      const candidate = direct.trim();
      if (candidate && isValidDate(candidate)) return candidate;
    }
    for (const nested of Object.values(record)) {
      const fromNested = findJsonLdDate(nested);
      if (fromNested) return fromNested;
    }
    return undefined;
  };

  const metaRegex = /<meta\s+[^>]*>/gi;
  let match: RegExpExecArray | null;
  while ((match = metaRegex.exec(html)) !== null) {
    const attrs = parseAttributes(match[0]);
    const name = (attrs.name ?? "").toLowerCase();
    const property = (attrs.property ?? "").toLowerCase();
    const content = (attrs.content ?? "").trim();
    if (!content) continue;
    if (
      property === "article:published_time" ||
      name === "date" ||
      name === "publish_date" ||
      name === "publishdate"
    ) {
      if (isValidDate(content)) return content;
    }
  }

  // Fallback: JSON-LD blocks with datePublished/dateCreated/uploadDate.
  const jsonLdRegex =
    /<script\b[^>]*\btype\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  while ((match = jsonLdRegex.exec(html)) !== null) {
    const rawJson = decodeHtmlEntities((match[1] ?? "").trim())
      .replace(/^\s*<!--/, "")
      .replace(/-->\s*$/, "")
      .trim();
    if (!rawJson) continue;
    try {
      const parsed = JSON.parse(rawJson);
      const jsonLdDate = findJsonLdDate(parsed);
      if (jsonLdDate) return jsonLdDate;
    } catch {
      // Best-effort parse; ignore malformed JSON-LD.
    }
  }

  // Fallback: first <time datetime="...">
  const timeMatch = html.match(/<time\b[^>]*\bdatetime\s*=\s*["']([^"']+)["'][^>]*>/i);
  if (timeMatch?.[1]) {
    const dt = timeMatch[1].trim();
    if (isValidDate(dt)) return dt;
  }

  return undefined;
}

export function isHtmlLikeResponse(contentType: string, body: string): boolean {
  const normalizedType = contentType.toLowerCase();
  if (
    normalizedType.includes("text/html") ||
    normalizedType.includes("application/xhtml+xml")
  ) {
    return true;
  }

  if (
    normalizedType && (
      normalizedType.includes("application/json") ||
      normalizedType.includes("text/plain") ||
      normalizedType.includes("application/pdf") ||
      normalizedType.startsWith("image/")
    )
  ) {
    return false;
  }

  const head = body.slice(0, 1024).toLowerCase();
  return head.includes("<html") ||
    head.includes("<body") ||
    head.includes("<!doctype html");
}

export async function extractReadableContent(
  html: string,
  url: string,
): Promise<{ title?: string; content?: string; text?: string } | null> {
  try {
    const { JSDOM } = await import("jsdom");
    const { Readability } = await import("@mozilla/readability");
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
