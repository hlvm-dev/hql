/**
 * Playwright Tools — 12 browser automation tools
 *
 * Fast, deterministic DOM-level browser control via Chrome DevTools Protocol.
 * Complements the 22 cu_* computer use tools (pixel-level desktop control).
 *
 * Tool name prefix: `pw_*`
 * Browser: one shared Chromium instance per session (browser-manager.ts)
 *
 * The LLM picks between pw_* (fast, DOM) and cu_* (visual, native) per action.
 */

import type { ToolExecutionOptions, ToolMetadata } from "../registry.ts";
import {
  failTool,
  failToolDetailed,
  formatToolError,
  okTool,
} from "../tool-results.ts";
import { encodeBase64 } from "@std/encoding/base64";
import { isChromiumReady } from "../../runtime/chromium-runtime.ts";
import {
  getOrCreatePage,
  promoteToHeaded,
} from "./browser-manager.ts";
import { getPlatform } from "../../../platform/platform.ts";
import { analyzePlaywrightActionability } from "./actionability.ts";
import { enrichPlaywrightFailureMetadata } from "./failure-enrichment.ts";
import { safeStringify } from "../../../common/safe-stringify.ts";
import {
  buildPlaywrightSnapshotHint,
  normalizePlaywrightSelector,
} from "./selector-utils.ts";

// ── Result summary labels (matches CU pattern) ──────────────────────────

const RESULT_SUMMARY: Record<string, string> = {
  goto: "Navigated",
  click: "Clicked",
  fill: "Filled",
  content: "Read content",
  links: "Read links",
  wait_for: "Waited",
  screenshot: "Captured",
  evaluate: "Evaluated",
  snapshot: "Snapshot",
  download: "Downloaded",
};

const MAX_CONTENT_CHARS = 8_000; // ~2K tokens, fits tool result budget
const MAX_SNAPSHOT_CHARS = 12_000; // accessibility trees are more info-dense

// ── Image attachment (reuses same _imageAttachment format as CU) ────────

function formatByteSize(size: unknown): string | null {
  return typeof size === "number" && Number.isFinite(size) && size >= 0
    ? `${size.toLocaleString()} bytes`
    : null;
}

function formatDownloadToolResult(result: unknown) {
  if (!result || typeof result !== "object") return null;
  const record = result as {
    fileName?: unknown;
    savedTo?: unknown;
    size?: unknown;
    sourceUrl?: unknown;
  };
  const fileName = typeof record.fileName === "string" &&
      record.fileName.trim().length > 0
    ? record.fileName.trim()
    : null;
  const savedTo = typeof record.savedTo === "string" &&
      record.savedTo.trim().length > 0
    ? record.savedTo.trim()
    : null;
  const sizeLabel = formatByteSize(record.size);
  const sourceUrl = typeof record.sourceUrl === "string" &&
      record.sourceUrl.trim().length > 0
    ? record.sourceUrl.trim()
    : null;

  if (!fileName && !savedTo && !sizeLabel && !sourceUrl) {
    return null;
  }

  const lines = ["Download complete."];
  if (fileName) lines.push(`Filename: ${fileName}`);
  if (sizeLabel) lines.push(`Size: ${sizeLabel}`);
  if (savedTo) lines.push(`Saved to: ${savedTo}`);
  if (sourceUrl) lines.push(`Source URL: ${sourceUrl}`);

  const summaryParts = ["Downloaded"];
  if (fileName) summaryParts.push(fileName);
  if (sizeLabel) summaryParts.push(`(${sizeLabel})`);

  const body = lines.join("\n");
  return {
    llmContent: body,
    summaryDisplay: summaryParts.join(" "),
    returnDisplay: body,
  };
}

function formatStructuredLlmResult(
  result: unknown,
  summaryDisplay: string,
  returnDisplay: string,
) {
  return {
    llmContent: safeStringify(result, 2),
    summaryDisplay,
    returnDisplay,
  };
}

