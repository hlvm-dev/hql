/**
 * Playwright Tools — Browser automation tools
 *
 * Fast, deterministic DOM-level browser control via Playwright.
 * Complements the 22 cu_* computer use tools (pixel-level desktop control).
 *
 * Tool name prefix: `pw_*`
 * Browser: one shared Chromium instance per session (browser-manager.ts)
 *
 * The LLM picks between pw_* (fast, DOM) and cu_* (visual, native) per action.
 */

import type { ToolExecutionOptions, ToolMetadata } from "../registry.ts";
import { TOOL_CATEGORY, ToolError } from "../error-taxonomy.ts";
import { TOOL_NAMES } from "../tool-names.ts";

function pwError(
  message: string,
  category: "validation" | "internal" | "network" = TOOL_CATEGORY.VALIDATION,
): ToolError {
  return new ToolError(message, TOOL_NAMES.PLAYWRIGHT, category);
}

import {
  failTool,
  failToolDetailed,
  formatToolError,
  okTool,
} from "../tool-results.ts";
import { encodeBase64 } from "@std/encoding/base64";
import { isChromiumReady } from "../../runtime/chromium-runtime.ts";
import {
  clearSnapshotRefsForSession,
  closeBrowserTab,
  createBrowserTab,
  getOrCreatePage,
  listBrowserTabs,
  promoteToHeaded,
  replaceSnapshotRefs,
  resolveSnapshotRef,
  selectBrowserTab,
} from "./browser-manager.ts";
import { getPlatform } from "../../../platform/platform.ts";
import { analyzePlaywrightActionability } from "./actionability.ts";
import { enrichPlaywrightFailureMetadata } from "./failure-enrichment.ts";
import { safeStringify } from "../../../common/safe-stringify.ts";
import {
  buildPlaywrightSnapshotHint,
  normalizePlaywrightSelector,
} from "./selector-utils.ts";
import {
  buildPlaywrightRefLocator,
  normalizePlaywrightRef,
  parsePlaywrightSnapshotRefs,
  type PlaywrightSnapshotRef,
} from "./snapshot-refs.ts";
import { markComputerUsePromotionPending } from "../computer-use/session-state.ts";

type Page = import("playwright-core").Page;
type Locator = import("playwright-core").Locator;

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
  hover: "Hovered",
  snapshot: "Snapshot",
  back: "Navigated back",
  download: "Downloaded",
  select_option: "Selected",
  upload_file: "Uploaded",
  tabs: "Tabs",
};

const MAX_CONTENT_CHARS = 8_000; // ~2K tokens, fits tool result budget
const MAX_SNAPSHOT_CHARS = 12_000; // accessibility trees are more info-dense
const PLAYWRIGHT_SELECTOR_ARG =
  'string (optional) - CSS selector, text= selector, role= selector, or shorthand like button "Submit" / textbox "Email"';
const PLAYWRIGHT_REF_ARG =
  "string (optional) - Snapshot ref returned by pw_snapshot. If both ref and selector are provided, ref wins.";

interface PlaywrightResolvedTarget {
  page: Page;
  locator: Locator;
  selector: string;
  ref?: string;
  refMeta?: PlaywrightSnapshotRef;
}

function escapePlaywrightRoleSelectorValue(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll("\"", "\\\"");
}

function buildPlaywrightActionabilitySelector(
  args: unknown,
  toolOptions?: ToolExecutionOptions,
): string | undefined {
  const ref = normalizePlaywrightRef((args as { ref?: unknown })?.ref);
  if (ref) {
    const refMeta = resolveSnapshotRef(ref, toolOptions?.sessionId);
    const role = typeof refMeta?.role === "string" ? refMeta.role.trim() : "";
    const name = typeof refMeta?.name === "string" ? refMeta.name.trim() : "";
    if (role && name) {
      return `role=${role}[name="${escapePlaywrightRoleSelectorValue(name)}"]`;
    }
    if (role) {
      return `role=${role}`;
    }
    return buildPlaywrightRefLocator(ref);
  }

  if (typeof (args as { selector?: unknown })?.selector === "string") {
    return normalizePlaywrightSelector(
      (args as { selector?: string }).selector ?? "",
    ) || undefined;
  }

  return undefined;
}

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

