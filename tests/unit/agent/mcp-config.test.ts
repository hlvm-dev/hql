import { assertEquals } from "jsr:@std/assert@1";
import {
  addServerToConfig,
  dedupeServers,
  formatServerEntry,
  loadMcpConfig,
  normalizeServerName,
  parseClaudeCodeMcpJson,
  removeServerFromConfig,
} from "../../../src/hlvm/agent/mcp/config.ts";
import { withTempHlvmDir } from "../helpers.ts";

Deno.test("McpConfig: parseClaudeCodeMcpJson parses direct transport entries and normalizes optional fields", () => {
  const servers = parseClaudeCodeMcpJson(
    JSON.stringify({
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
    }),
    "fallback",
  );

  assertEquals(servers.length, 2);
  assertEquals(servers[0].name, "playwright");
  assertEquals(servers[0].command, ["npx", "@playwright/mcp@latest"]);
  assertEquals(servers[0].env, { GOOD: "value" });
  assertEquals(servers[0].disabled_tools, ["browser_install"]);
  assertEquals(servers[0].connection_timeout_ms, 1234);
  assertEquals(servers[1].url, "https://api.githubcopilot.com/mcp/");
});

Deno.test("McpConfig: parseClaudeCodeMcpJson parses wrapped mcpServers entries and ignores unsupported data", () => {
  const wrapped = parseClaudeCodeMcpJson(
    JSON.stringify({
      mcpServers: {
        stripe: {
          type: "http",
          url: "https://mcp.stripe.com",
        },
        broken: { type: "unknown" },
      },
    }),
    "stripe-dir",
  );

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

Deno.test("McpConfig: addServerToConfig persists global config and replaces duplicate names", async () => {
  await withTempHlvmDir(async () => {
    await addServerToConfig({
      name: "Playwright",
      command: ["node", "scripts/one.mjs"],
    });
    await addServerToConfig({
      name: "playwright",
      command: ["node", "scripts/two.mjs"],
    });

    const config = await loadMcpConfig();
    assertEquals(config?.servers.length, 1);
    assertEquals(config?.servers[0].command, ["node", "scripts/two.mjs"]);
  });
});

Deno.test("McpConfig: removeServerFromConfig deletes persisted global entries by normalized name", async () => {
  await withTempHlvmDir(async () => {
    await addServerToConfig({
      name: "Playwright",
      command: ["node", "scripts/playwright.mjs"],
    });

    assertEquals(await removeServerFromConfig("playwright"), true);
    assertEquals(await removeServerFromConfig("playwright"), false);
    assertEquals(await loadMcpConfig(), null);
  });
});

Deno.test("McpConfig: formatServerEntry renders transport targets and scope labels", () => {
  const user = formatServerEntry({
    name: "test",
    command: ["node", "server.js"],
    scope: "user",
  });
  const claudeCode = formatServerEntry({
    name: "serena",
    command: ["uvx", "serena"],
    scope: "claude-code",
  });

  assertEquals(user.scopeLabel, "user");
  assertEquals(user.transport, "stdio");
  assertEquals(claudeCode.scopeLabel, "Claude Code");
});
