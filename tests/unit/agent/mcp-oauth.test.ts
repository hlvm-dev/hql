import { assertEquals, assertRejects } from "jsr:@std/assert";
import { getPlatform } from "../../../src/platform/platform.ts";
import {
  getMcpOAuthAuthorizationHeader,
  loginMcpHttpServer,
  logoutMcpHttpServer,
  parseBearerChallengeHeader,
  recoverMcpOAuthFromUnauthorized,
} from "../../../src/hlvm/agent/mcp/oauth.ts";
import { HttpTransport } from "../../../src/hlvm/agent/mcp/transport.ts";

interface OAuthServerState {
  port: number;
  server: Deno.HttpServer;
  tokenRequestBodies: string[];
}

function startOAuthServer(
  options: { initialExpiresIn?: number } = {},
): OAuthServerState {
  const state: OAuthServerState = {
    port: 0,
    tokenRequestBodies: [],
    server: null as unknown as Deno.HttpServer,
  };

  const server = Deno.serve(
    {
      port: 0,
      hostname: "127.0.0.1",
      onListen({ port }) {
        state.port = port;
      },
    },
    async (req) => {
      const url = new URL(req.url);
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
      if (url.pathname === "/auth/.well-known/oauth-authorization-server") {
        return new Response(
          JSON.stringify({
            issuer: `http://127.0.0.1:${state.port}/auth`,
            authorization_endpoint:
              `http://127.0.0.1:${state.port}/oauth/authorize`,
            token_endpoint: `http://127.0.0.1:${state.port}/oauth/token`,
            registration_endpoint:
              `http://127.0.0.1:${state.port}/oauth/register`,
            code_challenge_methods_supported: ["S256"],
          }),
          { headers: { "Content-Type": "application/json" } },
        );
      }
      if (url.pathname === "/oauth/register") {
        return new Response(
          JSON.stringify({ client_id: "hlvm-test-client" }),
          { headers: { "Content-Type": "application/json" } },
        );
      }
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
              token_type: "Bearer",
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
              token_type: "Bearer",
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
  return state;
}

async function withOauthStorePath<T>(
  fn: (storePath: string) => Promise<T>,
): Promise<T> {
  const platform = getPlatform();
  const previous = platform.env.get("HLVM_MCP_OAUTH_PATH");
  const dir = await Deno.makeTempDir({ prefix: "hlvm-mcp-oauth-test-" });
  const path = platform.path.join(dir, "mcp-oauth.json");
  platform.env.set("HLVM_MCP_OAUTH_PATH", path);
  try {
    return await fn(path);
  } finally {
    platform.env.set("HLVM_MCP_OAUTH_PATH", previous ?? "");
    await platform.fs.remove(dir, { recursive: true });
  }
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
    await withOauthStorePath(async () => {
      const oauth = startOAuthServer({ initialExpiresIn: 0 });
      await new Promise((r) => setTimeout(r, 50));

      const server = {
        name: "oauth-http",
        url: `http://127.0.0.1:${oauth.port}/mcp`,
      };

      let authUrl = "";
      await loginMcpHttpServer(server, {
        output: () => {},
        openBrowser: async (url) => {
          authUrl = url;
        },
        promptInput: async () => {
          const state = new URL(authUrl).searchParams.get("state") ?? "";
          return `http://127.0.0.1:35017/hlvm/oauth/callback?code=abc123&state=${
            encodeURIComponent(state)
          }`;
        },
      });

      const header = await getMcpOAuthAuthorizationHeader(server);
      assertEquals(header, "Bearer refreshed-token");
      assertEquals(oauth.tokenRequestBodies.length, 2);
      assertEquals(
        new URLSearchParams(oauth.tokenRequestBodies[0]).get("resource"),
        `http://127.0.0.1:${oauth.port}`,
      );
      assertEquals(
        new URLSearchParams(oauth.tokenRequestBodies[1]).get("resource"),
        `http://127.0.0.1:${oauth.port}`,
      );

      const removed = await logoutMcpHttpServer(server);
      assertEquals(removed, true);
      assertEquals(await getMcpOAuthAuthorizationHeader(server), null);

      await oauth.server.shutdown();
    });
  },
});

Deno.test({
  name: "MCP OAuth: recover from 401 via refresh token",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    await withOauthStorePath(async () => {
      const oauth = startOAuthServer({ initialExpiresIn: 3600 });
      await new Promise((r) => setTimeout(r, 50));
      const server = {
        name: "oauth-recover",
        url: `http://127.0.0.1:${oauth.port}/mcp`,
      };

      let authUrl = "";
      await loginMcpHttpServer(server, {
        output: () => {},
        openBrowser: async (url) => {
          authUrl = url;
        },
        promptInput: async () => {
          const state = new URL(authUrl).searchParams.get("state") ?? "";
          return `http://127.0.0.1:35017/hlvm/oauth/callback?code=init-code&state=${
            encodeURIComponent(state)
          }`;
        },
      });

      const recovered = await recoverMcpOAuthFromUnauthorized(
        server,
        'Bearer error="invalid_token", resource_metadata="https://example.test/.well-known/oauth-protected-resource"',
      );
      assertEquals(recovered, true);
      assertEquals(
        await getMcpOAuthAuthorizationHeader(server),
        "Bearer refreshed-token",
      );
      assertEquals(oauth.tokenRequestBodies.length, 2);
      assertEquals(
        new URLSearchParams(oauth.tokenRequestBodies[1]).get("resource"),
        `http://127.0.0.1:${oauth.port}`,
      );

      await oauth.server.shutdown();
    });
  },
});

Deno.test({
  name: "HttpTransport: 401 Bearer challenge surfaces OAuth login hint",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    await withOauthStorePath(async () => {
      let port = 0;
      const server = Deno.serve(
        {
          port: 0,
          hostname: "127.0.0.1",
          onListen({ port: p }) {
            port = p;
          },
        },
        async () =>
          await Promise.resolve(
            new Response("unauthorized", {
              status: 401,
              headers: { "WWW-Authenticate": 'Bearer realm="mcp"' },
            }),
          ),
      );
      await new Promise((r) => setTimeout(r, 50));

      const transport = new HttpTransport({
        name: "oauth-required",
        url: `http://127.0.0.1:${port}/mcp`,
      });
      await assertRejects(
        () =>
          transport.send({
            jsonrpc: "2.0",
            id: 1,
            method: "ping",
          }),
        Error,
        "hlvm mcp login oauth-required",
      );

      await server.shutdown();
    });
  },
});