function resolveHomePath(path: string): string {
  const platform = getPlatform();
  const homeDir = platform.env.get("HOME") ?? platform.env.get("USERPROFILE") ??
    "/tmp";
  return path.startsWith("~") ? path.replace("~", homeDir) : path;
}

function resolveUploadPaths(paths: unknown): string[] {
  const rawPaths = Array.isArray(paths)
    ? paths
    : typeof paths === "string"
    ? [paths]
    : [];
  const normalized = rawPaths
    .filter((value): value is string => typeof value === "string")
    .map((value) => resolveHomePath(value.trim()))
    .filter((value) => value.length > 0);
  if (normalized.length === 0) {
    throw pwError("paths must contain at least one file path");
  }
  return normalized;
}

function parseSelectValues(args: {
  value?: unknown;
  values?: unknown;
}): string[] {
  const values = Array.isArray(args.values)
    ? args.values
    : args.value !== undefined
    ? [args.value]
    : [];
  const normalized = values
    .filter((value): value is string | number => typeof value === "string" ||
      typeof value === "number")
    .map((value) => String(value).trim())
    .filter((value) => value.length > 0);
  if (normalized.length === 0) {
    throw pwError("value or values is required");
  }
  return normalized;
}

async function resolvePlaywrightTarget(
  args: unknown,
  toolOptions?: ToolExecutionOptions,
): Promise<PlaywrightResolvedTarget> {
  const page = await getOrCreatePage(toolOptions?.sessionId);
  const ref = normalizePlaywrightRef((args as { ref?: unknown })?.ref);
  if (ref) {
    const refMeta = resolveSnapshotRef(ref, toolOptions?.sessionId);
    if (!refMeta) {
      throw pwError(
        `Invalid or expired snapshot ref: ${ref}. Call pw_snapshot again to refresh refs.`,
      );
    }
    const selector = buildPlaywrightRefLocator(ref);
    return {
      page,
      locator: page.locator(selector),
      selector,
      ref,
      refMeta,
    };
  }

  const selector = typeof (args as { selector?: unknown })?.selector ===
      "string"
    ? normalizePlaywrightSelector((args as { selector?: string }).selector ?? "")
    : "";
  if (!selector) {
    throw pwError("selector or ref is required");
  }
  return {
    page,
    locator: page.locator(selector),
    selector,
  };
}

async function resolveOptionalPlaywrightTarget(
  args: unknown,
  toolOptions?: ToolExecutionOptions,
): Promise<PlaywrightResolvedTarget | null> {
  const ref = normalizePlaywrightRef((args as { ref?: unknown })?.ref);
  const selector = typeof (args as { selector?: unknown })?.selector ===
      "string"
    ? normalizePlaywrightSelector((args as { selector?: string }).selector ?? "")
    : "";
  if (!ref && !selector) return null;
  return await resolvePlaywrightTarget(args, toolOptions);
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
      const selector = buildPlaywrightActionabilitySelector(args, toolOptions);
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
  if (!url) throw pwError("url is required");
  const page = await getOrCreatePage(toolOptions?.sessionId);
  clearSnapshotRefsForSession(toolOptions?.sessionId);
  const response = await page.goto(url, { waitUntil: "domcontentloaded" });
  return okTool({
    url: page.url(),
    status: response?.status() ?? null,
    title: await page.title(),
  });
});

const pwClickFn = pwTool("Click failed", async (args, toolOptions) => {
  const target = await resolvePlaywrightTarget(args, toolOptions);
  await target.locator.click({ timeout: 10_000 });
  return okTool({
    clicked: true,
    selector: target.ref ? undefined : target.selector,
    ref: target.ref,
  });
}, { interaction: "click" });

