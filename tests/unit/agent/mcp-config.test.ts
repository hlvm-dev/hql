import { assertEquals } from "jsr:@std/assert@1";
import {
  getClaudeCodeMcpDir,
  getMcpConfigPath,
  setClaudeCodeMcpDirForTests,
  setCodexConfigPathForTests,
  setCursorMcpPathForTests,
  setGeminiSettingsPathForTests,
  setWindsurfLegacyMcpPathForTests,
  setWindsurfMcpPathForTests,
  setZedSettingsPathForTests,
} from "../../../src/common/paths.ts";
import {
  addServerToConfig,
  dedupeServers,
  findMcpServersForExactToolName,
  formatServerEntry,
  loadMcpConfig,
  loadMcpConfigMultiScope,
  normalizeServerName,
  parseClaudeCodeMcpJson,
  rankMcpServersForQuery,
  removeServerFromConfig,
} from "../../../src/hlvm/agent/mcp/config.ts";
import { getPlatform } from "../../../src/platform/platform.ts";
import { withTempHlvmDir } from "../helpers.ts";

async function writeJson(path: string, value: unknown): Promise<void> {
  const platform = getPlatform();
  await platform.fs.mkdir(platform.path.dirname(path), { recursive: true });
  await platform.fs.writeTextFile(path, JSON.stringify(value, null, 2));
}

async function writeText(path: string, text: string): Promise<void> {
  const platform = getPlatform();
  await platform.fs.mkdir(platform.path.dirname(path), { recursive: true });
  await platform.fs.writeTextFile(path, text);
}

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

