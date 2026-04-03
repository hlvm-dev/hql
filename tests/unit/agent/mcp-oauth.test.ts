import { assertEquals, assertRejects } from "jsr:@std/assert";
import {
  getMcpOAuthAuthorizationHeader,
  loginMcpHttpServer,
  logoutMcpHttpServer,
  parseBearerChallengeHeader,
  recoverMcpOAuthFromUnauthorized,
} from "../../../src/hlvm/agent/mcp/oauth.ts";
import { createSdkMcpClient } from "../../../src/hlvm/agent/mcp/sdk-client.ts";
import { getPlatform, setPlatform } from "../../../src/platform/platform.ts";
import {
  startOAuthServer,
  withServePermissionGuard,
  withOAuthStorePath,
} from "./oauth-test-helpers.ts";
import { withTempHlvmDir } from "../helpers.ts";

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
  name: "MCP OAuth: non-interactive SDK inspection never opens the browser",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    await withServePermissionGuard(async () => {
      await withTempHlvmDir(async () => {
        const oauth = await startOAuthServer({ protectMcp: true });
        const originalPlatform = getPlatform();
        let openUrlCalls = 0;
        setPlatform({
          ...originalPlatform,
          openUrl: async () => {
            openUrlCalls++;
          },
        });

        try {
          await assertRejects(
            () =>
              createSdkMcpClient(
                {
                  name: "oauth-inspect",
                  url: `http://127.0.0.1:${oauth.port}/mcp`,
                },
                undefined,
                { interactiveAuth: false },
              ),
            Error,
            "Interactive MCP OAuth disabled",
          );
          assertEquals(openUrlCalls, 0);
        } finally {
          setPlatform(originalPlatform);
          await oauth.server.shutdown();
        }
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

Deno.test({
  name: "MCP OAuth: insufficient_scope persists pending scope for next login",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    await withServePermissionGuard(async () => {
      await withOauthStorePath(async (storePath) => {
        const oauth = await startOAuthServer({ initialExpiresIn: 3600 });
        const server = {
          name: "oauth-step-up",
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
            return Promise.resolve(`http://127.0.0.1:35017/hlvm/oauth/callback?code=init&state=${
              encodeURIComponent(state)
            }`);
          },
        });

        const recovered = await recoverMcpOAuthFromUnauthorized(
          server,
          'Bearer error="insufficient_scope", scope="offline_access extra_scope"',
          { storePath },
        );
        assertEquals(recovered, false);

        let reauthUrl = "";
        await loginMcpHttpServer(server, {
          output: () => {},
          storePath,
          openBrowser: (url) => {
            reauthUrl = url;
            return Promise.resolve();
          },
          promptInput: () => {
            const state = new URL(reauthUrl).searchParams.get("state") ?? "";
            return Promise.resolve(`http://127.0.0.1:35017/hlvm/oauth/callback?code=reauth&state=${
              encodeURIComponent(state)
            }`);
          },
        });

        assertEquals(
          new URL(reauthUrl).searchParams.get("scope"),
          "offline_access extra_scope",
        );

        await oauth.server.shutdown();
      });
    });
  },
});