const pwFillFn = pwTool("Fill failed", async (args, toolOptions) => {
  const { value } = args as { value: string };
  if (value == null) throw pwError("value is required");
  const target = await resolvePlaywrightTarget(args, toolOptions);
  await target.locator.fill(String(value), { timeout: 10_000 });
  return okTool({
    filled: true,
    selector: target.ref ? undefined : target.selector,
    ref: target.ref,
  });
}, { interaction: "fill" });

const pwTypeFn = pwTool("Type failed", async (args, toolOptions) => {
  const { value, submit } = args as {
    value: string;
    submit?: boolean;
  };
  if (value == null) throw pwError("value is required");
  const target = await resolvePlaywrightTarget(args, toolOptions);
  await target.locator.fill(String(value), { timeout: 10_000 });
  if (submit === true) {
    await target.locator.press("Enter", { timeout: 10_000 });
  }
  return okTool({
    typed: true,
    selector: target.ref ? undefined : target.selector,
    ref: target.ref,
    submitted: submit === true,
  });
}, { interaction: "type" });

const pwContentFn = pwTool(
  "Content read failed",
  async (args, toolOptions) => {
    const target = await resolveOptionalPlaywrightTarget(args, toolOptions);
    const page = target?.page ?? await getOrCreatePage(toolOptions?.sessionId);
    let text: string;
    if (target) {
      const el = await target.locator.elementHandle();
      if (!el) throw pwError(`Element not found: ${target.selector}`);
      text = (await el.textContent()) ?? "";
    } else {
      text = await page.innerText("body");
    }
    const truncated = text.length > MAX_CONTENT_CHARS
      ? text.slice(0, MAX_CONTENT_CHARS - 3) + "..."
      : text;
    return okTool({
      text: truncated,
      length: text.length,
      selector: target?.ref ? undefined : target?.selector,
      ref: target?.ref,
    });
  },
);

const pwBackFn = pwTool("Back navigation failed", async (_args, toolOptions) => {
  const page = await getOrCreatePage(toolOptions?.sessionId);
  const beforeUrl = page.url();
  clearSnapshotRefsForSession(toolOptions?.sessionId);
  const response = await page.goBack({ waitUntil: "domcontentloaded" }).catch(
    () => null,
  );
  return okTool({
    url: page.url(),
    title: await page.title(),
    status: response?.status() ?? null,
    wentBack: page.url() !== beforeUrl,
  });
});

const pwHoverFn = pwTool("Hover failed", async (args, toolOptions) => {
  const target = await resolvePlaywrightTarget(args, toolOptions);
  await target.locator.hover({ timeout: 10_000 });
  return okTool({
    hovered: true,
    selector: target.ref ? undefined : target.selector,
    ref: target.ref,
  });
}, { interaction: "hover" });

const pwSelectOptionFn = pwTool(
  "Select option failed",
  async (args, toolOptions) => {
    const target = await resolvePlaywrightTarget(args, toolOptions);
    const values = parseSelectValues(args as { value?: unknown; values?: unknown });
    const selected = await target.locator.selectOption(
      values,
      { timeout: 10_000 },
    );
    return okTool({
      selected,
      selector: target.ref ? undefined : target.selector,
      ref: target.ref,
    });
  },
  { interaction: "select_option" },
);