function imageResult(
  data: Record<string, unknown>,
  img: { base64: string; width: number; height: number },
): unknown {
  return {
    ...okTool(data),
    _imageAttachment: {
      data: img.base64,
      mimeType: "image/png",
      width: img.width,
      height: img.height,
    },
  };
}

function resolveDownloadDirectory(saveTo?: string): string {
  const platform = getPlatform();
  const homeDir = platform.env.get("HOME") ?? platform.env.get("USERPROFILE") ??
    "/tmp";
  return saveTo
    ? (saveTo.startsWith("~") ? saveTo.replace("~", homeDir) : saveTo)
    : platform.path.join(homeDir, "Downloads");
}

function extractFilenameFromContentDisposition(
  contentDisposition?: string,
): string | null {
  if (!contentDisposition) return null;
  const utf8Match = /filename\*\s*=\s*UTF-8''([^;]+)/i.exec(contentDisposition);
  if (utf8Match?.[1]) {
    try {
      return decodeURIComponent(utf8Match[1]);
    } catch {
      return utf8Match[1];
    }
  }
  const quotedMatch = /filename\s*=\s*"([^"]+)"/i.exec(contentDisposition);
  if (quotedMatch?.[1]) return quotedMatch[1];
  const bareMatch = /filename\s*=\s*([^;]+)/i.exec(contentDisposition);
  return bareMatch?.[1]?.trim() ?? null;
}

function resolveDownloadFileName(
  url: string,
  contentDisposition?: string,
): string {
  const platform = getPlatform();
  const fromHeader = extractFilenameFromContentDisposition(contentDisposition);
  if (fromHeader && fromHeader.trim().length > 0) {
    return platform.path.basename(fromHeader.trim());
  }
  try {
    const pathname = new URL(url).pathname;
    const fromUrl = decodeURIComponent(platform.path.basename(pathname));
    if (fromUrl.trim().length > 0) return fromUrl;
  } catch {
    // Fall through to generic fallback.
  }
  return "download.bin";
}

// ── Tool wrapper (mirrors cuTool pattern from computer-use/tools.ts) ────

function pwTool(
  errorPrefix: string,
  fn: (args: unknown, toolOptions?: ToolExecutionOptions) => Promise<unknown>,
  context?: {
    interaction?: string;
  },
): (
  args: unknown,
  cwd: string,
  options?: ToolExecutionOptions,
) => Promise<unknown> {
  return async (args, _cwd, toolOptions) => {
    if (!await isChromiumReady()) {
      return failToolDetailed(
        "Browser not available. Run `hlvm bootstrap` to install Chromium.",
        {
          source: "runtime",
          kind: "unsupported",
          retryable: false,
          code: "pw_browser_unavailable",
        },
      );
    }
    try {
      return await fn(args, toolOptions);
    } catch (error) {
      const toolError = formatToolError(errorPrefix, error);
      const rawSelector = typeof (args as { selector?: unknown })?.selector ===
          "string"
        ? ((args as { selector?: string }).selector ?? "").trim()
        : "";
      const selector = rawSelector
        ? normalizePlaywrightSelector(rawSelector) || undefined
        : undefined;
      const actionability = selector
        ? await analyzePlaywrightActionability({
          sessionId: toolOptions?.sessionId,
          selector,
          interaction: context?.interaction,
        })
        : null;
      const failure = enrichPlaywrightFailureMetadata(
        toolError.failure,
        actionability,
      );
      return failTool(toolError.message, {
        failure,
      });
    }
  };
}

// ── Tool implementations ─────────────────────────────────────────────────

const pwGotoFn = pwTool("Navigation failed", async (args, toolOptions) => {
  const { url } = args as { url: string };
  if (!url) throw new Error("url is required");
  const page = await getOrCreatePage(toolOptions?.sessionId);
  const response = await page.goto(url, { waitUntil: "domcontentloaded" });
  return okTool({
    url: page.url(),
    status: response?.status() ?? null,
    title: await page.title(),
  });
});

