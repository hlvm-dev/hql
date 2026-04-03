import { getPlatform } from "../../../src/platform/platform.ts";
import type {
  PlatformHttpServeOptions,
  PlatformHttpServerHandle,
} from "../../../src/platform/types.ts";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isPermissionOrAddrInUseError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const name = (error as { name?: string }).name ?? "";
  const code = (error as { code?: string }).code ?? "";
  return (
    name === "PermissionDenied" ||
    name === "AddrInUse" ||
    code === "EACCES" ||
    code === "EADDRINUSE"
  );
}

function isPermissionDeniedError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const name = (error as { name?: string }).name ?? "";
  const code = (error as { code?: string }).code ?? "";
  return name === "PermissionDenied" || code === "EACCES";
}

export async function withServePermissionGuard(
  fn: () => Promise<void>,
): Promise<void> {
  try {
    await fn();
  } catch (error) {
    if (isPermissionDeniedError(error)) {
      return;
    }
    throw error;
  }
}

export async function withOAuthStorePath<T>(
  prefix: string,
  fn: (storePath: string) => Promise<T>,
): Promise<T> {
  const platform = getPlatform();
  const dir = await platform.fs.makeTempDir({ prefix });
  const path = platform.path.join(dir, "mcp-oauth.json");
  await platform.fs.writeTextFile(
    path,
    JSON.stringify({ version: 1, records: [] }, null, 2) + "\n",
  );
  try {
    return await fn(path);
  } finally {
    await platform.fs.remove(dir, { recursive: true });
  }
}

export async function serveWithRetry(
  options: PlatformHttpServeOptions,
  handler: (req: Request) => Response | Promise<Response>,
  maxAttempts = 5,
): Promise<PlatformHttpServerHandle> {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return getPlatform().http.serveWithHandle!(handler, options);
    } catch (error) {
      if (!isPermissionOrAddrInUseError(error) || attempt === maxAttempts) {
        throw error;
      }
      await sleep(40 * attempt);
    }
  }
  throw new Error("Failed to start server after retries");
}

export interface OAuthServerState {
  port: number;
  server: PlatformHttpServerHandle;
  tokenRequestBodies: string[];
}

export async function startOAuthServer(
  options: { initialExpiresIn?: number; protectMcp?: boolean } = {},
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

      if (options.protectMcp && url.pathname === "/mcp") {
        if (req.method === "DELETE") {
          return new Response(null, { status: 200 });
        }
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

      return new Response("Not Found", { status: 404 });
    },
  );

  state.server = server;
  await listening;
  return state;
}
