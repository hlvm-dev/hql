import {
  assertEquals,
  assertRejects,
  assertStringIncludes,
} from "jsr:@std/assert";
import { ValidationError } from "../../../src/common/error.ts";
import { mcpCommand } from "../../../src/hlvm/cli/commands/mcp.ts";
import { __testOnlyWaitForStaleFallbackHostSweep } from "../../../src/hlvm/runtime/host-client.ts";
import { getPlatform } from "../../../src/platform/platform.ts";
import { withCapturedOutput, withRuntimeHostServer } from "../../shared/light-helpers.ts";

async function withInteractiveTerminal(
  fn: () => Promise<void>,
): Promise<void> {
  const stdin = getPlatform().terminal.stdin as { isTerminal: () => boolean };
  const originalIsTerminal = stdin.isTerminal;
  stdin.isTerminal = () => true;
  try {
    await fn();
  } finally {
    stdin.isTerminal = originalIsTerminal;
  }
}

Deno.test("mcp command routes add/list/remove through the runtime host", async () => {
  let addBody: Record<string, unknown> | null = null;
  let removeBody: Record<string, unknown> | null = null;

  await withRuntimeHostServer(async (req) => {
    const url = new URL(req.url);

    if (url.pathname === "/api/mcp/servers" && req.method === "POST") {
      addBody = await req.json() as Record<string, unknown>;
      return Response.json({ ok: true });
    }

    if (url.pathname === "/api/mcp/servers" && req.method === "GET") {
      return Response.json({
        servers: [{
          name: "github",
          command: ["npx", "-y", "@modelcontextprotocol/server-github"],
          scope: "user",
          transport: "stdio",
          target: "npx -y @modelcontextprotocol/server-github",
          status: "✓ Connected",
          scopeLabel: "user",
          scopeDescription: "User config (available in all your projects)",
        }],
      });
    }

    if (url.pathname === "/api/mcp/servers" && req.method === "DELETE") {
      removeBody = await req.json() as Record<string, unknown>;
      return Response.json({ removed: true });
    }

    return new Response("Not found", { status: 404 });
  }, async () => {
    await withCapturedOutput(async (output) => {
      await mcpCommand([
        "add",
        "github",
        "--",
        "npx",
        "-y",
        "@modelcontextprotocol/server-github",
      ]);
      await mcpCommand(["list"]);
      await mcpCommand(["remove", "github"]);

      assertEquals(addBody?.server !== undefined, true);
      assertEquals(removeBody?.name, "github");
      assertStringIncludes(
        output(),
        "Added stdio MCP server github with command: npx -y @modelcontextprotocol/server-github to user config",
      );
      assertStringIncludes(output(), "File modified: /Users/seoksoonjang/.hlvm/mcp.json");
      assertStringIncludes(output(), "Checking MCP server health...");
      assertStringIncludes(
        output(),
        "github: npx -y @modelcontextprotocol/server-github - ✓ Connected",
      );
      assertStringIncludes(
        output(),
        'Removed MCP server "github" from user config',
      );
      await __testOnlyWaitForStaleFallbackHostSweep();
    });
  });
});

Deno.test("mcp command routes login/logout through the runtime host", async () => {
  let _loginBody: Record<string, unknown> | null = null;
  let logoutBody: Record<string, unknown> | null = null;

  await withRuntimeHostServer(async (req) => {
    const url = new URL(req.url);

    if (url.pathname === "/api/mcp/oauth/login") {
      _loginBody = await req.json() as Record<string, unknown>;
      return Response.json({
        serverName: "github",
        messages: [
          "Open this URL to authorize MCP server 'github':",
          "OAuth login complete for MCP server 'github'.",
        ],
      });
    }

    if (url.pathname === "/api/mcp/oauth/logout") {
      logoutBody = await req.json() as Record<string, unknown>;
      return Response.json({
        serverName: "github",
        messages: [],
        removed: true,
      });
    }

    return new Response("Not found", { status: 404 });
  }, async () => {
    await withInteractiveTerminal(async () => {
      await withCapturedOutput(async (output) => {
        await mcpCommand(["login", "github"]);
        await mcpCommand(["logout", "github"]);

        assertEquals(logoutBody?.name, "github");
        assertStringIncludes(
          output(),
          "Open this URL to authorize MCP server 'github':",
        );
        assertStringIncludes(
          output(),
          "OAuth login complete for MCP server 'github'.",
        );
        assertStringIncludes(
          output(),
          'Removed OAuth token for MCP server "github"',
        );
        await __testOnlyWaitForStaleFallbackHostSweep();
      });
    });
  });
});

Deno.test("mcp add --help shows add-specific help instead of top-level help", async () => {
  await withCapturedOutput(async (output) => {
    await mcpCommand(["add", "--help"]);

    assertStringIncludes(output(), "Add an MCP server to HLVM.");
    assertStringIncludes(
      output(),
      "Usage: hlvm mcp add <name> <commandOrUrl> [args...] [options]",
    );
    assertEquals(
      output().includes("Usage: hlvm mcp <command> [options]"),
      false,
    );
  });
});

Deno.test("mcp add-json rejects URL-only configs like Claude Code", async () => {
  await assertRejects(
    () => mcpCommand([
      "add-json",
      "demo-http",
      '{"url":"https://foo.test/mcp"}',
    ]),
    ValidationError,
    "Invalid configuration: : Invalid input",
  );
});

Deno.test("mcp add-json strips remote env and keeps remote transport fields", async () => {
  let addBody: Record<string, unknown> | null = null;

  await withRuntimeHostServer(async (req) => {
    const url = new URL(req.url);
    if (url.pathname === "/api/mcp/servers" && req.method === "POST") {
      addBody = await req.json() as Record<string, unknown>;
      return Response.json({ ok: true });
    }
    return new Response("Not found", { status: 404 });
  }, async () => {
    await withCapturedOutput(async (output) => {
      await mcpCommand([
        "add-json",
        "demo-http",
        '{"type":"http","url":"https://foo.test/mcp","env":{"TOKEN":"secret"},"headers":{"X-Key":"abc"},"oauth":{"clientId":"cid","callbackPort":4317}}',
      ]);

      assertEquals(addBody?.server, {
        name: "demo-http",
        transport: "http",
        url: "https://foo.test/mcp",
        headers: { "X-Key": "abc" },
        oauth: { clientId: "cid", callbackPort: 4317 },
      });
      assertStringIncludes(
        output(),
        "Added http MCP server demo-http to user config",
      );
      await __testOnlyWaitForStaleFallbackHostSweep();
    });
  });
});

Deno.test("mcp add ignores invalid callback-port values like Claude Code", async () => {
  let addBody: Record<string, unknown> | null = null;

  await withRuntimeHostServer(async (req) => {
    const url = new URL(req.url);
    if (url.pathname === "/api/mcp/servers" && req.method === "POST") {
      addBody = await req.json() as Record<string, unknown>;
      return Response.json({ ok: true });
    }
    return new Response("Not found", { status: 404 });
  }, async () => {
    await withCapturedOutput(async () => {
      await mcpCommand([
        "add",
        "--transport",
        "http",
        "--client-id",
        "cid",
        "--callback-port",
        "not-a-number",
        "demo-http",
        "https://foo.test/mcp",
      ]);

      assertEquals(addBody?.server, {
        name: "demo-http",
        url: "https://foo.test/mcp",
        transport: "http",
        oauth: { clientId: "cid" },
      });
      await __testOnlyWaitForStaleFallbackHostSweep();
    });
  });
});