Deno.test("McpConfig: MCP server catalog ranking and exact tool resolution stay targeted", () => {
  const servers = [
    { name: "context", command: ["npx", "@example/context-mcp"] },
    { name: "context7", command: ["npx", "@upstash/context7-mcp"] },
    { name: "playwright", command: ["npx", "@playwright/mcp@latest"] },
  ];

  assertEquals(
    rankMcpServersForQuery(servers, "playwright screenshot").map((server) =>
      server.name
    ),
    ["playwright"],
  );
  assertEquals(
    findMcpServersForExactToolName(
      servers,
      "mcp_context7_get_library_docs",
    ).map((server) => server.name),
    ["context7"],
  );
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

Deno.test("McpConfig: loadMcpConfigMultiScope imports Cursor, Windsurf, Zed, Codex, Gemini", async () => {
  await withTempHlvmDir(async () => {
    const platform = getPlatform();
    const tempRoot = await platform.fs.makeTempDir({
      prefix: "hlvm-test-crosstool-",
    });

    const cursorPath = platform.path.join(tempRoot, "cursor", "mcp.json");
    const windsurfPath = platform.path.join(
      tempRoot,
      "windsurf",
      "mcp_config.json",
    );
    const zedPath = platform.path.join(tempRoot, "zed", "settings.json");
    const codexPath = platform.path.join(tempRoot, "codex", "config.toml");
    const geminiPath = platform.path.join(tempRoot, "gemini", "settings.json");
    const emptyCcDir = platform.path.join(tempRoot, "cc-empty");
    await platform.fs.mkdir(emptyCcDir, { recursive: true });

    await writeJson(cursorPath, {
      mcpServers: {
        "cursor-only": {
          command: "npx",
          args: ["-y", "cursor-server"],
          cwd: "/tmp/cursor",
        },
      },
    });
    await writeJson(windsurfPath, {
      mcpServers: {
        "windsurf-only": {
          type: "streamableHttp",
          serverUrl: "https://mcp.windsurf.test/mcp",
          headers: {
            Authorization: "Bearer test",
          },
          timeout: 30000,
        },
      },
    });
    await writeJson(zedPath, {
      context_servers: {
        "zed-only": {
          command: {
            path: "node",
            args: ["server.js"],
            env: {
              ZED_TOKEN: "nested",
            },
          },
        },
        "zed-flat": {
          command: "uvx",
          args: ["zed-flat-server"],
          env: {
            ZED_FLAT: "1",
          },
        },
      },
    });
    await writeText(
      codexPath,
      [
        "[mcp_servers.codex-only]",
        'command = "uvx"',
        'args = ["codex-mcp"]',
        "",
        "[mcp_servers.codex-only.env]",
        'TOKEN = "abc"',
        "",
      ].join("\n"),
    );
    await writeJson(geminiPath, {
      mcpServers: {
        "gemini-only": {
          command: "python",
          args: ["-m", "gemini_mcp"],
          cwd: "./tools",
          timeout: 15000,
        },
      },
    });

    setCursorMcpPathForTests(cursorPath);
    setWindsurfMcpPathForTests(windsurfPath);
    setZedSettingsPathForTests(zedPath);
    setCodexConfigPathForTests(codexPath);
    setGeminiSettingsPathForTests(geminiPath);
    setClaudeCodeMcpDirForTests(emptyCcDir);

    try {
      const servers = await loadMcpConfigMultiScope();
      const byName = Object.fromEntries(servers.map((s) => [s.name, s]));

      assertEquals(byName["cursor-only"]?.scope, "cursor");
      assertEquals(byName["cursor-only"]?.command, [
        "npx",
        "-y",
        "cursor-server",
      ]);
      assertEquals(byName["cursor-only"]?.cwd, "/tmp/cursor");

      assertEquals(byName["windsurf-only"]?.scope, "windsurf");
      assertEquals(
        byName["windsurf-only"]?.url,
        "https://mcp.windsurf.test/mcp",
      );
      assertEquals(byName["windsurf-only"]?.headers, {
        Authorization: "Bearer test",
      });
      assertEquals(byName["windsurf-only"]?.connection_timeout_ms, 30000);
      assertEquals(byName["windsurf-only"]?.transport, "http");

      assertEquals(byName["zed-only"]?.scope, "zed");
      assertEquals(byName["zed-only"]?.command, ["node", "server.js"]);
      assertEquals(byName["zed-only"]?.env, { ZED_TOKEN: "nested" });

      assertEquals(byName["zed-flat"]?.scope, "zed");
      assertEquals(byName["zed-flat"]?.command, ["uvx", "zed-flat-server"]);
      assertEquals(byName["zed-flat"]?.env, { ZED_FLAT: "1" });

      assertEquals(byName["codex-only"]?.scope, "codex");
      assertEquals(byName["codex-only"]?.command, ["uvx", "codex-mcp"]);
      assertEquals(byName["codex-only"]?.env, { TOKEN: "abc" });

      assertEquals(byName["gemini-only"]?.scope, "gemini");
      assertEquals(byName["gemini-only"]?.command, [
        "python",
        "-m",
        "gemini_mcp",
      ]);
      assertEquals(byName["gemini-only"]?.cwd, "./tools");
      assertEquals(byName["gemini-only"]?.connection_timeout_ms, 15000);
    } finally {
      setCursorMcpPathForTests(null);
      setWindsurfMcpPathForTests(null);
      setZedSettingsPathForTests(null);
      setCodexConfigPathForTests(null);
      setGeminiSettingsPathForTests(null);
      setClaudeCodeMcpDirForTests(getClaudeCodeMcpDir());
      await platform.fs.remove(tempRoot, { recursive: true });
    }
  });
});

Deno.test("McpConfig: loadMcpConfigMultiScope accepts Windsurf legacy config path", async () => {
  await withTempHlvmDir(async () => {
    const platform = getPlatform();
    const tempRoot = await platform.fs.makeTempDir({
      prefix: "hlvm-test-windsurf-legacy-",
    });

    const missingPrimaryPath = platform.path.join(
      tempRoot,
      "windsurf",
      "missing-mcp_config.json",
    );
    const legacyPath = platform.path.join(
      tempRoot,
      "legacy",
      "mcp_config.json",
    );
    const emptyCcDir = platform.path.join(tempRoot, "cc-empty");
    await platform.fs.mkdir(emptyCcDir, { recursive: true });

    await writeJson(legacyPath, {
      mcpServers: {
        "windsurf-legacy": {
          command: "node",
          args: ["legacy.js"],
        },
      },
    });

    setWindsurfMcpPathForTests(missingPrimaryPath);
    setWindsurfLegacyMcpPathForTests(legacyPath);
    setClaudeCodeMcpDirForTests(emptyCcDir);

    try {
      const servers = await loadMcpConfigMultiScope();
      const byName = Object.fromEntries(servers.map((s) => [s.name, s]));

      assertEquals(byName["windsurf-legacy"]?.scope, "windsurf");
      assertEquals(byName["windsurf-legacy"]?.command, ["node", "legacy.js"]);
    } finally {
      setWindsurfMcpPathForTests(null);
      setWindsurfLegacyMcpPathForTests(null);
      setClaudeCodeMcpDirForTests(getClaudeCodeMcpDir());
      await platform.fs.remove(tempRoot, { recursive: true });
    }
  });
});

Deno.test("McpConfig: multi-scope priority — user wins over Cursor wins over Claude Code", async () => {
  await withTempHlvmDir(async () => {
    const platform = getPlatform();
    const tempRoot = await platform.fs.makeTempDir({
      prefix: "hlvm-test-priority-",
    });

    const cursorPath = platform.path.join(tempRoot, "cursor", "mcp.json");
    const ccDir = platform.path.join(tempRoot, "marketplaces");
    const ccPluginDir = platform.path.join(
      ccDir,
      "official",
      "plugins",
      "shared-plugin",
    );

    await writeJson(getMcpConfigPath(), {
      version: 1,
      servers: [{
        name: "shared",
        command: ["node", "user-wins.js"],
      }],
    });
    await writeJson(cursorPath, {
      mcpServers: {
        shared: {
          command: "node",
          args: ["cursor-loses.js"],
        },
        "cursor-only": {
          command: "node",
          args: ["cursor.js"],
        },
      },
    });
    await writeJson(
      platform.path.join(ccPluginDir, ".mcp.json"),
      {
        shared: {
          command: "node",
          args: ["cc-loses.js"],
        },
      },
    );

    setCursorMcpPathForTests(cursorPath);
    setClaudeCodeMcpDirForTests(ccDir);

    try {
      const servers = await loadMcpConfigMultiScope();
      const byName = Object.fromEntries(servers.map((s) => [s.name, s]));

      assertEquals(byName["shared"]?.scope, "user");
      assertEquals(byName["shared"]?.command, ["node", "user-wins.js"]);
      assertEquals(byName["cursor-only"]?.scope, "cursor");
    } finally {
      setCursorMcpPathForTests(null);
      setClaudeCodeMcpDirForTests(getClaudeCodeMcpDir());
      await platform.fs.remove(tempRoot, { recursive: true });
    }
  });
});

Deno.test("McpConfig: missing or malformed cross-tool configs are skipped silently", async () => {
  await withTempHlvmDir(async () => {
    const platform = getPlatform();
    const tempRoot = await platform.fs.makeTempDir({
      prefix: "hlvm-test-malformed-",
    });

    const cursorPath = platform.path.join(tempRoot, "cursor", "mcp.json");
    const zedPath = platform.path.join(tempRoot, "zed", "settings.json");
    const codexPath = platform.path.join(tempRoot, "codex", "config.toml");
    const missingWindsurf = platform.path.join(
      tempRoot,
      "windsurf",
      "does-not-exist.json",
    );
    const missingGemini = platform.path.join(
      tempRoot,
      "gemini",
      "does-not-exist.json",
    );
    const emptyCcDir = platform.path.join(tempRoot, "cc-empty");
    await platform.fs.mkdir(emptyCcDir, { recursive: true });

    await writeText(cursorPath, "this is not json");
    await writeJson(zedPath, { unrelated: true });
    await writeText(codexPath, "this = is = not = toml");

    setCursorMcpPathForTests(cursorPath);
    setWindsurfMcpPathForTests(missingWindsurf);
    setZedSettingsPathForTests(zedPath);
    setCodexConfigPathForTests(codexPath);
    setGeminiSettingsPathForTests(missingGemini);
    setClaudeCodeMcpDirForTests(emptyCcDir);

    try {
      const servers = await loadMcpConfigMultiScope();
      assertEquals(servers, []);
    } finally {
      setCursorMcpPathForTests(null);
      setWindsurfMcpPathForTests(null);
      setZedSettingsPathForTests(null);
      setCodexConfigPathForTests(null);
      setGeminiSettingsPathForTests(null);
      setClaudeCodeMcpDirForTests(getClaudeCodeMcpDir());
      await platform.fs.remove(tempRoot, { recursive: true });
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
