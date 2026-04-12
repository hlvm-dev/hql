/**
 * Chrome Extension Bridge — Tool Definitions
 *
 * ch_* tools parallel pw_* tools but route through the Chrome extension
 * for access to the user's authenticated browser sessions.
 */

import type { ToolMetadata, FormattedToolResult } from "../registry.ts";
import { chromeExtRequest } from "./bridge.ts";
import { tryAcquireChromeExtLock } from "./lock.ts";

// ── Shared Tool Factory ─────────────────────────────────────────────

type ArgExtractor<T> = (args: unknown) => T;

/**
 * Create a ch_* tool handler with lock guard + chrome extension request.
 * Eliminates the repeated ensureLock + chromeExtRequest pattern.
 */
function chTool<TArgs, TResult = unknown>(
  method: string,
  extractArgs: ArgExtractor<TArgs>,
  meta: Omit<ToolMetadata, "fn">,
): ToolMetadata {
  return {
    ...meta,
    fn: async (
      args: unknown,
      _workspace: string,
      options?: { sessionId?: string },
    ) => {
      const lockResult = await tryAcquireChromeExtLock(
        options?.sessionId ?? "default",
      );
      if (lockResult.kind === "blocked") {
        throw new Error(
          `Chrome extension is in use by another session (${lockResult.by}). Try again later.`,
        );
      }
      const params = extractArgs(args);
      return await chromeExtRequest<TResult>(
        method,
        params as Record<string, unknown>,
      );
    },
  };
}

/** Shorthand for tools that pass args directly. */
function chToolDirect(
  method: string,
  meta: Omit<ToolMetadata, "fn">,
): ToolMetadata {
  return chTool(method, (args) => (args ?? {}) as Record<string, unknown>, meta);
}

// ── Result Formatting ───────────────────────────────────────────────

function formatResult(
  result: unknown,
  summarize: (r: Record<string, unknown>) => string,
): FormattedToolResult | null {
  if (!result || typeof result !== "object") return null;
  const summary = summarize(result as Record<string, unknown>);
  return { returnDisplay: summary, llmContent: summary };
}

// ── Tool Definitions ────────────────────────────────────────────────

