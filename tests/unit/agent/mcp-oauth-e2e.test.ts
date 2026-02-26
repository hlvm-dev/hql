/**
 * E2E MCP OAuth Integration Test
 *
 * Proves the full flow: metadata discovery → client registration → PKCE login
 * → authenticated MCP tool call → token refresh → 401 recovery → logout.
 *
 * Uses a single Deno.serve() HTTP server that handles both OAuth endpoints
 * and MCP JSON-RPC protocol with Bearer auth middleware.
 */

import { assertEquals, assertNotEquals } from "jsr:@std/assert";
import { getPlatform } from "../../../src/platform/platform.ts";
import {
  getMcpOAuthAuthorizationHeader,
  loginMcpHttpServer,
  logoutMcpHttpServer,
  recoverMcpOAuthFromUnauthorized,
} from "../../../src/hlvm/agent/mcp/oauth.ts";
import { SdkMcpClient } from "../../../src/hlvm/agent/mcp/sdk-client.ts";
import type { McpServerConfig } from "../../../src/hlvm/agent/mcp/types.ts";

// ============================================================
// Server Setup
// ============================================================

interface McpOAuthServerState {
  port: number;
  server: Deno.HttpServer;
  validTokens: Set<string>;
  tokenCounter: number;
}

async function startMcpOAuthServer(
  opts: { initialExpiresIn?: number } = {},
): Promise<McpOAuthServerState> {
  const state: McpOAuthServerState = {
    port: 0,
    server: null as unknown as Deno.HttpServer,
    validTokens: new Set(),
    tokenCounter: 0,
  };

  const { promise: listening, resolve: onListening } = Promise.withResolvers<
    void
  >();

  function issueToken(): string {
    state.tokenCounter++;
    const token = `token-${state.tokenCounter}`;
    state.validTokens.add(token);
    return token;
  }

  const server = Deno.serve(
    {
      port: 0,
      hostname: "127.0.0.1",
      onListen({ port }) {
        state.port = port;
        onListening();
      },
    },
    async (req) => {
      const url = new URL(req.url);

      // --- OAuth Endpoints ---

      // Protected Resource Metadata (RFC 9728)
      // SDK tries path-aware first: /.well-known/oauth-protected-resource/mcp → 404
      // Then falls back to root: /.well-known/oauth-protected-resource → 200
      if (url.pathname === "/.well-known/oauth-protected-resource") {
        return Response.json({
          authorization_servers: [`http://127.0.0.1:${state.port}/auth`],
          scopes_supported: ["offline_access"],
          resource: `http://127.0.0.1:${state.port}`,
        });
      }

      // Authorization Server Metadata (RFC 8414)
      // SDK constructs: /.well-known/oauth-authorization-server/auth
      if (url.pathname === "/.well-known/oauth-authorization-server/auth") {
        return Response.json({
          issuer: `http://127.0.0.1:${state.port}/auth`,
          authorization_endpoint:
            `http://127.0.0.1:${state.port}/oauth/authorize`,
          token_endpoint: `http://127.0.0.1:${state.port}/oauth/token`,
          registration_endpoint:
            `http://127.0.0.1:${state.port}/oauth/register`,
          response_types_supported: ["code"],
          code_challenge_methods_supported: ["S256"],
        });
      }

      // Dynamic Client Registration
      if (url.pathname === "/oauth/register") {
        const body = await req.json();
        return Response.json({
          client_id: "e2e-test-client",
          redirect_uris: body.redirect_uris ?? [
            "http://127.0.0.1:35017/hlvm/oauth/callback",
          ],
        });
      }

      // Token Endpoint
      if (url.pathname === "/oauth/token") {
        const body = await req.text();
        const params = new URLSearchParams(body);
        const grantType = params.get("grant_type");

        if (
          grantType === "authorization_code" ||
          grantType === "refresh_token"
        ) {
          const accessToken = issueToken();
          return Response.json({
            access_token: accessToken,
            refresh_token: `refresh-${state.tokenCounter}`,
            token_type: "bearer",
            expires_in: grantType === "authorization_code"
              ? (opts.initialExpiresIn ?? 3600)
              : 3600,
          });
        }

        return Response.json({ error: "unsupported_grant_type" }, {
          status: 400,
        });
      }

      // --- MCP Endpoint (Bearer auth required) ---

      if (url.pathname === "/mcp") {
        if (req.method === "DELETE") {
          return new Response(null, { status: 200 });
        }
        if (req.method !== "POST") {
          return new Response("Method Not Allowed", { status: 405 });
        }

        // Bearer auth check
        const authHeader = req.headers.get("authorization");
        const token = authHeader?.startsWith("Bearer ")
          ? authHeader.slice(7)
          : null;

        if (!token || !state.validTokens.has(token)) {
          return new Response(
            JSON.stringify({ error: "unauthorized" }),
            {
              status: 401,
              headers: {
                "Content-Type": "application/json",
                "WWW-Authenticate":
                  `Bearer error="invalid_token", resource_metadata="http://127.0.0.1:${state.port}/.well-known/oauth-protected-resource"`,
              },
            },
          );
        }

        // JSON-RPC handler
        const body = await req.json();
        const response = handleJsonRpc(body);
        if (response === null) {
          // Notification — no id, no response body
          return new Response(null, { status: 204 });
        }
        return Response.json(response);
      }

      return new Response("Not Found", { status: 404 });
    },
  );

  state.server = server;
  await listening;
  return state;
}