const pwUploadFileFn = pwTool(
  "File upload failed",
  async (args, toolOptions) => {
    const target = await resolvePlaywrightTarget(args, toolOptions);
    const { paths } = args as { paths?: unknown };
    const uploadPaths = resolveUploadPaths(paths);
    await target.locator.setInputFiles(uploadPaths, { timeout: 10_000 });
    return okTool({
      uploaded: uploadPaths,
      count: uploadPaths.length,
      selector: target.ref ? undefined : target.selector,
      ref: target.ref,
    });
  },
  { interaction: "upload_file" },
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
      if (!root) throw pwError(`Element not found: ${sel}`);
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
    throw pwError(
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
      throw pwError("selector is required when condition is 'selector'");
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
    const { fullPage } = args as {
      fullPage?: boolean;
    };
    const target = await resolveOptionalPlaywrightTarget(args, toolOptions);
    const page = target?.page ?? await getOrCreatePage(toolOptions?.sessionId);

    let bytes: Uint8Array;
    let width: number;
    let height: number;
    if (target) {
      bytes = new Uint8Array(await target.locator.screenshot({ type: "png" }));
      const box = await target.locator.boundingBox();
      width = Math.max(1, Math.round(box?.width ?? 0));
      height = Math.max(1, Math.round(box?.height ?? 0));
    } else {
      bytes = new Uint8Array(
        await page.screenshot({
          type: "png",
          fullPage: fullPage === true,
        }),
      );
      const viewport = page.viewportSize() ?? { width: 1280, height: 720 };
      width = viewport.width;
      height = viewport.height;
    }

    const base64 = encodeBase64(bytes);
    return imageResult(
      {
        width,
        height,
        selector: target?.ref ? undefined : target?.selector,
        ref: target?.ref,
      },
      { base64, width, height },
    );
  },
);

const pwEvaluateFn = pwTool("Evaluate failed", async (args, toolOptions) => {
  const { expression } = args as { expression: string };
  const expr = typeof expression === "string" ? expression.trim() : "";
  if (!expr) throw pwError("expression is required");
  const page = await getOrCreatePage(toolOptions?.sessionId);
  try {
    const result = await page.evaluate(expr);
    return okTool({ result });
  } catch (err) {
    // Handle non-serializable results (DOM nodes, functions, etc.)
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("serialize") || msg.includes("circular")) {
      throw pwError(
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
  const target = await resolveOptionalPlaywrightTarget(args, toolOptions);
  const page = target?.page ?? await getOrCreatePage(toolOptions?.sessionId);
  const loc = target?.locator ?? page.locator("body");
  const yaml = await loc.ariaSnapshot({ mode: "ai", timeout: 10_000 });
  const refs = parsePlaywrightSnapshotRefs(yaml);
  replaceSnapshotRefs(refs, toolOptions?.sessionId);
  const truncated = yaml.length > MAX_SNAPSHOT_CHARS
    ? yaml.slice(0, MAX_SNAPSHOT_CHARS - 3) + "..."
    : yaml;
  return okTool({
    snapshot: truncated,
    length: yaml.length,
    refs,
    refCount: refs.length,
    selector: target?.ref ? undefined : target?.selector,
    ref: target?.ref,
    hint: buildPlaywrightSnapshotHint(yaml),
  });
});

const pwDownloadFn = pwTool("Download failed", async (args, toolOptions) => {
  const { url, save_to } = args as {
    url?: string;
    save_to?: string;
  };
  const downloadUrl = typeof url === "string" ? url.trim() : "";
  const target = downloadUrl
    ? null
    : await resolvePlaywrightTarget(args, toolOptions);
  if (!target && !downloadUrl) {
    throw pwError("ref, selector, or url is required");
  }

  const page = target?.page ?? await getOrCreatePage(toolOptions?.sessionId);
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
      target!.locator.click({ timeout: 10_000 }),
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
            selector: target?.selector,
            ref: target?.ref,
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
          selector: target?.selector,
          ref: target?.ref,
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
    selector: target?.ref ? undefined : target?.selector,
    ref: target?.ref,
  });
});

const VALID_TAB_ACTIONS = new Set(["list", "select", "close", "new"]);

