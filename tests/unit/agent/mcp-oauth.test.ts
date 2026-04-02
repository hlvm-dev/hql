import { assertEquals } from "jsr:@std/assert";
import {
  getMcpOAuthAuthorizationHeader,
  loginMcpHttpServer,
  logoutMcpHttpServer,
  parseBearerChallengeHeader,
  recoverMcpOAuthFromUnauthorized,
} from "../../../src/hlvm/agent/mcp/oauth.ts";
import type { PlatformHttpServerHandle } from "../../../src/platform/types.ts";
import {
  serveWithRetry,
  withServePermissionGuard,
  withOAuthStorePath,
} from "./oauth-test-helpers.ts";

interface OAuthServerState {
  port: number;
  server: PlatformHttpServerHandle;
  tokenRequestBodies: string[];
}

async function startOAuthServer(
  options: { initialExpiresIn?: number } = {},
): Promise<OAuthServerState> {
  const state: OAuthServerState = {
    port: 0,
    tokenRequestBodies: [],
    server: null as unknown as PlatformHttpServerHandle,
  };

  const { promise: listening, resolve: onListening } = Promise.withResolvers<
    void
  >();

  const server = await serveWithRetry(
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

      // --- Protected Resource Metadata (RFC 9728) ---
      // SDK tries path-aware first: /.well-known/oauth-protected-resource/mcp → 404
      // Then falls back to root: /.well-known/oauth-protected-resource → 200
      if (url.pathname === "/.well-known/oauth-protected-resource") {
        return new Response(
          JSON.stringify({
            authorization_servers: [`http://127.0.0.1:${state.port}/auth`],
            scopes_supported: ["offline_access"],
            resource: `http://127.0.0.1:${state.port}`,
          }),
          { headers: { "Content-Type": "application/json" } },
        );
      }

      // --- Authorization Server Metadata (RFC 8414) ---
      // SDK constructs: /.well-known/oauth-authorization-server/auth
      if (url.pathname === "/.well-known/oauth-authorization-server/auth") {
        return new Response(
          JSON.stringify({
            issuer: `http://127.0.0.1:${state.port}/auth`,
            authorization_endpoint:
              `http://127.0.0.1:${state.port}/oauth/authorize`,
            token_endpoint: `http://127.0.0.1:${state.port}/oauth/token`,
            registration_endpoint:
              `http://127.0.0.1:${state.port}/oauth/register`,
            response_types_supported: ["code"],
            code_challenge_methods_supported: ["S256"],
          }),
          { headers: { "Content-Type": "application/json" } },
        );
      }

      // --- Dynamic Client Registration ---
      if (url.pathname === "/oauth/register") {
        const body = await req.json();
        return new Response(
          JSON.stringify({
            client_id: "hlvm-test-client",
            redirect_uris: body.redirect_uris ?? [
              "http://127.0.0.1:35017/hlvm/oauth/callback",
            ],
          }),
          { headers: { "Content-Type": "application/json" } },
        );
      }

      // --- Token Endpoint ---
      if (url.pathname === "/oauth/token") {
        const body = await req.text();
        state.tokenRequestBodies.push(body);
        const params = new URLSearchParams(body);
        const grantType = params.get("grant_type");
        if (grantType === "authorization_code") {
          return new Response(
            JSON.stringify({
              access_token: "initial-token",
              refresh_token: "refresh-token-1",
              token_type: "bearer",
              expires_in: options.initialExpiresIn ?? 0,
            }),
            { headers: { "Content-Type": "application/json" } },
          );
        }
        if (grantType === "refresh_token") {
          return new Response(
            JSON.stringify({
              access_token: "refreshed-token",
              refresh_token: "refresh-token-2",
              token_type: "bearer",
              expires_in: 3600,
            }),
            { headers: { "Content-Type": "application/json" } },
          );
        }
        return new Response(
          JSON.stringify({ error: "unsupported_grant_type" }),
          { status: 400, headers: { "Content-Type": "application/json" } },
        );
      }
      return new Response("Not Found", { status: 404 });
    },
  );

  state.server = server;
  await listening;
  return state;
}

async function withOauthStorePath<T>(
  fn: (storePath: string) => Promise<T>,
): Promise<T> {
  return await withOAuthStorePath("hlvm-mcp-oauth-test-", fn);
}

Deno.test("MCP OAuth: parses Bearer challenge parameters", () => {
  const parsed = parseBearerChallengeHeader(
    'Bearer realm="mcp", scope="offline_access", resource_metadata="https://example.com/.well-known/oauth-protected-resource"',
  );
  assertEquals(parsed?.scheme, "Bearer");
  assertEquals(parsed?.params.scope, "offline_access");
  assertEquals(
    parsed?.params.resource_metadata,
    "https://example.com/.well-known/oauth-protected-resource",
  );
});