// deno-lint-ignore no-explicit-any
function handleJsonRpc(body: any): any {
  const { method, id, params } = body;

  // Notifications have no id — return null to signal 204
  if (id === undefined || id === null) return null;

  switch (method) {
    case "initialize":
      return {
        jsonrpc: "2.0",
        id,
        result: {
          protocolVersion: "2025-03-26",
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: "mcp-oauth-e2e", version: "1.0.0" },
        },
      };

    case "tools/list":
      return {
        jsonrpc: "2.0",
        id,
        result: {
          tools: [{
            name: "echo",
            description: "Echoes the message back",
            inputSchema: {
              type: "object",
              properties: { message: { type: "string" } },
              required: ["message"],
            },
          }],
        },
      };

    case "tools/call": {
      const toolName = params?.name;
      if (toolName === "echo") {
        const msg = params?.arguments?.message ?? "";
        return {
          jsonrpc: "2.0",
          id,
          result: { content: [{ type: "text", text: `echo: ${msg}` }] },
        };
      }
      return {
        jsonrpc: "2.0",
        id,
        error: { code: -32602, message: `Unknown tool: ${toolName}` },
      };
    }

    case "ping":
      return { jsonrpc: "2.0", id, result: {} };

    default:
      return {
        jsonrpc: "2.0",
        id,
        error: { code: -32601, message: `Method not found: ${method}` },
      };
  }
}

// ============================================================
// Helpers
// ============================================================

async function withOauthStorePath<T>(
  fn: (storePath: string) => Promise<T>,
): Promise<T> {
  const platform = getPlatform();
  const previous = platform.env.get("HLVM_MCP_OAUTH_PATH");
  const dir = await Deno.makeTempDir({ prefix: "hlvm-mcp-oauth-e2e-" });
  const path = platform.path.join(dir, "mcp-oauth.json");
  platform.env.set("HLVM_MCP_OAUTH_PATH", path);
  try {
    return await fn(path);
  } finally {
    platform.env.set("HLVM_MCP_OAUTH_PATH", previous ?? "");
    await platform.fs.remove(dir, { recursive: true });
  }
}

/** Login helper — captures auth URL and injects callback with state */
async function doLogin(server: McpServerConfig): Promise<void> {
  let authUrl = "";
  await loginMcpHttpServer(server, {
    output: () => {},
    openBrowser: async (url) => {
      authUrl = url;
    },
    promptInput: async () => {
      const state = new URL(authUrl).searchParams.get("state") ?? "";
      return `http://127.0.0.1:35017/hlvm/oauth/callback?code=e2e-code&state=${
        encodeURIComponent(state)
      }`;
    },
  });
}

/** Create an authenticated SdkMcpClient, call echo, return result text */
async function callEcho(
  serverConfig: McpServerConfig,
  message: string,
): Promise<string> {
  const header = await getMcpOAuthAuthorizationHeader(serverConfig);
  assertNotEquals(header, null, "Expected valid auth header");

  const client = new SdkMcpClient({
    ...serverConfig,
    headers: { ...serverConfig.headers, Authorization: header! },
  });
  try {
    await client.start();
    const result = await client.callTool("echo", { message });
    // deno-lint-ignore no-explicit-any
    const content = (result as any).content;
    assertEquals(Array.isArray(content), true);
    return content[0]?.text ?? "";
  } finally {
    await client.close();
  }
}

// ============================================================
// Tests
// ============================================================

