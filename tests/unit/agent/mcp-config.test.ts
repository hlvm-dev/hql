/**
 * Unit tests for Claude Code MCP import feature.
 *
 * Tests parseClaudeCodeMcpJson (pure parsing, no I/O)
 * and formatServerEntry for the new "claude-code" scope.
 */

import { assertEquals } from "jsr:@std/assert@1";
import {
  formatServerEntry,
  parseClaudeCodeMcpJson,
} from "../../../src/hlvm/agent/mcp/config.ts";
import type { McpServerWithScope } from "../../../src/hlvm/agent/mcp/config.ts";

// ============================================================
// parseClaudeCodeMcpJson — Pure parsing tests
// ============================================================

Deno.test("parseClaudeCodeMcpJson - stdio with command+args", () => {
  const json = JSON.stringify({
    playwright: {
      command: "npx",
      args: ["@playwright/mcp@latest"],
    },
  });
  const servers = parseClaudeCodeMcpJson(json, "playwright");
  assertEquals(servers.length, 1);
  assertEquals(servers[0].name, "playwright");
  assertEquals(servers[0].command, ["npx", "@playwright/mcp@latest"]);
  assertEquals(servers[0].url, undefined);
});

Deno.test("parseClaudeCodeMcpJson - HTTP url", () => {
  const json = JSON.stringify({
    github: {
      type: "http",
      url: "https://api.githubcopilot.com/mcp/",
      headers: { Authorization: "Bearer ${GITHUB_PAT}" },
    },
  });
  const servers = parseClaudeCodeMcpJson(json, "github");
  assertEquals(servers.length, 1);
  assertEquals(servers[0].name, "github");
  assertEquals(servers[0].url, "https://api.githubcopilot.com/mcp/");
  assertEquals(servers[0].command, undefined);
});

Deno.test("parseClaudeCodeMcpJson - SSE url", () => {
  const json = JSON.stringify({
    slack: {
      type: "sse",
      url: "https://mcp.slack.com/sse",
    },
  });
  const servers = parseClaudeCodeMcpJson(json, "slack");
  assertEquals(servers.length, 1);
  assertEquals(servers[0].name, "slack");
  assertEquals(servers[0].url, "https://mcp.slack.com/sse");
});

Deno.test("parseClaudeCodeMcpJson - mcpServers wrapper format", () => {
  const json = JSON.stringify({
    mcpServers: {
      stripe: {
        type: "http",
        url: "https://mcp.stripe.com",
      },
    },
  });
  const servers = parseClaudeCodeMcpJson(json, "stripe-dir");
  assertEquals(servers.length, 1);
  assertEquals(servers[0].name, "stripe");
  assertEquals(servers[0].url, "https://mcp.stripe.com");
});

Deno.test("parseClaudeCodeMcpJson - uvx command", () => {
  const json = JSON.stringify({
    serena: {
      command: "uvx",
      args: ["--from", "git+https://github.com/oraios/serena", "serena", "start-mcp-server"],
    },
  });
  const servers = parseClaudeCodeMcpJson(json, "serena");
  assertEquals(servers.length, 1);
  assertEquals(servers[0].name, "serena");
  assertEquals(servers[0].command, [
    "uvx",
    "--from",
    "git+https://github.com/oraios/serena",
    "serena",
    "start-mcp-server",
  ]);
});

Deno.test("parseClaudeCodeMcpJson - env vars preserved", () => {
  const json = JSON.stringify({
    myserver: {
      command: "node",
      args: ["server.js"],
      env: { API_KEY: "secret123", PORT: "8080" },
    },
  });
  const servers = parseClaudeCodeMcpJson(json, "myserver");
  assertEquals(servers.length, 1);
  assertEquals(servers[0].env, { API_KEY: "secret123", PORT: "8080" });
});

Deno.test("parseClaudeCodeMcpJson - invalid JSON returns empty", () => {
  const servers = parseClaudeCodeMcpJson("not json", "test");
  assertEquals(servers, []);
});

Deno.test("parseClaudeCodeMcpJson - empty object returns empty", () => {
  const servers = parseClaudeCodeMcpJson("{}", "test");
  assertEquals(servers, []);
});

Deno.test("parseClaudeCodeMcpJson - missing transport returns empty", () => {
  const json = JSON.stringify({
    broken: { type: "unknown" },
  });
  const servers = parseClaudeCodeMcpJson(json, "broken");
  assertEquals(servers, []);
});

Deno.test("parseClaudeCodeMcpJson - mixed entries", () => {
  const json = JSON.stringify({
    stdio_server: { command: "node", args: ["a.js"] },
    http_server: { url: "https://example.com/mcp" },
    broken: { type: "nope" },
  });
  const servers = parseClaudeCodeMcpJson(json, "mixed");
  assertEquals(servers.length, 2);
  assertEquals(servers[0].name, "stdio_server");
  assertEquals(servers[1].name, "http_server");
});

