import { assertEquals, assertStringIncludes } from "jsr:@std/assert";
import { log } from "../../../src/hlvm/api/log.ts";
import { mcpCommand } from "../../../src/hlvm/cli/commands/mcp.ts";
import { getPlatform } from "../../../src/platform/platform.ts";
import { withRuntimeHostServer } from "../../shared/light-helpers.ts";

async function withCapturedOutput(
  fn: (output: () => string) => Promise<void>,
): Promise<void> {
  const raw = log.raw as { log: (text: string) => void };
  const originalLog = raw.log;
  let output = "";

  raw.log = (text: string) => {
    output += text + (text.endsWith("\n") ? "" : "\n");
  };

  try {
    await fn(() => output);
  } finally {
    raw.log = originalLog;
  }
}

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
          scopeLabel: "user",
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
        'Added MCP server "github" (global, stdio)',
      );
      assertStringIncludes(output(), "MCP Servers:");
      assertStringIncludes(output(), "github");
      assertStringIncludes(
        output(),
        'Removed MCP server "github" from global scope',
      );
    });
  });
});

Deno.test("mcp command routes login/logout through the runtime host", async () => {
  let loginBody: Record<string, unknown> | null = null;
  let logoutBody: Record<string, unknown> | null = null;

  await withRuntimeHostServer(async (req) => {
    const url = new URL(req.url);

    if (url.pathname === "/api/mcp/oauth/login") {
      loginBody = await req.json() as Record<string, unknown>;
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
      });
    });
  });
});