const pwTabsFn = pwTool("Tab action failed", async (args, toolOptions) => {
  const {
    action,
    index,
    url,
  } = args as { action?: string; index?: number; url?: string };
  const normalizedAction = typeof action === "string"
    ? action.trim().toLowerCase()
    : "list";
  if (!VALID_TAB_ACTIONS.has(normalizedAction)) {
    throw pwError(
      `Invalid action: "${action}". Must be "list", "select", "close", or "new".`,
    );
  }

  switch (normalizedAction) {
    case "list": {
      const tabs = await listBrowserTabs(toolOptions?.sessionId);
      return okTool({
        action: "list",
        tabs,
        activeIndex: tabs.find((tab) => tab.active)?.index ?? null,
      });
    }
    case "select": {
      if (!Number.isInteger(index)) {
        throw pwError("index is required for pw_tabs action='select'");
      }
      const page = await selectBrowserTab(Number(index), toolOptions?.sessionId);
      const tabs = await listBrowserTabs(toolOptions?.sessionId);
      return okTool({
        action: "select",
        index: Number(index),
        url: page.url(),
        title: await page.title(),
        tabs,
      });
    }
    case "close": {
      const closeIndex = index == null ? undefined : Number(index);
      if (closeIndex != null && !Number.isInteger(closeIndex)) {
        throw pwError("index must be an integer when provided");
      }
      const page = await closeBrowserTab(closeIndex, toolOptions?.sessionId);
      const tabs = await listBrowserTabs(toolOptions?.sessionId);
      return okTool({
        action: "close",
        index: closeIndex ?? null,
        url: page.url(),
        title: await page.title(),
        tabs,
      });
    }
    case "new": {
      const page = await createBrowserTab(
        typeof url === "string" ? url.trim() : undefined,
        toolOptions?.sessionId,
      );
      const tabs = await listBrowserTabs(toolOptions?.sessionId);
      return okTool({
        action: "new",
        url: page.url(),
        title: await page.title(),
        tabs,
      });
    }
    default:
      throw pwError(`Unsupported tab action: ${normalizedAction}`);
  }
});