Deno.test("parseClaudeCodeMcpJson - mcpServers wrapper with multiple servers", () => {
  const json = JSON.stringify({
    mcpServers: {
      a: { command: "node", args: ["a.js"] },
      b: { url: "https://b.com/mcp" },
    },
  });
  const servers = parseClaudeCodeMcpJson(json, "multi");
  assertEquals(servers.length, 2);
  assertEquals(servers[0].name, "a");
  assertEquals(servers[1].name, "b");
});

Deno.test("parseClaudeCodeMcpJson - non-string env values filtered out", () => {
  const json = JSON.stringify({
    myserver: {
      command: "node",
      args: ["server.js"],
      env: { GOOD: "value", BAD: 123, ALSO_BAD: null },
    },
  });
  const servers = parseClaudeCodeMcpJson(json, "myserver");
  assertEquals(servers.length, 1);
  assertEquals(servers[0].env, { GOOD: "value" });
});

// ============================================================
// disabled_tools — parsing tests
// ============================================================

Deno.test("parseClaudeCodeMcpJson - disabled_tools parsed", () => {
  const json = JSON.stringify({
    myserver: {
      command: "node",
      args: ["server.js"],
      disabled_tools: ["dangerous_tool", "another_tool"],
    },
  });
  const servers = parseClaudeCodeMcpJson(json, "myserver");
  assertEquals(servers.length, 1);
  assertEquals(servers[0].disabled_tools, ["dangerous_tool", "another_tool"]);
});

Deno.test("parseClaudeCodeMcpJson - disabled_tools absent returns undefined", () => {
  const json = JSON.stringify({
    myserver: {
      command: "node",
      args: ["server.js"],
    },
  });
  const servers = parseClaudeCodeMcpJson(json, "myserver");
  assertEquals(servers.length, 1);
  assertEquals(servers[0].disabled_tools, undefined);
});

Deno.test("parseClaudeCodeMcpJson - disabled_tools filters non-strings", () => {
  const json = JSON.stringify({
    myserver: {
      command: "node",
      args: ["server.js"],
      disabled_tools: ["valid", 42, null, "also_valid"],
    },
  });
  const servers = parseClaudeCodeMcpJson(json, "myserver");
  assertEquals(servers.length, 1);
  assertEquals(servers[0].disabled_tools, ["valid", "also_valid"]);
});

Deno.test("parseClaudeCodeMcpJson - disabled_tools in mcpServers wrapper", () => {
  const json = JSON.stringify({
    mcpServers: {
      playwright: {
        command: "npx",
        args: ["@playwright/mcp@latest"],
        disabled_tools: ["browser_install"],
      },
    },
  });
  const servers = parseClaudeCodeMcpJson(json, "pw-dir");
  assertEquals(servers.length, 1);
  assertEquals(servers[0].disabled_tools, ["browser_install"]);
});

Deno.test("parseClaudeCodeMcpJson - connection_timeout_ms parsed when valid", () => {
  const json = JSON.stringify({
    myserver: {
      command: "node",
      args: ["server.js"],
      connection_timeout_ms: 1234.8,
    },
  });
  const servers = parseClaudeCodeMcpJson(json, "myserver");
  assertEquals(servers.length, 1);
  assertEquals(servers[0].connection_timeout_ms, 1234);
});

Deno.test("parseClaudeCodeMcpJson - connection_timeout_ms ignored when invalid", () => {
  const json = JSON.stringify({
    myserver: {
      command: "node",
      args: ["server.js"],
      connection_timeout_ms: -1,
    },
  });
  const servers = parseClaudeCodeMcpJson(json, "myserver");
  assertEquals(servers.length, 1);
  assertEquals(servers[0].connection_timeout_ms, undefined);
});

// ============================================================
// formatServerEntry — scope label tests
// ============================================================

Deno.test("formatServerEntry - dotmcp scope", () => {
  const entry = formatServerEntry({
    name: "test",
    command: ["node", "server.js"],
    scope: "dotmcp",
  });
  assertEquals(entry.scopeLabel, ".mcp.json");
  assertEquals(entry.transport, "stdio");
});

Deno.test("formatServerEntry - project scope", () => {
  const entry = formatServerEntry({
    name: "test",
    url: "https://example.com",
    scope: "project",
  });
  assertEquals(entry.scopeLabel, "project");
  assertEquals(entry.transport, "http");
});

Deno.test("formatServerEntry - user scope", () => {
  const entry = formatServerEntry({
    name: "test",
    command: ["npx", "server"],
    scope: "user",
  });
  assertEquals(entry.scopeLabel, "user");
});

Deno.test("formatServerEntry - claude-code scope", () => {
  const entry = formatServerEntry({
    name: "serena",
    command: ["uvx", "--from", "serena", "start-mcp-server"],
    scope: "claude-code",
  });
  assertEquals(entry.scopeLabel, "Claude Code");
  assertEquals(entry.transport, "stdio");
});