Deno.test({
  name: "MCP OAuth E2E: full login → authenticated tool call",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    await withOauthStorePath(async () => {
      const srv = await startMcpOAuthServer();
      const serverConfig: McpServerConfig = {
        name: "e2e-test",
        url: `http://127.0.0.1:${srv.port}/mcp`,
      };

      // Login via OAuth flow
      await doLogin(serverConfig);

      // Verify we got a valid auth header
      const header = await getMcpOAuthAuthorizationHeader(serverConfig);
      assertEquals(typeof header, "string");
      assertEquals(header!.startsWith("Bearer "), true);

      // Make authenticated MCP tool call
      const result = await callEcho(serverConfig, "hello world");
      assertEquals(result, "echo: hello world");

      // Verify token was issued (counter incremented)
      assertEquals(srv.tokenCounter >= 1, true);

      await srv.server.shutdown();
    });
  },
});

Deno.test({
  name: "MCP OAuth E2E: token refresh on expiry",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    await withOauthStorePath(async () => {
      // Token expires immediately (0 seconds)
      const srv = await startMcpOAuthServer({ initialExpiresIn: 0 });
      const serverConfig: McpServerConfig = {
        name: "e2e-refresh",
        url: `http://127.0.0.1:${srv.port}/mcp`,
      };

      await doLogin(serverConfig);
      const initialCount = srv.tokenCounter;

      // getMcpOAuthAuthorizationHeader should auto-refresh the expired token
      const header = await getMcpOAuthAuthorizationHeader(serverConfig);
      assertEquals(typeof header, "string");

      // Token counter should have incremented (refresh issued a new token)
      assertEquals(srv.tokenCounter > initialCount, true);

      // The refreshed token should work for MCP calls
      const result = await callEcho(serverConfig, "refreshed");
      assertEquals(result, "echo: refreshed");

      await srv.server.shutdown();
    });
  },
});

Deno.test({
  name: "MCP OAuth E2E: 401 recovery via refresh token",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    await withOauthStorePath(async () => {
      const srv = await startMcpOAuthServer({ initialExpiresIn: 3600 });
      const serverConfig: McpServerConfig = {
        name: "e2e-recover",
        url: `http://127.0.0.1:${srv.port}/mcp`,
      };

      await doLogin(serverConfig);

      // Verify initial call works
      const result1 = await callEcho(serverConfig, "before");
      assertEquals(result1, "echo: before");

      // Invalidate all tokens (simulates server-side revocation)
      srv.validTokens.clear();

      // Attempt a call with the now-invalid token — should fail with 401
      const header = await getMcpOAuthAuthorizationHeader(serverConfig);
      const failClient = new SdkMcpClient({
        ...serverConfig,
        headers: { Authorization: header! },
      });
      let got401 = false;
      try {
        await failClient.start();
      } catch {
        // StreamableHTTPClientTransport throws on 401 during init
        got401 = true;
      } finally {
        await failClient.close();
      }
      assertEquals(got401, true, "Expected 401 error from invalidated token");

      // Recover via refresh token
      const recovered = await recoverMcpOAuthFromUnauthorized(
        serverConfig,
        `Bearer error="invalid_token", resource_metadata="http://127.0.0.1:${srv.port}/.well-known/oauth-protected-resource"`,
      );
      assertEquals(recovered, true);

      // New token should work
      const result2 = await callEcho(serverConfig, "after");
      assertEquals(result2, "echo: after");

      await srv.server.shutdown();
    });
  },
});

Deno.test({
  name: "MCP OAuth E2E: logout clears credentials",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    await withOauthStorePath(async () => {
      const srv = await startMcpOAuthServer();
      const serverConfig: McpServerConfig = {
        name: "e2e-logout",
        url: `http://127.0.0.1:${srv.port}/mcp`,
      };

      await doLogin(serverConfig);

      // Verify we have a valid token
      const headerBefore = await getMcpOAuthAuthorizationHeader(serverConfig);
      assertNotEquals(headerBefore, null);

      // Verify tool call works
      const result = await callEcho(serverConfig, "pre-logout");
      assertEquals(result, "echo: pre-logout");

      // Logout
      const removed = await logoutMcpHttpServer(serverConfig);
      assertEquals(removed, true);

      // Credentials should be cleared
      const headerAfter = await getMcpOAuthAuthorizationHeader(serverConfig);
      assertEquals(headerAfter, null);

      // Double-logout returns false
      const removedAgain = await logoutMcpHttpServer(serverConfig);
      assertEquals(removedAgain, false);

      await srv.server.shutdown();
    });
  },
});
