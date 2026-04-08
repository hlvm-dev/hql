/**
 * Playwright Tools — 7 browser automation tools
 *
 * Fast, deterministic DOM-level browser control via Chrome DevTools Protocol.
 * Complements the 22 cu_* computer use tools (pixel-level desktop control).
 *
 * Tool name prefix: `pw_*`
 * All tools: minTier "standard" (constrained models never see them)
 * Browser: one shared headed Chromium instance per session (browser-manager.ts)
 *
 * The LLM picks between pw_* (fast, DOM) and cu_* (visual, native) per action.
 */

import type { ToolMetadata, ToolExecutionOptions } from "../registry.ts";
import { failTool, formatToolError, okTool } from "../tool-results.ts";
import { isChromiumReady } from "../../runtime/chromium-runtime.ts";
import { getOrCreatePage } from "./browser-manager.ts";

// ── Result summary labels (matches CU pattern) ──────────────────────────

const RESULT_SUMMARY: Record<string, string> = {
  goto: "Navigated",
  click: "Clicked",
  fill: "Filled",
  content: "Read content",
  wait_for: "Waited",
  screenshot: "Captured",
  evaluate: "Evaluated",
};

// ── Image attachment (reuses same _imageAttachment format as CU) ────────

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

// ── Tool wrapper (mirrors cuTool pattern from computer-use/tools.ts) ────

function pwTool(
  errorPrefix: string,
  fn: (args: unknown) => Promise<unknown>,
): (args: unknown, cwd: string, options?: ToolExecutionOptions) => Promise<unknown> {
  return async (args, _cwd, _options) => {
    if (!await isChromiumReady()) {
      return failTool(
        "Browser not available. Run `hlvm bootstrap` to install Chromium.",
      );
    }
    try {
      return await fn(args);
    } catch (error) {
      return failTool(formatToolError(errorPrefix, error).message);
    }
  };
}

// ── Tool implementations ─────────────────────────────────────────────────

const pwGotoFn = pwTool("Navigation failed", async (args) => {
  const { url } = args as { url: string };
  if (!url) throw new Error("url is required");
  const page = await getOrCreatePage();
  const response = await page.goto(url, { waitUntil: "domcontentloaded" });
  return okTool({
    url: page.url(),
    status: response?.status() ?? null,
    title: await page.title(),
  });
});

const pwClickFn = pwTool("Click failed", async (args) => {
  const { selector } = args as { selector: string };
  const sel = typeof selector === "string" ? selector.trim() : "";
  if (!sel) throw new Error("selector is required");
  const page = await getOrCreatePage();
  await page.click(sel, { timeout: 10_000 });
  return okTool({ clicked: true, selector: sel });
});

const pwFillFn = pwTool("Fill failed", async (args) => {
  const { selector, value } = args as { selector: string; value: string };
  const sel = typeof selector === "string" ? selector.trim() : "";
  if (!sel) throw new Error("selector is required");
  if (value == null) throw new Error("value is required");
  const page = await getOrCreatePage();
  await page.fill(sel, String(value), { timeout: 10_000 });
  return okTool({ filled: true, selector: sel });
});

const pwContentFn = pwTool("Content read failed", async (args) => {
  const { selector } = args as { selector?: string };
  const sel = typeof selector === "string" ? selector.trim() : "";
  const page = await getOrCreatePage();
  let text: string;
  if (sel) {
    const el = await page.$(sel);
    if (!el) throw new Error(`Element not found: ${sel}`);
    text = (await el.textContent()) ?? "";
  } else {
    text = await page.innerText("body");
  }
  const truncated = text.length > 8000 ? text.slice(0, 7997) + "..." : text;
  return okTool({ text: truncated, length: text.length });
});

const VALID_WAIT_CONDITIONS = new Set(["networkidle", "selector"]);

const pwWaitForFn = pwTool("Wait failed", async (args) => {
  const { condition, selector, timeout } = args as {
    condition: string;
    selector?: string;
    timeout?: number;
  };
  if (!VALID_WAIT_CONDITIONS.has(condition)) {
    throw new Error(`Invalid condition: "${condition}". Must be "networkidle" or "selector".`);
  }
  const page = await getOrCreatePage();
  const ms = Number(timeout) || 30_000;

  if (condition === "selector") {
    const sel = typeof selector === "string" ? selector.trim() : "";
    if (!sel) throw new Error("selector is required when condition is 'selector'");
    await page.waitForSelector(sel, { timeout: ms });
  } else {
    await page.waitForLoadState("networkidle", { timeout: ms });
  }
  return okTool({ ready: true, condition });
});

