/**
 * Chrome Extension Bridge — Tool Definitions
 *
 * ch_* tools use content scripts (not chrome.debugger) for CC parity.
 * No lock guard — CC doesn't lock chrome extension access.
 */

import type { ToolMetadata, FormattedToolResult } from "../registry.ts";
import { chromeExtRequest } from "./bridge.ts";

// ── Tool Factory ────────────────────────────────────────────────────

type ArgExtractor<T> = (args: unknown) => T;

function chTool<TArgs>(
  method: string,
  extractArgs: ArgExtractor<TArgs>,
  meta: Omit<ToolMetadata, "fn">,
): ToolMetadata {
  return {
    ...meta,
    fn: async (args: unknown) => {
      const params = extractArgs(args);
      return await chromeExtRequest(method, params as Record<string, unknown>);
    },
  };
}

function chToolDirect(
  method: string,
  meta: Omit<ToolMetadata, "fn">,
): ToolMetadata {
  return chTool(method, (args) => (args ?? {}) as Record<string, unknown>, meta);
}

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
  // ── Navigation ──

  ch_navigate: chTool("navigate", (a) => ({ url: (a as { url: string }).url }), {
    description: "Navigate the user's Chrome browser to a URL. Uses their existing authenticated sessions.",
    args: { url: "string - The URL to navigate to" },
    category: "web", safetyLevel: "L1",
    safety: "Navigates the user's Chrome to a URL.",
    formatResult: (r) => formatResult(r, (v) => `Navigated to: ${v.title || v.url}`),
  }),

  ch_back: chToolDirect("back", {
    description: "Navigate back in the user's Chrome browser history.",
    args: {}, category: "web", safetyLevel: "L1",
    safety: "Navigates back in browser history.",
  }),

  // ── Interaction ──

  ch_click: chToolDirect("click", {
    description: "Click an element in the user's Chrome by CSS selector or coordinates.",
    args: {
      selector: "string (optional) - CSS selector",
      x: "number (optional) - X coordinate",
      y: "number (optional) - Y coordinate",
    },
    category: "web", safetyLevel: "L2",
    safety: "Clicks an element in the user's browser.",
  }),

  ch_fill: chToolDirect("fill", {
    description: "Fill a form input in the user's Chrome browser.",
    args: { selector: "string - CSS selector", value: "string - Value to fill" },
    category: "web", safetyLevel: "L2",
    safety: "Fills a form input.",
  }),

  ch_type: chToolDirect("type", {
    description: "Type text into the focused element in Chrome. For native keystroke simulation, use cu_type.",
    args: {
      text: "string - Text to type",
      selector: "string (optional) - CSS selector to focus first",
      pressEnter: "boolean (optional) - Press Enter after",
    },
    category: "web", safetyLevel: "L2",
    safety: "Types text via DOM events.",
  }),

  ch_hover: chToolDirect("hover", {
    description: "Hover over an element in the user's Chrome browser.",
    args: { selector: "string - CSS selector" },
    category: "web", safetyLevel: "L1",
    safety: "Hovers an element.",
  }),

  ch_scroll: chTool("scroll", (a) => {
    const { direction, amount } = a as { direction?: string; amount?: number };
    return { direction: direction || "down", amount: amount || 300 };
  }, {
    description: "Scroll the page in the user's Chrome browser.",
    args: {
      direction: 'string (optional) - "up", "down", "left", "right" (default: "down")',
      amount: "number (optional) - Pixels to scroll (default: 300)",
    },
    category: "web", safetyLevel: "L1", safety: "Scrolls the page.",
  }),

  ch_select_option: chToolDirect("select_option", {
    description: "Select an option in a dropdown in the user's Chrome.",
    args: { selector: "string - CSS selector", value: "string - Value to select" },
    category: "web", safetyLevel: "L2", safety: "Selects a dropdown option.",
  }),

  // ── Content Reading ──

  ch_evaluate: chToolDirect("evaluate", {
    description: "Execute JavaScript in the user's Chrome page context.",
    args: { expression: "string - JavaScript expression" },
    category: "web", safetyLevel: "L2",
    safety: "Executes JavaScript in the user's browser.",
  }),

  ch_screenshot: chTool("screenshot", (a) => {
    const { format } = a as { format?: string };
    return { format: format || "png" };
  }, {
    description: "Take a viewport screenshot of the current page. For full-page screenshots, use cu_screenshot.",
    args: { format: 'string (optional) - "png" or "jpeg" (default: "png")' },
    category: "web", safetyLevel: "L1", safety: "Captures viewport screenshot.",
  }),

  ch_content: chTool("content", (a) => {
    const { maxChars } = a as { maxChars?: number };
    return { maxChars: maxChars || 8000 };
  }, {
    description: "Extract text content from the current page in Chrome.",
    args: { maxChars: "number (optional) - Max characters (default: 8000)" },
    category: "web", safetyLevel: "L1", safety: "Reads page text.",
    formatResult: (r) => formatResult(r, (v) => {
      const text = ((v.text as string) || "").slice(0, 200);
      return v.truncated ? `${text} [truncated]` : text;
    }),
  }),

  ch_links: chTool("links", (a) => ({ limit: (a as { limit?: number }).limit || 50 }), {
    description: "Extract all links from the current page in Chrome.",
    args: { limit: "number (optional) - Max links (default: 50)" },
    category: "web", safetyLevel: "L1", safety: "Reads page links.",
  }),

  ch_wait_for: chToolDirect("wait_for", {
    description: "Wait for a CSS selector to appear or network to settle.",
    args: {
      selector: "string (optional) - CSS selector to wait for",
      event: 'string (optional) - e.g., "networkidle"',
      timeout: "number (optional) - Timeout in ms (default: 10000)",
    },
    category: "web", safetyLevel: "L1", safety: "Waits for page state.",
  }),

  ch_find: chToolDirect("find", {
    description: "Search for text on the current page using regex pattern.",
    args: { query: "string - Regex pattern to search for" },
    category: "web", safetyLevel: "L1", safety: "Searches page text.",
  }),

  // ── Tab Management ──

  ch_tabs: chToolDirect("tabs", {
    description: "List all open tabs. Always call before assuming which tabs exist.",
    args: {}, category: "web", safetyLevel: "L0", safety: "Lists browser tabs.",
  }),

  ch_tab_create: chToolDirect("tab_create", {
    description: "Create a new tab in Chrome.",
    args: { url: "string (optional) - URL (default: about:blank)", active: "boolean (optional)" },
    category: "web", safetyLevel: "L2", safety: "Creates a browser tab.",
  }),

  ch_tab_close: chToolDirect("tab_close", {
    description: "Close a tab in Chrome.",
    args: { tabId: "number (optional) - Tab ID (default: active)" },
    category: "web", safetyLevel: "L2", safety: "Closes a browser tab.",
  }),

  ch_tab_select: chToolDirect("tab_select", {
    description: "Switch to a specific tab.",
    args: { tabId: "number - Tab ID" },
    category: "web", safetyLevel: "L1", safety: "Switches active tab.",
  }),

  ch_resize_window: chToolDirect("resize_window", {
    description: "Resize the Chrome browser window.",
    args: { width: "number - Width in pixels", height: "number - Height in pixels" },
    category: "web", safetyLevel: "L1", safety: "Resizes browser window.",
  }),

  // ── Monitoring ──

  ch_console: chTool("get_console_messages", (a) => ({ since: (a as { since?: number }).since || 0 }), {
    description: "Read console messages from Chrome. Call ch_enable_monitoring first.",
    args: { since: "number (optional) - Only after this timestamp" },
    category: "web", safetyLevel: "L0", safety: "Reads console.",
  }),

  ch_network: chTool("get_network_requests", (a) => ({ since: (a as { since?: number }).since || 0 }), {
    description: "Read network requests from Chrome. Call ch_enable_monitoring first.",
    args: { since: "number (optional) - Only after this timestamp" },
    category: "web", safetyLevel: "L0", safety: "Reads network logs.",
  }),

  ch_enable_monitoring: chToolDirect("enable_monitoring", {
    description: "Enable console and network monitoring on the active tab.",
    args: {}, category: "web", safetyLevel: "L1",
    safety: "Injects console monitoring script and enables webRequest listeners.",
  }),
};
