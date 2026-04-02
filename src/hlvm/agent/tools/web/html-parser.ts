/**
 * HTML parsing: content extraction, boilerplate stripping, metadata extraction.
 * Extracted from web-tools.ts for modularity.
 */

import he from "he";

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
  return he.decode(input);
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
// Structured Block Extraction
// ============================================================

function normalizeCellText(input: string): string {
  return decodeHtmlEntities(
    input.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim(),
  ).replace(/\|/g, "\\|");
}

function padTableRows(rows: string[][]): string[][] {
  const width = rows.reduce((max, row) => Math.max(max, row.length), 0);
  return rows.map((row) => [...row, ...Array.from({ length: Math.max(0, width - row.length) }, () => "")]);
}

function tableToMarkdown(tableHtml: string): string | null {
  const rows: Array<{ cells: string[]; header: boolean }> = [];
  const rowRegex = /<tr\b[^>]*>([\s\S]*?)<\/tr>/gi;
  let match: RegExpExecArray | null;
  while ((match = rowRegex.exec(tableHtml)) !== null) {
    const rowHtml = match[1] ?? "";
    const cells: string[] = [];
    const cellRegex = /<(t[hd])\b[^>]*>([\s\S]*?)<\/t[hd]>/gi;
    let cellMatch: RegExpExecArray | null;
    let header = false;
    while ((cellMatch = cellRegex.exec(rowHtml)) !== null) {
      const tag = (cellMatch[1] ?? "").toLowerCase();
      header = header || tag === "th";
      cells.push(normalizeCellText(cellMatch[2] ?? ""));
    }
    if (cells.length > 0) rows.push({ cells, header });
  }

  if (rows.length === 0) return null;

  const headerRow = rows[0].cells;
  const bodyRows = rows.length > 1 ? rows.slice(1).map((row) => row.cells) : [];
  const normalizedRows = padTableRows([headerRow, ...bodyRows]);
  const [header, ...body] = normalizedRows;
  if (header.length === 0) return null;

  const separator = header.map(() => "---");
  const lines = [
    `| ${header.join(" | ")} |`,
    `| ${separator.join(" | ")} |`,
    ...body.map((row) => `| ${row.join(" | ")} |`),
  ];
  return lines.join("\n");
}

function buildStructuredPlaceholder(counter: number): string {
  return `__STRUCTURED_BLOCK_${counter}__`;
}

/**
 * Pre-process raw HTML to preserve `<pre><code>` and simple `<table>` blocks
 * as text placeholders so both parseHtml() and extractReadableContent() retain
 * their structure through downstream extraction.
 */