const pwClickFn = pwTool("Click failed", async (args, toolOptions) => {
  const { selector } = args as { selector: string };
  const sel = typeof selector === "string"
    ? normalizePlaywrightSelector(selector)
    : "";
  if (!sel) throw new Error("selector is required");
  const page = await getOrCreatePage(toolOptions?.sessionId);
  await page.click(sel, { timeout: 10_000 });
  return okTool({ clicked: true, selector: sel });
}, { interaction: "click" });

const pwFillFn = pwTool("Fill failed", async (args, toolOptions) => {
  const { selector, value } = args as { selector: string; value: string };
  const sel = typeof selector === "string"
    ? normalizePlaywrightSelector(selector)
    : "";
  if (!sel) throw new Error("selector is required");
  if (value == null) throw new Error("value is required");
  const page = await getOrCreatePage(toolOptions?.sessionId);
  await page.fill(sel, String(value), { timeout: 10_000 });
  return okTool({ filled: true, selector: sel });
}, { interaction: "fill" });

const pwTypeFn = pwTool("Type failed", async (args, toolOptions) => {
  const { selector, value, submit } = args as {
    selector: string;
    value: string;
    submit?: boolean;
  };
  const sel = typeof selector === "string"
    ? normalizePlaywrightSelector(selector)
    : "";
  if (!sel) throw new Error("selector is required");
  if (value == null) throw new Error("value is required");
  const page = await getOrCreatePage(toolOptions?.sessionId);
  await page.fill(sel, String(value), { timeout: 10_000 });
  if (submit === true) {
    await page.press(sel, "Enter", { timeout: 10_000 });
  }
  return okTool({
    typed: true,
    selector: sel,
    submitted: submit === true,
  });
}, { interaction: "type" });

const pwContentFn = pwTool(
  "Content read failed",
  async (args, toolOptions) => {
    const { selector } = args as { selector?: string };
    const sel = typeof selector === "string"
      ? normalizePlaywrightSelector(selector)
      : "";
    const page = await getOrCreatePage(toolOptions?.sessionId);
    let text: string;
    if (sel) {
      const el = await page.$(sel);
      if (!el) throw new Error(`Element not found: ${sel}`);
      text = (await el.textContent()) ?? "";
    } else {
      text = await page.innerText("body");
    }
    const truncated = text.length > MAX_CONTENT_CHARS
      ? text.slice(0, MAX_CONTENT_CHARS - 3) + "..."
      : text;
    return okTool({ text: truncated, length: text.length });
  },
);