export const CHROME_EXT_TOOLS: Record<string, ToolMetadata> = {
  // ── Navigation ──────────────────────────────────────────────────

  ch_navigate: chTool(
    "navigate",
    (args) => {
      const { url } = args as { url: string };
      return { url };
    },
    {
      description:
        "Navigate the user's Chrome browser to a URL. Uses their existing authenticated sessions.",
      args: { url: "string - The URL to navigate to" },
      category: "web",
      safetyLevel: "L1",
      safety: "Navigates the user's Chrome to a URL.",
      formatResult: (r) =>
        formatResult(r, (v) => `Navigated to: ${v.title || v.url}`),
    },
  ),

  ch_back: chToolDirect("back", {
    description: "Navigate back in the user's Chrome browser history.",
    args: {},
    category: "web",
    safetyLevel: "L1",
    safety: "Navigates back in browser history.",
  }),

  // ── Interaction ─────────────────────────────────────────────────

  ch_click: chToolDirect("click", {
    description:
      "Click an element in the user's Chrome by CSS selector or coordinates.",
    args: {
      selector: "string (optional) - CSS selector of the element to click",
      x: "number (optional) - X coordinate to click",
      y: "number (optional) - Y coordinate to click",
    },
    category: "web",
    safetyLevel: "L2",
    safety: "Clicks an element in the user's browser.",
  }),

  ch_fill: chToolDirect("fill", {
    description: "Fill a form input in the user's Chrome browser.",
    args: {
      selector: "string - CSS selector of the input element",
      value: "string - Value to fill",
    },
    category: "web",
    safetyLevel: "L2",
    safety: "Fills a form input in the user's browser.",
  }),

  ch_type: chToolDirect("type", {
    description:
      "Type text character by character in the user's Chrome. Optionally focus a selector first and press Enter after.",
    args: {
      text: "string - Text to type",
      selector: "string (optional) - CSS selector to focus first",
      pressEnter: "boolean (optional) - Press Enter after typing",
    },
    category: "web",
    safetyLevel: "L2",
    safety: "Types text into the user's browser.",
  }),

  ch_hover: chToolDirect("hover", {
    description: "Hover over an element in the user's Chrome browser.",
    args: { selector: "string - CSS selector of the element to hover" },
    category: "web",
    safetyLevel: "L1",
    safety: "Hovers an element without clicking.",
  }),

  ch_scroll: chTool(
    "scroll",
    (args) => {
      const { direction, amount } = args as {
        direction?: string;
        amount?: number;
      };
      return { direction: direction || "down", amount: amount || 300 };
    },
    {
      description: "Scroll the page in the user's Chrome browser.",
      args: {
        direction:
          'string (optional) - "up", "down", "left", "right" (default: "down")',
        amount: "number (optional) - Pixels to scroll (default: 300)",
      },
      category: "web",
      safetyLevel: "L1",
      safety: "Scrolls the page.",
    },
  ),

  ch_select_option: chToolDirect("select_option", {
    description:
      "Select an option in a dropdown/select element in the user's Chrome.",
    args: {
      selector: "string - CSS selector of the select element",
      value: "string - Value to select",
    },
    category: "web",
    safetyLevel: "L2",
    safety: "Selects a dropdown option.",
  }),

  // ── Content Reading ─────────────────────────────────────────────

  ch_evaluate: chToolDirect("evaluate", {
    description:
      "Execute JavaScript in the user's Chrome page context. Returns the result.",
    args: { expression: "string - JavaScript expression to evaluate" },
    category: "web",
    safetyLevel: "L2",
    safety: "Executes JavaScript in the user's browser page context.",
  }),

  ch_screenshot: chTool(
    "screenshot",
    (args) => {
      const { fullPage, format } = args as {
        fullPage?: boolean;
        format?: string;
      };
      return { fullPage: fullPage || false, format: format || "png" };
    },
    {
      description:
        "Take a screenshot of the current page in the user's Chrome browser.",
      args: {
        fullPage:
          "boolean (optional) - Capture full page (default: false)",
        format: 'string (optional) - "png" or "jpeg" (default: "png")',
      },
      category: "web",
      safetyLevel: "L1",
      safety: "Captures a screenshot.",
    },
  ),

  ch_snapshot: chToolDirect("snapshot", {
    description:
      "Get the accessibility tree of the current page in the user's Chrome via CDP.",
    args: {},
    category: "web",
    safetyLevel: "L1",
    safety: "Reads the accessibility tree.",
  }),

  ch_content: chTool(
    "content",
    (args) => {
      const { maxChars } = args as { maxChars?: number };
      return { maxChars: maxChars || 8000 };
    },
    {
      description:
        "Extract text content from the current page in the user's Chrome.",
      args: {
        maxChars:
          "number (optional) - Maximum characters to return (default: 8000)",
      },
      category: "web",
      safetyLevel: "L1",
      safety: "Reads page text content.",
      formatResult: (r) =>
        formatResult(r, (v) => {
          const text = ((v.text as string) || "").slice(0, 200);
          return v.truncated ? `${text} [truncated]` : text;
        }),
    },
  ),

  ch_links: chTool(
    "links",
    (args) => {
      const { limit } = args as { limit?: number };
      return { limit: limit || 50 };
    },
    {
      description:
        "Extract all links from the current page in the user's Chrome.",
      args: { limit: "number (optional) - Max links to return (default: 50)" },
      category: "web",
      safetyLevel: "L1",
      safety: "Reads page links.",
    },
  ),

  ch_wait_for: chToolDirect("wait_for", {
    description:
      "Wait for a CSS selector to appear or network to settle in the user's Chrome.",
    args: {
      selector: "string (optional) - CSS selector to wait for",
      event: 'string (optional) - Event to wait for (e.g., "networkidle")',
      timeout: "number (optional) - Timeout in ms (default: 10000)",
    },
    category: "web",
    safetyLevel: "L1",
    safety: "Waits for page state.",
  }),

  // ── Tab Management ──────────────────────────────────────────────

  ch_tabs: chToolDirect("tabs", {
    description:
      "List all open tabs in the user's Chrome. Always call this before assuming which tabs exist.",
    args: {},
    category: "web",
    safetyLevel: "L0",
    safety: "Lists browser tabs. Auto-approved.",
  }),

  ch_tab_create: chToolDirect("tab_create", {
    description: "Create a new tab in the user's Chrome browser.",
    args: {
      url: "string (optional) - URL to open (default: about:blank)",
      active: "boolean (optional) - Make the new tab active (default: true)",
    },
    category: "web",
    safetyLevel: "L2",
    safety: "Creates a new browser tab.",
  }),

  ch_tab_close: chToolDirect("tab_close", {
    description: "Close a tab in the user's Chrome browser.",
    args: { tabId: "number (optional) - Tab ID to close (default: active tab)" },
    category: "web",
    safetyLevel: "L2",
    safety: "Closes a browser tab.",
  }),

  ch_tab_select: chToolDirect("tab_select", {
    description: "Switch to a specific tab in the user's Chrome browser.",
    args: { tabId: "number - Tab ID to switch to" },
    category: "web",
    safetyLevel: "L1",
    safety: "Switches active tab.",
  }),

  // ── Console & Network Monitoring ────────────────────────────────

  ch_monitor: chToolDirect("enable_monitoring", {
    description:
      "Enable console and network monitoring on the active tab. Call before ch_console or ch_network.",
    args: {},
    category: "web",
    safetyLevel: "L1",
    safety: "Attaches chrome.debugger to monitor console/network.",
  }),

  ch_console: chTool(
    "get_console_messages",
    (args) => {
      const { since } = args as { since?: number };
      return { since: since || 0 };
    },
    {
      description:
        "Read console messages from the user's Chrome. Requires ch_monitor first.",
      args: { since: "number (optional) - Only messages after this timestamp" },
      category: "web",
      safetyLevel: "L0",
      safety: "Reads console output. Auto-approved.",
    },
  ),

  ch_network: chTool(
    "get_network_requests",
    (args) => {
      const { since } = args as { since?: number };
      return { since: since || 0 };
    },
    {
      description:
        "Read network requests from the user's Chrome. Requires ch_monitor first.",
      args: {
        since: "number (optional) - Only requests after this timestamp",
      },
      category: "web",
      safetyLevel: "L0",
      safety: "Reads network logs. Auto-approved.",
    },
  ),
};
