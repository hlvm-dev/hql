import { assertEquals } from "jsr:@std/assert@1";
import {
  getClaudeCodeMcpDir,
  getMcpConfigPath,
  setClaudeCodeMcpDirForTests,
} from "../../../src/common/paths.ts";
import {
  addServerToConfig,
  dedupeServers,
  formatServerEntry,
  loadMcpConfig,
  loadMcpConfigMultiScope,
  normalizeServerName,
  parseClaudeCodeMcpJson,
  removeServerFromConfig,
} from "../../../src/hlvm/agent/mcp/config.ts";
import { getPlatform } from "../../../src/platform/platform.ts";
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

Deno.test("McpConfig: parseClaudeCodeMcpJson preserves SSE transport and headers", () => {
  const servers = parseClaudeCodeMcpJson(
    JSON.stringify({
      mcpServers: {
        figma: {
          type: "sse",
          url: "https://mcp.example.test/sse",
          headers: {
            Authorization: "Bearer ${FIGMA_TOKEN}",
            BAD: 123,
          },
          oauth: {
            clientId: "client-123",
            callbackPort: 3118,
          },
        },
      },
    }),
    "figma",
  );

  assertEquals(servers, [{
    name: "figma",
    url: "https://mcp.example.test/sse",
    transport: "sse",
    headers: {
      Authorization: "Bearer ${FIGMA_TOKEN}",
    },
    oauth: {
      clientId: "client-123",
      callbackPort: 3118,
    },
  }]);
});

Deno.test("McpConfig: parseClaudeCodeMcpJson parses wrapped mcpServers entries and ignores unsupported data", () => {
  const wrapped = parseClaudeCodeMcpJson(
    JSON.stringify({
      mcpServers: {
        stripe: {
          type: "http",
          url: "https://mcp.stripe.com",
        },
        websocket: {
          type: "ws",
          url: "wss://mcp.example.test/socket",
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

Deno.test("McpConfig: loadMcpConfigMultiScope scans marketplace plugin trees and injects plugin env", async () => {
  await withTempHlvmDir(async () => {
    const platform = getPlatform();
    const externalPluginsDir = getClaudeCodeMcpDir();
    const marketplaceRoot = platform.path.dirname(externalPluginsDir);
    const marketplacesRoot = platform.path.dirname(marketplaceRoot);
    const officialPluginRoot = platform.path.join(
      marketplaceRoot,
      "plugins",
      "example-plugin",
    );
    const customPluginRoot = platform.path.join(
      marketplacesRoot,
      "custom-marketplace",
      "external_plugins",
      "helper",
    );

    await platform.fs.mkdir(officialPluginRoot, { recursive: true });
    await platform.fs.mkdir(customPluginRoot, { recursive: true });
    await platform.fs.writeTextFile(
      platform.path.join(officialPluginRoot, ".mcp.json"),
      JSON.stringify({
        example: {
          command: "bun",
          args: ["run", "${CLAUDE_PLUGIN_ROOT}/server.ts"],
        },
      }),
    );
    await platform.fs.writeTextFile(
      platform.path.join(customPluginRoot, ".mcp.json"),
      JSON.stringify({
        helper: {
          type: "http",
          url: "https://mcp.example.test",
        },
      }),
    );

    try {
      setClaudeCodeMcpDirForTests(marketplacesRoot);
      const servers = await loadMcpConfigMultiScope();

      const example = servers.find((server) => server.name === "example");
      const helper = servers.find((server) => server.name === "helper");

      assertEquals(example?.command, [
        "bun",
        "run",
        `${officialPluginRoot}/server.ts`,
      ]);
      assertEquals(example?.env?.CLAUDE_PLUGIN_ROOT, officialPluginRoot);
      assertEquals(
        example?.env?.CLAUDE_PLUGIN_DATA,
        platform.path.join(
          platform.path.dirname(platform.path.dirname(marketplaceRoot)),
          "data",
          "example-plugin-claude-plugins-official",
        ),
      );
      assertEquals(helper?.url, "https://mcp.example.test");
    } finally {
      setClaudeCodeMcpDirForTests(externalPluginsDir);
    }
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

Deno.test("McpConfig: loadMcpConfig expands MCP env vars and preserves missing placeholders", async () => {
  await withTempHlvmDir(async () => {
    const platform = getPlatform();
    const originalToken = platform.env.get("MCP_TEST_TOKEN");
    const originalMissing = platform.env.get("MCP_TEST_MISSING");
    try {
      platform.env.set("MCP_TEST_TOKEN", "token-123");
      platform.env.delete("MCP_TEST_MISSING");
      await platform.fs.mkdir(platform.path.dirname(getMcpConfigPath()), {
        recursive: true,
      });
      await platform.fs.writeTextFile(
        getMcpConfigPath(),
        JSON.stringify({
          version: 1,
          servers: [{
            name: "expanded",
            command: ["node", "${MCP_TEST_TOKEN}"],
            cwd: "/tmp/${MCP_TEST_TOKEN}",
            env: {
              TOKEN: "${MCP_TEST_TOKEN}",
              STILL_MISSING: "${MCP_TEST_MISSING}",
            },
            headers: {
              Authorization: "Bearer ${MCP_TEST_TOKEN}",
            },
          }],
        }),
      );

      const config = await loadMcpConfig();
      assertEquals(config?.servers, [{
        name: "expanded",
        command: ["node", "token-123"],
        cwd: "/tmp/token-123",
        env: {
          TOKEN: "token-123",
          STILL_MISSING: "${MCP_TEST_MISSING}",
        },
        headers: {
          Authorization: "Bearer token-123",
        },
      }]);
    } finally {
      if (originalToken === undefined) {
        platform.env.delete("MCP_TEST_TOKEN");
      } else {
        platform.env.set("MCP_TEST_TOKEN", originalToken);
      }
      if (originalMissing === undefined) {
        platform.env.delete("MCP_TEST_MISSING");
      } else {
        platform.env.set("MCP_TEST_MISSING", originalMissing);
      }
    }
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
  const sse = formatServerEntry({
    name: "remote",
    url: "https://mcp.example.test/sse",
    transport: "sse",
    scope: "user",
  });

  assertEquals(user.scopeLabel, "user");
  assertEquals(user.transport, "stdio");
  assertEquals(claudeCode.scopeLabel, "Claude Code");
  assertEquals(sse.transport, "sse");
});