Deno.test({
  name: "MCP OAuth: login + token refresh + logout",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    await withServePermissionGuard(async () => {
      await withOauthStorePath(async (storePath) => {
        const oauth = await startOAuthServer({ initialExpiresIn: 0 });

        const server = {
          name: "oauth-http",
          url: `http://127.0.0.1:${oauth.port}/mcp`,
        };

        let authUrl = "";
        await loginMcpHttpServer(server, {
          output: () => {},
          storePath,
          openBrowser: (url) => {
            authUrl = url;
            return Promise.resolve();
          },
          promptInput: () => {
            const state = new URL(authUrl).searchParams.get("state") ?? "";
            return Promise.resolve(`http://127.0.0.1:35017/hlvm/oauth/callback?code=abc123&state=${
              encodeURIComponent(state)
            }`);
          },
        });

        const header = await getMcpOAuthAuthorizationHeader(server, { storePath });
        assertEquals(header, "Bearer refreshed-token");
        assertEquals(oauth.tokenRequestBodies.length, 2);
        assertEquals(
          new URLSearchParams(oauth.tokenRequestBodies[0]).get("resource"),
          `http://127.0.0.1:${oauth.port}/`,
        );
        assertEquals(
          new URLSearchParams(oauth.tokenRequestBodies[1]).get("resource"),
          `http://127.0.0.1:${oauth.port}/`,
        );

        const removed = await logoutMcpHttpServer(server, { storePath });
        assertEquals(removed, true);
        assertEquals(
          await getMcpOAuthAuthorizationHeader(server, { storePath }),
          null,
        );

        await oauth.server.shutdown();
      });
    });
  },
});

Deno.test({
  name: "MCP OAuth: recover from 401 via refresh token",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    await withServePermissionGuard(async () => {
      await withOauthStorePath(async (storePath) => {
        const oauth = await startOAuthServer({ initialExpiresIn: 3600 });
        const server = {
          name: "oauth-recover",
          url: `http://127.0.0.1:${oauth.port}/mcp`,
        };

        let authUrl = "";
        await loginMcpHttpServer(server, {
          output: () => {},
          storePath,
          openBrowser: (url) => {
            authUrl = url;
            return Promise.resolve();
          },
          promptInput: () => {
            const state = new URL(authUrl).searchParams.get("state") ?? "";
            return Promise.resolve(`http://127.0.0.1:35017/hlvm/oauth/callback?code=init-code&state=${
              encodeURIComponent(state)
            }`);
          },
        });

        const recovered = await recoverMcpOAuthFromUnauthorized(
          server,
          'Bearer error="invalid_token", resource_metadata="https://example.test/.well-known/oauth-protected-resource"',
          { storePath },
        );
        assertEquals(recovered, true);
        assertEquals(
          await getMcpOAuthAuthorizationHeader(server, { storePath }),
          "Bearer refreshed-token",
        );
        assertEquals(oauth.tokenRequestBodies.length, 2);
        assertEquals(
          new URLSearchParams(oauth.tokenRequestBodies[1]).get("resource"),
          `http://127.0.0.1:${oauth.port}/`,
        );

        await oauth.server.shutdown();
      });
    });
  },
});

Deno.test({
  name: "MCP OAuth: proactive refresh triggers inside the 5 minute skew window",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    await withServePermissionGuard(async () => {
      await withOauthStorePath(async (storePath) => {
        const oauth = await startOAuthServer({ initialExpiresIn: 299 });
        const server = {
          name: "oauth-proactive-refresh",
          url: `http://127.0.0.1:${oauth.port}/mcp`,
        };

        let authUrl = "";
        await loginMcpHttpServer(server, {
          output: () => {},
          storePath,
          openBrowser: (url) => {
            authUrl = url;
            return Promise.resolve();
          },
          promptInput: () => {
            const state = new URL(authUrl).searchParams.get("state") ?? "";
            return Promise.resolve(`http://127.0.0.1:35017/hlvm/oauth/callback?code=abc123&state=${
              encodeURIComponent(state)
            }`);
          },
        });

        const header = await getMcpOAuthAuthorizationHeader(server, { storePath });
        assertEquals(header, "Bearer refreshed-token");
        assertEquals(oauth.tokenRequestBodies.length, 2);

        await oauth.server.shutdown();
      });
    });
  },
});

Deno.test({
  name: "MCP OAuth: tokens outside the 5 minute skew do not refresh early",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    await withServePermissionGuard(async () => {
      await withOauthStorePath(async (storePath) => {
        const oauth = await startOAuthServer({ initialExpiresIn: 301 });
        const server = {
          name: "oauth-no-proactive-refresh",
          url: `http://127.0.0.1:${oauth.port}/mcp`,
        };

        let authUrl = "";
        await loginMcpHttpServer(server, {
          output: () => {},
          storePath,
          openBrowser: (url) => {
            authUrl = url;
            return Promise.resolve();
          },
          promptInput: () => {
            const state = new URL(authUrl).searchParams.get("state") ?? "";
            return Promise.resolve(`http://127.0.0.1:35017/hlvm/oauth/callback?code=abc123&state=${
              encodeURIComponent(state)
            }`);
          },
        });

        const header = await getMcpOAuthAuthorizationHeader(server, { storePath });
        assertEquals(header, "Bearer initial-token");
        assertEquals(oauth.tokenRequestBodies.length, 1);

        await oauth.server.shutdown();
      });
    });
  },
});
