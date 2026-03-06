import { assertEquals } from "jsr:@std/assert@1";
import { getPlatform } from "../../../src/platform/platform.ts";
import {
  addServerToConfig,
  dedupeServers,
  formatServerEntry,
  loadMcpConfig,
  normalizeServerName,
  parseClaudeCodeMcpJson,
  removeServerFromConfig,
} from "../../../src/hlvm/agent/mcp/config.ts";

async function withWorkspace(fn: (workspace: string) => Promise<void>): Promise<void> {
  const platform = getPlatform();
  const workspace = await platform.fs.makeTempDir({ prefix: "hlvm-mcp-config-test-" });
  try {
    await fn(workspace);
  } finally {
    await platform.fs.remove(workspace, { recursive: true });
  }
}

Deno.test("McpConfig: parseClaudeCodeMcpJson parses direct transport entries and normalizes optional fields", () => {
  const servers = parseClaudeCodeMcpJson(JSON.stringify({
    playwright: {
      command: "npx",
      args: ["@playwright/mcp@latest"],
      env: { GOOD: "value", BAD: 123 },
      disabled_tools: ["browser_install", 42],
      connection_timeout_ms: 1234.8,
    },
    github: {
      type: "http",
      url: "https://api.githubcopilot.com/mcp/",
    },
  }), "fallback");

  assertEquals(servers.length, 2);
  assertEquals(servers[0].name, "playwright");
  assertEquals(servers[0].command, ["npx", "@playwright/mcp@latest"]);
  assertEquals(servers[0].env, { GOOD: "value" });
  assertEquals(servers[0].disabled_tools, ["browser_install"]);
  assertEquals(servers[0].connection_timeout_ms, 1234);
  assertEquals(servers[1].url, "https://api.githubcopilot.com/mcp/");
});

Deno.test("McpConfig: parseClaudeCodeMcpJson parses wrapped mcpServers entries and ignores unsupported data", () => {
  const wrapped = parseClaudeCodeMcpJson(JSON.stringify({
    mcpServers: {
      stripe: {
        type: "http",
        url: "https://mcp.stripe.com",
      },
      broken: { type: "unknown" },
    },
  }), "stripe-dir");

  assertEquals(wrapped.length, 1);
  assertEquals(wrapped[0].name, "stripe");
  assertEquals(wrapped[0].url, "https://mcp.stripe.com");

  assertEquals(parseClaudeCodeMcpJson("not json", "test"), []);
  assertEquals(parseClaudeCodeMcpJson("{}", "test"), []);
});

Deno.test("McpConfig: normalizeServerName and dedupeServers are case-insensitive and first-win", () => {
  const deduped = dedupeServers([
    { name: " Playwright ", command: ["node", "a.js"] },
    { name: "playwright", command: ["node", "b.js"] },
    { name: "GitHub", url: "https://example.com/mcp" },
  ]);

  assertEquals(normalizeServerName(" Playwright "), "playwright");
  assertEquals(deduped.length, 2);
  assertEquals(deduped[0].command, ["node", "a.js"]);
  assertEquals(deduped[1].name, "GitHub");
});

Deno.test("McpConfig: addServerToConfig persists project config and replaces duplicate names", async () => {
  await withWorkspace(async (workspace) => {
    await addServerToConfig("project", workspace, {
      name: "Playwright",
      command: ["node", "scripts/one.mjs"],
    });
    await addServerToConfig("project", workspace, {
      name: "playwright",
      command: ["node", "scripts/two.mjs"],
    });

    const config = await loadMcpConfig(workspace);
    assertEquals(config?.servers.length, 1);
    assertEquals(config?.servers[0].command, ["node", "scripts/two.mjs"]);
  });
});

Deno.test("McpConfig: removeServerFromConfig deletes persisted project entries by normalized name", async () => {
  await withWorkspace(async (workspace) => {
    await addServerToConfig("project", workspace, {
      name: "Playwright",
      command: ["node", "scripts/playwright.mjs"],
    });

    assertEquals(await removeServerFromConfig("project", workspace, "playwright"), true);
    assertEquals(await removeServerFromConfig("project", workspace, "playwright"), false);
    assertEquals(await loadMcpConfig(workspace), null);
  });
});

Deno.test("McpConfig: formatServerEntry renders transport targets and scope labels", () => {
  const dotmcp = formatServerEntry({
    name: "test",
    command: ["node", "server.js"],
    scope: "dotmcp",
  });
  const project = formatServerEntry({
    name: "test",
    url: "https://example.com",
    scope: "project",
  });
  const claudeCode = formatServerEntry({
    name: "serena",
    command: ["uvx", "serena"],
    scope: "claude-code",
  });

  assertEquals(dotmcp.scopeLabel, ".mcp.json");
  assertEquals(dotmcp.transport, "stdio");
  assertEquals(project.scopeLabel, "project");
  assertEquals(project.transport, "http");
  assertEquals(claudeCode.scopeLabel, "Claude Code");
});