export function extractStructuredBlocks(
  html: string,
): { cleaned: string; blocks: Map<string, string> } {
  const blocks = new Map<string, string>();
  let counter = 0;

  const replaceWithPlaceholder = (markdown: string): string => {
    const placeholder = buildStructuredPlaceholder(counter++);
    blocks.set(placeholder, `\n${markdown.trim()}\n`);
    return placeholder;
  };

  const preCodeRegex =
    /<pre\b[^>]*>\s*<code\b([^>]*)>([\s\S]*?)<\/code>\s*<\/pre>/gi;

  let cleaned = html.replace(preCodeRegex, (_match, attrs: string, body: string) => {
    const langMatch = attrs.match(/class\s*=\s*["'](?:language-|hljs\s+)([^"'\s]+)/i);
    const lang = langMatch?.[1] ?? "";
    const decoded = decodeHtmlEntities(
      body.replace(/<[^>]+>/g, ""),
    );
    return replaceWithPlaceholder(`\`\`\`${lang}\n${decoded.trim()}\n\`\`\``);
  });

  const tableRegex = /<table\b[^>]*>[\s\S]*?<\/table>/gi;
  cleaned = cleaned.replace(tableRegex, (match) => {
    const markdown = tableToMarkdown(match);
    return markdown ? replaceWithPlaceholder(markdown) : match;
  });

  return { cleaned, blocks };
}

/**
 * Restore structured placeholders in extracted text with their markdown output.
 */
export function restoreStructuredBlocks(
  text: string,
  blocks: Map<string, string>,
): string {
  let result = text;
  for (const [placeholder, markdown] of blocks) {
    result = result.replace(placeholder, markdown);
  }
  return result;
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
  if (maxLinks <= 0) return [];
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

function extractInlineText(html: string): string {
  return decodeHtmlEntities(
    html
      .replace(/<br\b[^>]*>/gi, "\n")
      .replace(/<\/(?:p|div|li|tr|th|td)>/gi, "\n")
      .replace(/<[^>]+>/g, " ")
      .replace(/\r/g, ""),
  )
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n+/g, "\n")
    .trim();
}

function replaceHeadingTagsWithMarkdown(html: string): string {
  return html.replace(
    /<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/gi,
    (_match, level: string, body: string) => {
      const text = extractInlineText(body);
      if (!text) return "\n";
      return `\n\n${"#".repeat(Number(level))} ${text}\n\n`;
    },
  );
}

function replaceTablesWithMarkdown(html: string): string {
  return html.replace(/<table\b[^>]*>[\s\S]*?<\/table>/gi, (tableHtml) => {
    const markdown = tableToMarkdown(tableHtml);
    return markdown ? `\n\n${markdown}\n\n` : "\n";
  });
}

/**
 * Convert `<ul>/<ol>/<li>` into markdown bullets/numbers.
 * Processes innermost lists first (up to 6 iterations) for nesting.
 */
function replaceListsWithMarkdown(html: string): string {
  // Innermost-first: regex matches lists with no nested <ul>/<ol> inside.
  const innerListRegex =
    /<(ul|ol)\b[^>]*>((?:(?!<\/?(?:ul|ol)\b)[\s\S])*?)<\/\1>/gi;
  let result = html;
  for (let i = 0; i < 6; i++) {
    const prev = result;
    result = result.replace(innerListRegex, (_match, tag: string, body: string) => {
      const isOrdered = tag.toLowerCase() === "ol";
      const itemRegex = /<li\b[^>]*>([\s\S]*?)<\/li>/gi;
      const items: string[] = [];
      let itemMatch: RegExpExecArray | null;
      let index = 1;
      while ((itemMatch = itemRegex.exec(body)) !== null) {
        const text = extractInlineText(itemMatch[1] ?? "");
        if (!text) continue;
        const prefix = isOrdered ? `${index++}.` : "-";
        items.push(`${prefix} ${text}`);
      }
      return items.length > 0 ? `\n${items.join("\n")}\n` : "\n";
    });
    if (result === prev) break;
  }
  return result;
}

/**
 * Convert `<blockquote>` into markdown `>` prefix.
 * Processes innermost first (up to 4 iterations) for nesting.
 */
function replaceBlockquotesWithMarkdown(html: string): string {
  const innerBqRegex =
    /<blockquote\b[^>]*>((?:(?!<\/?blockquote\b)[\s\S])*?)<\/blockquote>/gi;
  let result = html;
  for (let i = 0; i < 4; i++) {
    const prev = result;
    result = result.replace(innerBqRegex, (_match, body: string) => {
      const text = extractInlineText(body);
      if (!text) return "\n";
      const lines = text.split("\n").map((line) => `> ${line}`);
      return `\n${lines.join("\n")}\n`;
    });
    if (result === prev) break;
  }
  return result;
}

/**
 * Convert `<dl>/<dt>/<dd>` into markdown definition format:
 * `**term**\n: definition`
 */
function replaceDefinitionListsWithMarkdown(html: string): string {
  return html.replace(
    /<dl\b[^>]*>([\s\S]*?)<\/dl>/gi,
    (_match, body: string) => {
      const entries: string[] = [];
      const termRegex = /<dt\b[^>]*>([\s\S]*?)<\/dt>/gi;
      const defRegex = /<dd\b[^>]*>([\s\S]*?)<\/dd>/gi;
      let termMatch: RegExpExecArray | null;
      while ((termMatch = termRegex.exec(body)) !== null) {
        const term = extractInlineText(termMatch[1] ?? "");
        if (!term) continue;
        // Find the next <dd> after this <dt>
        defRegex.lastIndex = termMatch.index + termMatch[0].length;
        const defMatch = defRegex.exec(body);
        const definition = defMatch ? extractInlineText(defMatch[1] ?? "") : "";
        entries.push(definition ? `**${term}**\n: ${definition}` : `**${term}**`);
      }
      return entries.length > 0 ? `\n${entries.join("\n")}\n` : "\n";
    },
  );
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
    "blockquote",
    "dl",
    "dt",
    "dd",
  ];
  const blockRegex = new RegExp(
    `<\\/?(?:${blockTags.join("|")})\\b[^>]*>`,
    "gi",
  );

  // Pipeline: headings → definition lists → blockquotes → lists → tables → blockRegex fallback
  let text = replaceTablesWithMarkdown(
    replaceListsWithMarkdown(
      replaceBlockquotesWithMarkdown(
        replaceDefinitionListsWithMarkdown(
          replaceHeadingTagsWithMarkdown(html),
        ),
      ),
    ),
  )
    .replace(blockRegex, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/\r/g, "");

  text = decodeHtmlEntities(text);
  text = text
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n+/g, "\n\n")
    .trim();

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
  publishedDate?: string;
} {
  const { cleaned, blocks } = extractStructuredBlocks(html);
  const normalized = normalizeHtmlForExtraction(cleaned);
  const title = extractTitle(html);
  const description = extractMetaDescription(html);
  const { text, truncated } = extractTextContent(normalized, maxTextLength);
  const links = extractLinks(normalized, maxLinks);
  const publishedDate = extractPublicationDate(html);
  const restoredText = blocks.size > 0 ? restoreStructuredBlocks(text, blocks) : text;

  return {
    title,
    description,
    text: restoredText,
    textTruncated: truncated,
    links,
    linkCount: links.length,
    publishedDate,
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