const pwLinksFn = pwTool(
  "Link extraction failed",
  async (args, toolOptions) => {
    const {
      selector,
      text_contains,
      href_contains,
      limit,
      visible_only,
    } = args as {
      selector?: string;
      text_contains?: string;
      href_contains?: string;
      limit?: number;
      visible_only?: boolean;
    };
    const sel = typeof selector === "string"
      ? normalizePlaywrightSelector(selector)
      : "";
    const page = await getOrCreatePage(toolOptions?.sessionId);
    if (sel) {
      const root = await page.$(sel);
      if (!root) throw new Error(`Element not found: ${sel}`);
    }

    const textFilter = typeof text_contains === "string"
      ? text_contains.trim().toLowerCase()
      : "";
    const hrefFilter = typeof href_contains === "string"
      ? href_contains.trim().toLowerCase()
      : "";
    const maxResults = Math.max(1, Math.min(Number(limit) || 20, 100));
    const visibleOnly = visible_only !== false;

    const links = await page.evaluate(
      (
        { rootSelector, textNeedle, hrefNeedle, maxItems, requireVisible },
      ) => {
        const doc = (globalThis as unknown as {
          document: {
            querySelector: (selector: string) => unknown;
            body: unknown;
          };
        }).document;
        const getComputedStyle = (globalThis as unknown as {
          getComputedStyle: (
            element: unknown,
          ) => { display?: string; visibility?: string };
        }).getComputedStyle;
        const root = rootSelector ? doc.querySelector(rootSelector) : doc.body;
        if (!root) return [];

        const normalize = (value: string | null | undefined): string =>
          (value ?? "").replace(/\s+/g, " ").trim();

        const isVisible = (element: {
          getBoundingClientRect: () => { width: number; height: number };
        }): boolean => {
          const style = getComputedStyle(element);
          const rect = element.getBoundingClientRect();
          return style.display !== "none" && style.visibility !== "hidden" &&
            rect.width > 0 && rect.height > 0;
        };

        const items: Array<Record<string, unknown>> = [];
        for (
          const node of (root as {
            querySelectorAll: (selector: string) => Iterable<unknown>;
          }).querySelectorAll("a[href]")
        ) {
          const anchor = node as {
            textContent?: string | null;
            href: string;
            getAttribute: (name: string) => string | null;
            getBoundingClientRect: () => { width: number; height: number };
          };
          const text = normalize(anchor.textContent);
          const title = normalize(anchor.getAttribute("title"));
          const ariaLabel = normalize(anchor.getAttribute("aria-label"));
          const href = anchor.href;
          const visible = isVisible(anchor);
          if (requireVisible && !visible) continue;

          const textHaystack = `${text} ${title} ${ariaLabel}`.toLowerCase();
          if (textNeedle && !textHaystack.includes(textNeedle)) continue;
          if (hrefNeedle && !href.toLowerCase().includes(hrefNeedle)) continue;

          items.push({
            text,
            href,
            title: title || undefined,
            ariaLabel: ariaLabel || undefined,
            visible,
          });
          if (items.length >= maxItems) break;
        }
        return items;
      },
      {
        rootSelector: sel || undefined,
        textNeedle: textFilter,
        hrefNeedle: hrefFilter,
        maxItems: maxResults,
        requireVisible: visibleOnly,
      },
    );

    return okTool({
      links,
      count: links.length,
      selector: sel || "body",
      filters: {
        text_contains: text_contains ?? "",
        href_contains: href_contains ?? "",
        visible_only: visibleOnly,
        limit: maxResults,
      },
    });
  },
);

const VALID_WAIT_CONDITIONS = new Set(["networkidle", "selector"]);

const pwWaitForFn = pwTool("Wait failed", async (args, toolOptions) => {
  const { condition, selector, timeout } = args as {
    condition: string;
    selector?: string;
    timeout?: number;
  };
  if (!VALID_WAIT_CONDITIONS.has(condition)) {
    throw new Error(
      `Invalid condition: "${condition}". Must be "networkidle" or "selector".`,
    );
  }
  const page = await getOrCreatePage(toolOptions?.sessionId);
  const ms = Number(timeout) || 10_000;

  if (condition === "selector") {
    const sel = typeof selector === "string"
      ? normalizePlaywrightSelector(selector)
      : "";
    if (!sel) {
      throw new Error("selector is required when condition is 'selector'");
    }
    await page.waitForSelector(sel, { timeout: ms });
  } else {
    // networkidle can hang on SPAs with continuous polling — use shorter timeout
    try {
      await page.waitForLoadState("networkidle", { timeout: ms });
    } catch {
      // Fallback: if networkidle times out, domcontentloaded is usually sufficient
      await page.waitForLoadState("domcontentloaded", { timeout: 5_000 });
    }
  }
  return okTool({ ready: true, condition });
});

const pwScreenshotFn = pwTool(
  "Screenshot failed",
  async (args, toolOptions) => {
    const { selector, fullPage } = args as {
      selector?: string;
      fullPage?: boolean;
    };
    const page = await getOrCreatePage(toolOptions?.sessionId);

    let bytes: Uint8Array;
    if (selector) {
      const sel = typeof selector === "string"
        ? normalizePlaywrightSelector(selector)
        : "";
      if (!sel) throw new Error("selector must be non-empty");
      const el = await page.$(sel);
      if (!el) throw new Error(`Element not found: ${sel}`);
      bytes = new Uint8Array(await el.screenshot({ type: "png" }));
    } else {
      bytes = new Uint8Array(
        await page.screenshot({
          type: "png",
          fullPage: fullPage === true,
        }),
      );
    }

    const base64 = encodeBase64(bytes);
    const viewport = page.viewportSize() ?? { width: 1280, height: 720 };
    return imageResult(
      { width: viewport.width, height: viewport.height },
      { base64, width: viewport.width, height: viewport.height },
    );
  },
);

