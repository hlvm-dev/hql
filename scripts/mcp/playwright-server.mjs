#!/usr/bin/env node
/**
 * MCP Playwright Server (Node.js)
 *
 * Exposes a headless browser render tool over MCP (JSON-RPC over stdio).
 *
 * Tool: render_url
 * - Renders a page with Playwright (Chromium)
 * - Returns HTML + visible text + links
 *
 * Note: Requires Playwright + browser binaries installed.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { chromium } from "playwright";

const DEFAULT_TIMEOUT_MS = 45_000;
const DEFAULT_WAIT_MS = 1_000;
const DEFAULT_MAX_HTML = 2 * 1024 * 1024;
const DEFAULT_MAX_TEXT = 4000;
const DEFAULT_MAX_LINKS = 20;

let browserPromise = null;

function ensureSafeHome() {
  const safeHome = process.env.HLVM_PLAYWRIGHT_HOME ||
    path.join(os.tmpdir(), "hlvm-playwright-home");
  fs.mkdirSync(safeHome, { recursive: true });
  process.env.HOME = safeHome;
  process.env.USERPROFILE = safeHome;
}

function resolveChromiumExecutable() {
  const defaultPath = chromium.executablePath();
  if (fs.existsSync(defaultPath)) {
    return defaultPath;
  }

  const candidates = new Set();
  if (defaultPath.includes("mac-x64")) {
    candidates.add(defaultPath.replace("mac-x64", "mac-arm64"));
    candidates.add(
      defaultPath.replace(
        "chrome-headless-shell-mac-x64",
        "chrome-headless-shell-mac-arm64",
      ),
    );
  }
  if (defaultPath.includes("mac-arm64")) {
    candidates.add(defaultPath.replace("mac-arm64", "mac-x64"));
    candidates.add(
      defaultPath.replace(
        "chrome-headless-shell-mac-arm64",
        "chrome-headless-shell-mac-x64",
      ),
    );
  }

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  return defaultPath;
}

async function getBrowser() {
  if (!browserPromise) {
    ensureSafeHome();
    const executablePath = resolveChromiumExecutable();
    browserPromise = chromium.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-crash-reporter"],
      executablePath,
    });
  }
  return await browserPromise;
}

function getErrorMessage(error) {
  if (error instanceof Error) return error.message;
  return String(error);
}

function write(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

function respondOk(id, result) {
  write({ jsonrpc: "2.0", id, result });
}

function respondError(id, message, data) {
  write({ jsonrpc: "2.0", id, error: { code: -32000, message, data } });
}

async function renderUrl(args) {
  if (!args || typeof args !== "object") {
    throw new TypeError("args must be an object");
  }
  if (!args.url || typeof args.url !== "string") {
    throw new TypeError("url is required");
  }

  const timeoutMs = typeof args.timeoutMs === "number" && args.timeoutMs > 0
    ? args.timeoutMs
    : DEFAULT_TIMEOUT_MS;
  const waitMs = typeof args.waitMs === "number" && args.waitMs >= 0
    ? args.waitMs
    : DEFAULT_WAIT_MS;
  const maxHtmlLength =
    typeof args.maxHtmlLength === "number" && args.maxHtmlLength > 0
      ? args.maxHtmlLength
      : DEFAULT_MAX_HTML;
  const maxTextLength =
    typeof args.maxTextLength === "number" && args.maxTextLength > 0
      ? args.maxTextLength
      : DEFAULT_MAX_TEXT;
  const maxLinks = typeof args.maxLinks === "number" && args.maxLinks > 0
    ? args.maxLinks
    : DEFAULT_MAX_LINKS;
  const textSelectorLimit =
    typeof args.textSelectorLimit === "number" && args.textSelectorLimit > 0
      ? args.textSelectorLimit
      : 20;

  const browser = await getBrowser();
  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    const response = await page.goto(args.url, {
      // Some JS-heavy sites keep background connections open forever.
      // Use DOM readiness for reliable navigation, then try networkidle best-effort.
      waitUntil: "domcontentloaded",
      timeout: timeoutMs,
    });
    try {
      await page.waitForLoadState("networkidle", {
        timeout: Math.min(5_000, timeoutMs),
      });
    } catch {
      // Ignore: page is still usable even if it never reaches networkidle.
    }

    let selectorFound = false;
    if (args.selector && typeof args.selector === "string") {
      try {
        await page.waitForSelector(args.selector, { timeout: timeoutMs });
        selectorFound = true;
      } catch {
        // Fall back to timed wait if selector never appears.
        if (waitMs > 0) {
          await page.waitForTimeout(waitMs);
        }
      }
    } else if (waitMs > 0) {
      await page.waitForTimeout(waitMs);
    }

    const [html, text, title, links, textMatches] = await Promise.all([
      page.content(),
      page.evaluate(() => document.body?.innerText ?? ""),
      page.title(),
      page.evaluate((limit) => {
        const seen = new Set();
        const out = [];
        const nodes = Array.from(document.querySelectorAll("a"));
        for (const node of nodes) {
          const href = node.href || node.getAttribute("href") || "";
          const normalized = href.trim();
          if (!normalized || normalized.startsWith("#")) continue;
          if (normalized.toLowerCase().startsWith("javascript:")) continue;
          if (!seen.has(normalized)) {
            seen.add(normalized);
            out.push(normalized);
            if (out.length >= limit) break;
          }
        }
        return out;
      }, maxLinks),
      args.textSelector && typeof args.textSelector === "string"
        ? page.$$eval(
          args.textSelector,
          (nodes, limit) => {
            const out = [];
            for (const node of nodes) {
              const value = (node.textContent ?? "").trim();
              if (value) {
                out.push(value);
                if (out.length >= limit) break;
              }
            }
            return out;
          },
          textSelectorLimit,
        )
        : Promise.resolve([]),
    ]);

    const htmlTruncated = html.length > maxHtmlLength;
    const textTruncated = text.length > maxTextLength;

    return {
      url: args.url,
      status: response ? response.status() : null,
      ok: response ? response.ok() : null,
      title,
      html: htmlTruncated ? html.slice(0, maxHtmlLength) : html,
      htmlTruncated,
      text: textTruncated ? text.slice(0, maxTextLength) : text,
      textTruncated,
      links,
      linkCount: links.length,
      textSelector: args.textSelector ?? null,
      selector: args.selector ?? null,
      selectorFound,
      textMatches,
    };
  } finally {
    await page.close();
    await context.close();
  }
}

function handleInitialize(request) {
  respondOk(request.id, {
    protocolVersion: "2024-11-05",
    serverInfo: { name: "playwright-mcp", version: "0.1.0" },
    capabilities: { tools: {} },
  });
}

function handleToolsList(request) {
  respondOk(request.id, {
    tools: [
      {
        name: "render_url",
        description:
          "Render a URL in headless Chromium and return HTML/text/links.",
        inputSchema: {
          type: "object",
          properties: {
            url: { type: "string", description: "URL to render" },
            timeoutMs: {
              type: "number",
              description: "Navigation timeout in ms",
            },
            waitMs: {
              type: "number",
              description: "Extra wait time after load in ms",
            },
            selector: {
              type: "string",
              description: "Wait for selector before extraction",
            },
            textSelector: {
              type: "string",
              description: "Extract text from matching nodes",
            },
            textSelectorLimit: {
              type: "number",
              description: "Max text nodes to return",
            },
            maxHtmlLength: {
              type: "number",
              description: "Max HTML length to return",
            },
            maxTextLength: {
              type: "number",
              description: "Max text length to return",
            },
            maxLinks: { type: "number", description: "Max links to return" },
          },
          required: ["url"],
        },
      },
    ],
  });
}

async function handleToolsCall(request) {
  const params = request.params || {};
  const name = params.name;
  const args = params.arguments || {};

  if (name !== "render_url") {
    respondError(request.id, "Unknown tool", { name });
    return;
  }

  try {
    const result = await renderUrl(args);
    respondOk(request.id, result);
  } catch (error) {
    const message = getErrorMessage(error);
    const hint = message.includes("Executable doesn't exist")
      ? `${message}\nHint: install Chromium with 'npx playwright install chromium'.`
      : message;
    respondError(request.id, hint);
  }
}

async function handleRequest(request) {
  if (!request || typeof request !== "object") return;
  const method = request.method;
  if (method === "initialize") return handleInitialize(request);
  if (method === "tools/list") return handleToolsList(request);
  if (method === "tools/call") return await handleToolsCall(request);
  respondError(request.id, "Unknown method", { method });
}

let buffer = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  buffer += chunk;
  while (true) {
    const index = buffer.indexOf("\n");
    if (index === -1) break;
    const line = buffer.slice(0, index).trim();
    buffer = buffer.slice(index + 1);
    if (!line) continue;
    let request;
    try {
      request = JSON.parse(line);
    } catch (error) {
      respondError(undefined, `Invalid JSON: ${getErrorMessage(error)}`);
      continue;
    }
    handleRequest(request);
  }
});

process.stdin.on("end", async () => {
  if (browserPromise) {
    const browser = await browserPromise.catch(() => null);
    await browser?.close();
  }
});