const pwScreenshotFn = pwTool("Screenshot failed", async (args) => {
  const { selector, fullPage } = args as {
    selector?: string;
    fullPage?: boolean;
  };
  const page = await getOrCreatePage();

  let bytes: Uint8Array;
  if (selector) {
    const sel = typeof selector === "string" ? selector.trim() : "";
    if (!sel) throw new Error("selector must be non-empty");
    const el = await page.$(sel);
    if (!el) throw new Error(`Element not found: ${sel}`);
    bytes = new Uint8Array(await el.screenshot({ type: "png" }));
  } else {
    bytes = new Uint8Array(await page.screenshot({
      type: "png",
      fullPage: fullPage === true,
    }));
  }

  // Deno-safe base64 encoding (Playwright may return Buffer or Uint8Array)
  const base64 = btoa(Array.from(bytes, (b) => String.fromCharCode(b)).join(""));
  const viewport = page.viewportSize() ?? { width: 1280, height: 720 };
  return imageResult(
    { width: viewport.width, height: viewport.height },
    { base64, width: viewport.width, height: viewport.height },
  );
});

const pwEvaluateFn = pwTool("Evaluate failed", async (args) => {
  const { expression } = args as { expression: string };
  const expr = typeof expression === "string" ? expression.trim() : "";
  if (!expr) throw new Error("expression is required");
  const page = await getOrCreatePage();
  try {
    const result = await page.evaluate(expr);
    return okTool({ result });
  } catch (err) {
    // Handle non-serializable results (DOM nodes, functions, etc.)
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("serialize") || msg.includes("circular")) {
      throw new Error(`Expression returned a non-serializable value. Wrap in JSON-safe output: ${msg}`);
    }
    throw err;
  }
});

const pwPromoteFn = pwTool("Promote failed", async () => {
  const { promoteToHeaded } = await import("./browser-manager.ts");
  await promoteToHeaded();
  return okTool({
    promoted: true,
    message: "Browser is now visible. CU tools can see and interact with it. Note: in-memory page state (SPA, forms) may be lost — re-navigate if needed.",
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
    formatResult: () => ({
      summaryDisplay: RESULT_SUMMARY.goto,
      returnDisplay: "Navigated",
    }),
  },

  pw_click: {
    fn: pwClickFn,
    description:
      "Click a DOM element by CSS selector or text content (e.g. 'text=Submit'). Instant and reliable. Use instead of cu_left_click for browser elements.",
    args: { selector: "string - CSS selector or text= selector" },
    category: "write",
    safetyLevel: "L2",
    safety: "Clicks a browser element. May trigger form submissions or navigation.",
    formatResult: () => ({
      summaryDisplay: RESULT_SUMMARY.click,
      returnDisplay: "Clicked",
    }),
  },

  pw_fill: {
    fn: pwFillFn,
    description:
      "Fill a form input by CSS selector. Sets value directly — no keystrokes needed. Use instead of cu_left_click + cu_type for browser forms.",
    args: {
      selector: "string - CSS selector for the input element",
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
    formatResult: () => ({
      summaryDisplay: RESULT_SUMMARY.content,
      returnDisplay: "Read content",
    }),
  },

  pw_wait_for: {
    fn: pwWaitForFn,
    description:
      "Wait for a page to finish loading or for a specific element to appear. Use 'networkidle' after navigation, or 'selector' to wait for dynamic content.",
    args: {
      condition:
        "string - 'networkidle' (wait for network to settle) or 'selector' (wait for element)",
      selector: "string (optional) - CSS selector (required if condition is 'selector')",
      timeout: "number (optional) - Timeout in milliseconds (default: 30000)",
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
      fullPage: "boolean (optional) - Capture full scrollable page (default: false)",
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
      "Execute JavaScript in the browser page context. Returns the result. Use for complex DOM operations, extracting structured data, or interacting with page scripts.",
    args: {
      expression: "string - JavaScript expression to evaluate in the page",
    },
    category: "write",
    safetyLevel: "L2",
    safety: "Executes arbitrary JavaScript in the browser. Use carefully.",
    formatResult: () => ({
      summaryDisplay: RESULT_SUMMARY.evaluate,
      returnDisplay: "Evaluated",
    }),
  },

  pw_promote: {
    fn: pwPromoteFn,
    description:
      "Make the browser window visible so cu_* tools can see and interact with it. Use ONLY when pw_* tools fail and you need visual CU interaction (CAPTCHA, native dialog). Warning: in-memory page state may be lost — re-navigate if needed after promoting.",
    args: {},
    category: "write",
    safetyLevel: "L2",
    safety: "Relaunches browser in visible mode. Page state may be lost.",
    formatResult: () => ({
      summaryDisplay: "Promoted",
      returnDisplay: "Browser promoted to visible",
    }),
  },
};