const pwEvaluateFn = pwTool("Evaluate failed", async (args, toolOptions) => {
  const { expression } = args as { expression: string };
  const expr = typeof expression === "string" ? expression.trim() : "";
  if (!expr) throw new Error("expression is required");
  const page = await getOrCreatePage(toolOptions?.sessionId);
  try {
    const result = await page.evaluate(expr);
    return okTool({ result });
  } catch (err) {
    // Handle non-serializable results (DOM nodes, functions, etc.)
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("serialize") || msg.includes("circular")) {
      throw new Error(
        `Expression returned a non-serializable value. Wrap in JSON-safe output: ${msg}`,
      );
    }
    throw err;
  }
});

const SCROLL_UNIT_PX = 300; // one "scroll" = 300px (roughly one viewport third)

const pwScrollFn = pwTool("Scroll failed", async (args, toolOptions) => {
  const { direction, amount } = args as { direction?: string; amount?: number };
  const dir = typeof direction === "string"
    ? direction.toLowerCase().trim()
    : "down";
  const units = Math.max(1, Math.min(Number(amount) || 1, 10));
  const px = units * SCROLL_UNIT_PX;
  const page = await getOrCreatePage(toolOptions?.sessionId);
  const deltaMap: Record<string, [number, number]> = {
    down: [0, px],
    up: [0, -px],
    right: [px, 0],
    left: [-px, 0],
  };
  const [dx, dy] = deltaMap[dir] ?? deltaMap.down;
  // deno-lint-ignore no-explicit-any
  await page.evaluate(([x, y]: any) => (globalThis as any).scrollBy(x, y), [
    dx,
    dy,
  ]);
  const pos = await page.evaluate(() => ({
    scrollY: Math.round((globalThis as any).scrollY),
    scrollHeight: (globalThis as any).document.documentElement.scrollHeight,
    viewportHeight: (globalThis as any).innerHeight,
  })) as { scrollY: number; scrollHeight: number; viewportHeight: number };
  return okTool({
    scrolled: dir,
    units,
    pixels: px,
    scrollY: pos.scrollY,
    scrollHeight: pos.scrollHeight,
    viewportHeight: pos.viewportHeight,
    atBottom: pos.scrollY + pos.viewportHeight >= pos.scrollHeight - 10,
    atTop: pos.scrollY === 0,
  });
});

const pwSnapshotFn = pwTool("Snapshot failed", async (args, toolOptions) => {
  const { selector } = args as { selector?: string };
  const page = await getOrCreatePage(toolOptions?.sessionId);
  const normalizedSelector = typeof selector === "string"
    ? normalizePlaywrightSelector(selector)
    : "";
  const loc = normalizedSelector
    ? page.locator(normalizedSelector)
    : page.locator("body");
  const yaml = await loc.ariaSnapshot({ timeout: 10_000 });
  const truncated = yaml.length > MAX_SNAPSHOT_CHARS
    ? yaml.slice(0, MAX_SNAPSHOT_CHARS - 3) + "..."
    : yaml;
  return okTool({
    snapshot: truncated,
    length: yaml.length,
    hint: buildPlaywrightSnapshotHint(yaml),
  });
});