const pwPromoteFn = pwTool("Promote failed", async (_args, toolOptions) => {
  await promoteToHeaded(toolOptions?.sessionId);
  markComputerUsePromotionPending();
  return okTool({
    promoted: true,
    message:
      "Browser is now visible. Next, call cu_observe or cu_screenshot before any interactive cu_* action. Cookies and localStorage-backed session state should survive, and the current URL is restored best-effort. Unsaved form inputs, sessionStorage-only state, scroll position, JS heap state, and live connections are not guaranteed to survive promotion.",
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
      'Click a DOM element by snapshot ref or selector. Prefer ref from pw_snapshot when available; otherwise use CSS, role/text selector, or shorthand like button "Submit" / link "Docs". Instant and reliable. Use instead of cu_left_click for browser elements.',
    args: {
      ref: PLAYWRIGHT_REF_ARG,
      selector: PLAYWRIGHT_SELECTOR_ARG,
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
      'Fill a form input by snapshot ref or selector. Prefer ref from pw_snapshot when available; otherwise use CSS/role selector or shorthand like textbox "Email" / searchbox "Search". Sets value directly — no keystrokes needed. Use instead of cu_left_click + cu_type for browser forms.',
    args: {
      ref: PLAYWRIGHT_REF_ARG,
      selector: PLAYWRIGHT_SELECTOR_ARG,
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
      'Type text into a browser input or search field by snapshot ref or selector. This is a browser-side typing alias for pw_fill; use it when the model naturally wants a typing action. Set submit=true to press Enter after typing.',
    args: {
      ref: PLAYWRIGHT_REF_ARG,
      selector: PLAYWRIGHT_SELECTOR_ARG,
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
      ref: PLAYWRIGHT_REF_ARG,
      selector:
        "string (optional) - CSS selector. If omitted and ref is absent, returns full page body text.",
    },
    category: "read",
    safetyLevel: "L0",
    safety: "Read-only content extraction from browser DOM.",
    formatResult: (result) =>
      formatStructuredLlmResult(result, RESULT_SUMMARY.content, "Read content"),
  },

  pw_back: {
    fn: pwBackFn,
    description:
      "Navigate one step back in browser history. Returns the resulting URL and page title.",
    args: {},
    category: "read",
    safetyLevel: "L1",
    safety: "Navigates browser history backward.",
    formatResult: (result) =>
      formatStructuredLlmResult(
        result,
        RESULT_SUMMARY.back,
        "Navigated back",
      ),
  },

  pw_hover: {
    fn: pwHoverFn,
    description:
      "Hover a browser element without clicking it. Useful for menus, tooltips, or hover-triggered controls. Prefer snapshot refs when available.",
    args: {
      ref: PLAYWRIGHT_REF_ARG,
      selector: PLAYWRIGHT_SELECTOR_ARG,
    },
    category: "write",
    safetyLevel: "L2",
    safety: "Moves the browser pointer over an element without clicking.",
    formatResult: () => ({
      summaryDisplay: RESULT_SUMMARY.hover,
      returnDisplay: "Hovered",
    }),
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
      "Take a screenshot of the browser page. Faster than cu_screenshot for browser content. Can target a specific element by ref/selector or capture the full page.",
    args: {
      ref: PLAYWRIGHT_REF_ARG,
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
      "Get the accessibility tree (ARIA snapshot) of the page. Returns element roles, names, and states in YAML plus structured refs. Use BEFORE pw_click/pw_fill/pw_hover to discover what elements exist — much more reliable than guessing selectors.",
    args: {
      ref: PLAYWRIGHT_REF_ARG,
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
      "Download a file and save it to a specified directory. Either click a ref/selector that triggers a download, or provide a direct file URL when the final artifact href is already known. The file is saved with its original filename when available.",
    args: {
      ref: PLAYWRIGHT_REF_ARG,
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

  pw_select_option: {
    fn: pwSelectOptionFn,
    description:
      "Select one or more options in a native <select> or combobox-like control. Prefer snapshot refs when available.",
    args: {
      ref: PLAYWRIGHT_REF_ARG,
      selector: PLAYWRIGHT_SELECTOR_ARG,
      value: "string (optional) - Single option value to select",
      values:
        "string[] (optional) - Multiple option values to select. Use instead of value for multi-select controls.",
    },
    category: "write",
    safetyLevel: "L2",
    safety: "Changes the selected option(s) in a browser form control.",
    formatResult: () => ({
      summaryDisplay: RESULT_SUMMARY.select_option,
      returnDisplay: "Selected option",
    }),
  },

  pw_upload_file: {
    fn: pwUploadFileFn,
    description:
      "Upload one or more files through a file input element. Paths may be absolute or start with ~. Prefer snapshot refs when available.",
    args: {
      ref: PLAYWRIGHT_REF_ARG,
      selector: PLAYWRIGHT_SELECTOR_ARG,
      paths: "string[] - One or more local file paths to upload",
    },
    category: "write",
    safetyLevel: "L2",
    safety: "Attaches local files to a browser file input.",
    formatResult: () => ({
      summaryDisplay: RESULT_SUMMARY.upload_file,
      returnDisplay: "Uploaded file(s)",
    }),
  },

  pw_tabs: {
    fn: pwTabsFn,
    description:
      "List, switch, close, or open browser tabs within the current session.",
    args: {
      action: "string - One of 'list', 'select', 'close', or 'new'",
      index:
        "number (optional) - Tab index for 'select' or 'close'. If omitted for 'close', closes the active tab.",
      url:
        "string (optional) - URL to open when action='new'. If omitted, opens a blank tab.",
    },
    category: "write",
    safetyLevel: "L2",
    safety: "Manages browser tabs in the current session.",
    formatResult: (result) =>
      formatStructuredLlmResult(result, RESULT_SUMMARY.tabs, "Managed tabs"),
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