const pwDownloadFn = pwTool("Download failed", async (args, toolOptions) => {
  const { selector, url, save_to } = args as {
    selector?: string;
    url?: string;
    save_to?: string;
  };
  const sel = typeof selector === "string"
    ? normalizePlaywrightSelector(selector)
    : "";
  const downloadUrl = typeof url === "string" ? url.trim() : "";
  if (!sel && !downloadUrl) {
    throw new Error("selector or url is required");
  }

  const page = await getOrCreatePage(toolOptions?.sessionId);
  const platform = getPlatform();
  const destDir = resolveDownloadDirectory(save_to);
  await platform.fs.mkdir(destDir, { recursive: true });

  if (downloadUrl) {
    const response = await page.context().request.get(downloadUrl, {
      timeout: 30_000,
      failOnStatusCode: false,
    });
    if (!response.ok()) {
      return failToolDetailed(
        `Direct download failed: HTTP ${response.status()} ${response.statusText()} for ${downloadUrl}.`,
        {
          source: "tool",
          kind: "network",
          code: "pw_download_http_error",
          facts: {
            url: downloadUrl,
            status: response.status(),
            statusText: response.statusText(),
            expectedAction: "download",
          },
        },
      );
    }

    const bytes = await response.body();
    const finalUrl = response.url();
    const fileName = resolveDownloadFileName(
      finalUrl,
      response.headers()["content-disposition"],
    );
    const destPath = platform.path.join(destDir, fileName);
    await platform.fs.writeFile(destPath, bytes);
    return okTool({
      fileName,
      savedTo: destPath,
      size: bytes.byteLength,
      sourceUrl: finalUrl,
    });
  }

  const urlBefore = page.url();

  // Wait for download event while clicking the element
  let download;
  try {
    [download] = await Promise.all([
      page.waitForEvent("download", { timeout: 15_000 }),
      page.click(sel, { timeout: 10_000 }),
    ]);
  } catch {
    // Click may have navigated instead of triggering a download
    const urlAfter = page.url();
    if (urlAfter !== urlBefore) {
      return failToolDetailed(
        `Click navigated to ${urlAfter} instead of triggering a download. ` +
          `Use pw_goto to go to that page, then pw_snapshot to find the actual download link. If you find a direct file href, call pw_download again with url=... instead of retrying the original trigger.`,
        {
          source: "tool",
          kind: "invalid_state",
          code: "pw_download_navigated",
          facts: {
            selector: sel,
            previousUrl: urlBefore,
            navigatedTo: urlAfter,
            expectedAction: "download",
          },
        },
      );
    }
    return failToolDetailed(
      "No download was triggered by clicking that element. " +
        "Use pw_snapshot to find the correct download link — look for links ending in .dmg, .pkg, .zip, .exe, etc. If you already know the direct file URL, call pw_download with url=... .",
      {
        source: "tool",
        kind: "not_found",
        code: "pw_download_not_triggered",
        facts: {
          selector: sel,
          url: urlBefore,
          expectedAction: "download",
        },
      },
    );
  }

  const fileName = download.suggestedFilename();
  const destPath = platform.path.join(destDir, fileName);
  await download.saveAs(destPath);

  return okTool({
    fileName,
    savedTo: destPath,
    size: (await platform.fs.stat(destPath)).size,
  });
});

const pwPromoteFn = pwTool("Promote failed", async (_args, toolOptions) => {
  await promoteToHeaded(toolOptions?.sessionId);
  return okTool({
    promoted: true,
    message:
      "Browser is now visible. Cookies and localStorage-backed session state should survive, and the current URL is restored best-effort. Unsaved form inputs, sessionStorage-only state, scroll position, JS heap state, and live connections are not guaranteed to survive promotion.",
  });
});

// ── Tool registry ────────────────────────────────────────────────────────

export const PLAYWRIGHT_TOOLS: Record<string, ToolMetadata> = {
  pw_goto: {
    fn: pwGotoFn,
    description:
      "Navigate the browser to a URL. Fast and deterministic. Returns page title and HTTP status. Use instead of cu_* for web navigation.",
    args: { url: "string - The URL to navigate to" },
    category: "read",
    safetyLevel: "L1",
    safety: "Navigates browser to a URL. Read-only network request.",
    formatResult: (result) =>
      formatStructuredLlmResult(result, RESULT_SUMMARY.goto, "Navigated"),
  },

  pw_click: {
    fn: pwClickFn,
    description:
      'Click a DOM element by CSS selector, role/text selector, or shorthand like button "Submit" / link "Docs". Instant and reliable. Use instead of cu_left_click for browser elements.',
    args: {
      selector:
        'string - CSS selector, text= selector, role= selector, or shorthand like button "Submit" / checkbox "Remember me"',
    },
    category: "write",
    safetyLevel: "L2",
    safety:
      "Clicks a browser element. May trigger form submissions or navigation.",
    formatResult: () => ({
      summaryDisplay: RESULT_SUMMARY.click,
      returnDisplay: "Clicked",
    }),
  },

  pw_fill: {
    fn: pwFillFn,
    description:
      'Fill a form input by CSS selector, role selector, or shorthand like textbox "Email" / searchbox "Search". Sets value directly — no keystrokes needed. Use instead of cu_left_click + cu_type for browser forms.',
    args: {
      selector:
        'string - CSS selector, role= selector, or shorthand like textbox "Email" / searchbox "Search"',
      value: "string - The value to fill",
    },
    category: "write",
    safetyLevel: "L2",
    safety: "Fills a form field in the browser.",
    formatResult: () => ({
      summaryDisplay: RESULT_SUMMARY.fill,
      returnDisplay: "Filled",
    }),
  },

  pw_type: {
    fn: pwTypeFn,
    description:
      'Type text into a browser input or search field by selector. Accepts CSS selectors, role selectors, or shorthand like textbox "Email" / searchbox "Search". This is a browser-side typing alias for pw_fill; use it when the model naturally wants a typing action. Set submit=true to press Enter after typing.',
    args: {
      selector:
        'string - CSS selector, role= selector, or shorthand like textbox "Email" / searchbox "Search"',
      value: "string - The text to type",
      submit:
        "boolean (optional) - Press Enter after typing. Useful for search boxes and simple forms.",
    },
    category: "write",
    safetyLevel: "L2",
    safety: "Types text into a browser field and may submit with Enter.",
    formatResult: () => ({
      summaryDisplay: RESULT_SUMMARY.fill,
      returnDisplay: "Typed",
    }),
  },

  pw_content: {
    fn: pwContentFn,
    description:
      "Read text content of the page or a specific element. Returns exact DOM text — no OCR or vision needed. Much faster and more accurate than cu_screenshot for reading browser content.",
    args: {
      selector:
        "string (optional) - CSS selector. If omitted, returns full page body text.",
    },
    category: "read",
    safetyLevel: "L0",
    safety: "Read-only content extraction from browser DOM.",
    formatResult: (result) =>
      formatStructuredLlmResult(result, RESULT_SUMMARY.content, "Read content"),
  },

  pw_links: {
    fn: pwLinksFn,
    description:
      "Extract candidate links from the page or a subtree, including resolved hrefs and link text. Use on release pages, docs navigation, or dense menus before guessing a click target.",
    args: {
      selector:
        "string (optional) - CSS selector for a subtree to search. If omitted, searches the full page body.",
      text_contains:
        "string (optional) - Case-insensitive substring filter against link text, title, or aria-label.",
      href_contains:
        "string (optional) - Case-insensitive substring filter against the resolved href.",
      limit:
        "number (optional) - Maximum number of links to return (default: 20, max: 100).",
      visible_only:
        "boolean (optional) - Return only visible links (default: true). Set false to inspect hidden navigation links too.",
    },
    category: "read",
    safetyLevel: "L0",
    safety: "Read-only DOM link extraction from the browser page.",
    formatResult: (result) =>
      formatStructuredLlmResult(result, RESULT_SUMMARY.links, "Read links"),
  },

  pw_wait_for: {
    fn: pwWaitForFn,
    description:
      "Wait for a page to finish loading or for a specific element to appear. Use 'networkidle' after navigation, or 'selector' to wait for dynamic content.",
    args: {
      condition:
        "string - 'networkidle' (wait for network to settle) or 'selector' (wait for element)",
      selector:
        "string (optional) - CSS selector (required if condition is 'selector')",
      timeout: "number (optional) - Timeout in milliseconds (default: 10000)",
    },
    category: "read",
    safetyLevel: "L0",
    safety: "Read-only wait operation.",
    formatResult: () => ({
      summaryDisplay: RESULT_SUMMARY.wait_for,
      returnDisplay: "Waited",
    }),
  },

  pw_screenshot: {
    fn: pwScreenshotFn,
    description:
      "Take a screenshot of the browser page. Faster than cu_screenshot for browser content. Can target a specific element or capture the full page.",
    args: {
      selector:
        "string (optional) - CSS selector to screenshot a specific element",
      fullPage:
        "boolean (optional) - Capture full scrollable page (default: false)",
    },
    category: "read",
    safetyLevel: "L1",
    safety: "Read-only screenshot of browser content.",
    formatResult: () => ({
      summaryDisplay: RESULT_SUMMARY.screenshot,
      returnDisplay: "Captured",
    }),
  },

  pw_evaluate: {
    fn: pwEvaluateFn,
    description:
      "Execute JavaScript in the browser page context. Returns the result. Use for complex DOM operations, extracting structured data, or interacting with page scripts. Note: expressions run with full page access (cookies, localStorage, DOM). No execution timeout — wrap long-running code in Promise.race if needed.",
    args: {
      expression: "string - JavaScript expression to evaluate in the page",
    },
    category: "write",
    safetyLevel: "L2",
    safety: "Executes arbitrary JavaScript in the browser. Use carefully.",
    formatResult: (result) =>
      formatStructuredLlmResult(result, RESULT_SUMMARY.evaluate, "Evaluated"),
  },

  pw_scroll: {
    fn: pwScrollFn,
    description:
      "Scroll the browser page in a direction. Each unit scrolls about one-third of the viewport. Use to reveal content below the fold.",
    args: {
      direction:
        "string (optional) - 'up', 'down', 'left', 'right' (default: 'down')",
      amount:
        "number (optional) - Scroll units (1-10), each ~300px (default: 1)",
    },
    category: "read",
    safetyLevel: "L0",
    safety: "Scrolls the page. Read-only viewport change.",
    formatResult: () => ({
      summaryDisplay: "Scrolled",
      returnDisplay: "Scrolled",
    }),
  },

  pw_snapshot: {
    fn: pwSnapshotFn,
    description:
      "Get the accessibility tree (ARIA snapshot) of the page. Returns element roles, names, and states in YAML. Use BEFORE pw_click/pw_fill to discover what elements exist — much more reliable than guessing CSS selectors.",
    args: {
      selector:
        "string (optional) - CSS selector to snapshot a subtree. If omitted, snapshots full page body.",
    },
    category: "read",
    safetyLevel: "L0",
    safety: "Read-only accessibility tree inspection.",
    formatResult: (result) =>
      formatStructuredLlmResult(
        result,
        RESULT_SUMMARY.snapshot,
        "Snapshot captured",
      ),
  },

  pw_download: {
    fn: pwDownloadFn,
    description:
      "Download a file and save it to a specified directory. Either click a selector that triggers a download, or provide a direct file URL when the final artifact href is already known. The file is saved with its original filename when available.",
    args: {
      selector:
        "string (optional) - CSS/text selector for the download button/link",
      url:
        "string (optional) - Direct file URL to download when the final artifact href is already known",
      save_to:
        "string (optional) - Directory to save the file (default: ~/Downloads). Examples: '~/Downloads', '~/Desktop', '~/dev'",
    },
    category: "write",
    safetyLevel: "L2",
    safety: "Downloads a file from a website and saves to disk.",
    formatResult: (result) =>
      formatDownloadToolResult(result) ?? {
        summaryDisplay: "Downloaded",
        returnDisplay: "Downloaded",
      },
  },

  pw_promote: {
    fn: pwPromoteFn,
    description:
      "Make the browser window visible so cu_* tools can see and interact with it. Use ONLY when pw_* tools fail and you need visual CU interaction (CAPTCHA, native dialog). URL plus cookies/localStorage are restored best-effort after relaunch, but unsaved form inputs, sessionStorage-only state, scroll position, JS heap state, and live connections are not guaranteed.",
    args: {},
    category: "write",
    safetyLevel: "L2",
    safety:
      "Relaunches browser in visible mode. URL plus cookies/localStorage are restored best-effort; transient in-memory page state may be lost.",
    formatResult: () => ({
      summaryDisplay: "Promoted",
      returnDisplay: "Browser promoted to visible",
    }),
  },
};
