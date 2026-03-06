/**
 * MCP OAuth — Authorization and token lifecycle support for HTTP MCP servers.
 *
 * Supports:
 * - Bearer challenge parsing (`WWW-Authenticate`)
 * - Protected resource metadata discovery (via MCP SDK)
 * - Authorization server metadata discovery (via MCP SDK)
 * - PKCE authorization-code login flow (browser + pasted callback URL/code)
 * - Token persistence and refresh
 *
 * Protocol-level OAuth (discovery, PKCE, token exchange, registration, refresh)
 * is delegated to `@modelcontextprotocol/sdk/client/auth.js`.
 */

import { ValidationError } from "../../../common/error.ts";
import { atomicWriteTextFile } from "../../../common/jsonl.ts";
import { getMcpOAuthPath } from "../../../common/paths.ts";
import { http } from "../../../common/http-client.ts";
import { normalizeServerName } from "./config.ts";
import { getErrorMessage, isObjectValue } from "../../../common/utils.ts";
import { getPlatform } from "../../../platform/platform.ts";
import { getAgentLogger } from "../logger.ts";
import type { McpServerConfig } from "./types.ts";

import {
  discoverOAuthServerInfo,
  exchangeAuthorization,
  refreshAuthorization,
  registerClient,
  startAuthorization,
} from "@modelcontextprotocol/sdk/client/auth.js";
import type { FetchLike } from "@modelcontextprotocol/sdk/shared/transport.js";
import type {
  AuthorizationServerMetadata,
  OAuthClientInformationMixed,
  OAuthClientMetadata,
  OAuthTokens,
} from "@modelcontextprotocol/sdk/shared/auth.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MCP_OAUTH_STORE_VERSION = 1;
const MCP_OAUTH_REDIRECT_URI = "http://127.0.0.1:35017/hlvm/oauth/callback";
const ACCESS_TOKEN_SKEW_MS = 60_000;
const OAUTH_CALLBACK_WAIT_TIMEOUT_MS = 120_000;

/**
 * SSOT fetch wrapper — SDK's FetchLike passes `(URL|string, RequestInit?)` but
 * `http.fetchRaw` expects `HttpOptions & RequestInit`. The intersection's `headers`
 * field is structurally incompatible (`Record<string,string>` vs `HeadersInit`),
 * so a cast is required. At runtime the SDK only passes standard RequestInit values.
 */
// deno-lint-ignore no-explicit-any
const ssotFetch: FetchLike = (url, init?) =>
  http.fetchRaw(String(url), init as any);

/**
 * Client metadata for dynamic registration via `registerClient()`.
 * SDK's OAuthClientMetadata (zod v4) infers `redirect_uris` as `string[]`
 * so a direct type annotation works without casts.
 */
const HLVM_CLIENT_METADATA: OAuthClientMetadata = {
  client_name: "HLVM MCP Client",
  grant_types: ["authorization_code", "refresh_token"],
  response_types: ["code"],
  redirect_uris: [MCP_OAUTH_REDIRECT_URI],
  token_endpoint_auth_method: "none",
};

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface McpOAuthRecord {
  key: string;
  serverName: string;
  serverUrl: string;
  resource?: string;
  authorizationServer: string;
  authorizationEndpoint?: string;
  tokenEndpoint: string;
  registrationEndpoint?: string;
  clientId: string;
  clientSecret?: string;
  registrationClientUri?: string;
  registrationAccessToken?: string;
  accessToken: string;
  tokenType?: string;
  refreshToken?: string;
  scope?: string;
  expiresAt?: string;
  updatedAt: string;
}

interface McpOAuthStore {
  version: 1;
  records: McpOAuthRecord[];
}

interface ParsedBearerChallenge {
  scheme: "Bearer";
  params: Record<string, string>;
}

export interface McpOAuthLoginOptions {
  output?: (line: string) => void;
  promptInput?: (message: string) => Promise<string>;
  openBrowser?: (url: string) => Promise<void>;
  storePath?: string;
}

export interface McpOAuthStoreOptions {
  storePath?: string;
}

// ---------------------------------------------------------------------------
// SDK Adapters
// ---------------------------------------------------------------------------

/** Convert a stored `McpOAuthRecord` to SDK `OAuthClientInformationMixed`. */
function recordToClientInfo(
  record: McpOAuthRecord,
): OAuthClientInformationMixed {
  return {
    client_id: record.clientId,
    ...(record.clientSecret ? { client_secret: record.clientSecret } : {}),
  };
}

/** Reconstruct minimal SDK metadata from stored record endpoints. */
function recordToMetadata(record: McpOAuthRecord): AuthorizationServerMetadata {
  return {
    issuer: record.authorizationServer,
    authorization_endpoint: record.authorizationEndpoint ?? record.authorizationServer,
    token_endpoint: record.tokenEndpoint,
    ...(record.registrationEndpoint
      ? { registration_endpoint: record.registrationEndpoint }
      : {}),
    response_types_supported: ["code"],
  } as AuthorizationServerMetadata;
}

/** Merge SDK `OAuthTokens` into an existing `McpOAuthRecord`. */
function tokensToRecord(
  tokens: OAuthTokens,
  record: McpOAuthRecord,
): McpOAuthRecord {
  const expiresAt = typeof tokens.expires_in === "number"
    ? new Date(Date.now() + tokens.expires_in * 1000).toISOString()
    : record.expiresAt;
  return {
    ...record,
    accessToken: tokens.access_token,
    tokenType: tokens.token_type ?? record.tokenType,
    refreshToken: tokens.refresh_token ?? record.refreshToken,
    scope: tokens.scope ?? record.scope,
    expiresAt,
    updatedAt: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Store Persistence
// ---------------------------------------------------------------------------

function emptyStore(): McpOAuthStore {
  return { version: MCP_OAUTH_STORE_VERSION, records: [] };
}

function normalizeServerUrl(url: string): string {
  const parsed = new URL(url);
  parsed.hash = "";
  return parsed.toString().replace(/\/+$/, "");
}

function getServerKey(server: McpServerConfig): string | null {
  if (!server.url) return null;
  try {
    return `${normalizeServerName(server.name)}|${
      normalizeServerUrl(server.url)
    }`;
  } catch {
    return null;
  }
}

function getStorePath(storePath?: string): string {
  if (storePath) return storePath;
  const override = getPlatform().env.get("HLVM_MCP_OAUTH_PATH");
  if (override) return override;
  return getMcpOAuthPath();
}

async function loadStore(storePath?: string): Promise<McpOAuthStore> {
  const platform = getPlatform();
  try {
    const raw = await platform.fs.readTextFile(getStorePath(storePath));
    const parsed = JSON.parse(raw) as unknown;
    if (!isObjectValue(parsed) || parsed.version !== MCP_OAUTH_STORE_VERSION) {
      return emptyStore();
    }
    const records = Array.isArray(parsed.records)
      ? parsed.records.filter((record): record is McpOAuthRecord => {
        if (!isObjectValue(record)) return false;
        return typeof record.key === "string" &&
          typeof record.serverName === "string" &&
          typeof record.serverUrl === "string" &&
          typeof record.authorizationServer === "string" &&
          typeof record.tokenEndpoint === "string" &&
          typeof record.clientId === "string" &&
          typeof record.accessToken === "string" &&
          typeof record.updatedAt === "string";
      })
      : [];
    return { version: MCP_OAUTH_STORE_VERSION, records };
  } catch {
    return emptyStore();
  }
}

async function saveStore(
  store: McpOAuthStore,
  storePath?: string,
): Promise<void> {
  const payload = JSON.stringify(store, null, 2) + "\n";
  const path = getStorePath(storePath);
  await atomicWriteTextFile(path, payload);
  try {
    await getPlatform().fs.chmod(path, 0o600);
  } catch {
    // Best-effort: chmod may fail on some filesystems.
  }
}

function findRecord(
  store: McpOAuthStore,
  server: McpServerConfig,
): McpOAuthRecord | null {
  const key = getServerKey(server);
  if (!key) return null;
  return store.records.find((r) => r.key === key) ?? null;
}

async function upsertRecord(
  record: McpOAuthRecord,
  storePath?: string,
): Promise<void> {
  const store = await loadStore(storePath);
  const idx = store.records.findIndex((r) => r.key === record.key);
  if (idx === -1) {
    store.records.push(record);
  } else {
    store.records[idx] = record;
  }
  await saveStore(store, storePath);
}

async function removeRecordByKey(
  key: string,
  storePath?: string,
): Promise<boolean> {
  const store = await loadStore(storePath);
  const next = store.records.filter((r) => r.key !== key);
  if (next.length === store.records.length) return false;
  store.records = next;
  await saveStore(store, storePath);
  return true;
}

// ---------------------------------------------------------------------------
// Token State Helpers
// ---------------------------------------------------------------------------

function parseExpiresAt(expiresAt?: string): number | null {
  if (!expiresAt) return null;
  const ts = Date.parse(expiresAt);
  return Number.isFinite(ts) ? ts : null;
}

function tokenNeedsRefresh(record: McpOAuthRecord): boolean {
  const expiresAt = parseExpiresAt(record.expiresAt);
  if (expiresAt === null) return false;
  return Date.now() + ACCESS_TOKEN_SKEW_MS >= expiresAt;
}

function buildBearerHeader(record: McpOAuthRecord): string {
  const raw = (record.tokenType ?? "Bearer").trim();
  const tokenType = raw.toLowerCase() === "bearer" ? "Bearer" : raw;
  return `${tokenType} ${record.accessToken}`;
}

// ---------------------------------------------------------------------------
// Bearer Challenge Parsing
// ---------------------------------------------------------------------------

function splitHeaderParams(input: string): string[] {
  const out: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    if (ch === '"') {
      inQuotes = !inQuotes;
      current += ch;
      continue;
    }
    if (ch === "," && !inQuotes) {
      out.push(current.trim());
      current = "";
      continue;
    }
    current += ch;
  }
  if (current.trim()) out.push(current.trim());
  return out;
}

function unquoteHeaderValue(value: string): string {
  const v = value.trim();
  if (v.startsWith('"') && v.endsWith('"')) return v.slice(1, -1);
  return v;
}

export function parseBearerChallengeHeader(
  header: string | null,
): ParsedBearerChallenge | null {
  if (!header) return null;
  const idx = header.toLowerCase().indexOf("bearer");
  if (idx === -1) return null;
  const rest = header.slice(idx + "bearer".length).trim();
  const params: Record<string, string> = {};
  for (const part of splitHeaderParams(rest)) {
    const eq = part.indexOf("=");
    if (eq <= 0) continue;
    const key = part.slice(0, eq).trim().toLowerCase();
    const value = unquoteHeaderValue(part.slice(eq + 1));
    params[key] = value;
  }
  return { scheme: "Bearer", params };
}

// ---------------------------------------------------------------------------
// CLI UX Helpers
// ---------------------------------------------------------------------------

function parseAuthorizationCodeInput(
  value: string,
  expectedState: string,
): string {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new ValidationError(
      "OAuth authorization code input is empty",
      "mcp_oauth",
    );
  }
  if (/^https?:\/\//i.test(trimmed)) {
    const callback = new URL(trimmed);
    const code = callback.searchParams.get("code");
    const state = callback.searchParams.get("state");
    if (!code) {
      throw new ValidationError(
        "OAuth callback URL missing code parameter",
        "mcp_oauth",
      );
    }
    if (state && state !== expectedState) {
      throw new ValidationError("OAuth state mismatch", "mcp_oauth");
    }
    return code;
  }
  if (trimmed.includes("%")) {
    try {
      return decodeURIComponent(trimmed);
    } catch {
      // fall through
    }
  }
  return trimmed;
}

function defaultPromptInput(message: string): Promise<string> {
  const response = prompt(`${message}\n> `);
  return Promise.resolve((response ?? "").trim());
}

function oauthCallbackPage(message: string): string {
  const escaped = message
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>HLVM OAuth</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; margin: 0; background: #f6f7f9; color: #111827; }
    main { min-height: 100vh; display: grid; place-items: center; padding: 24px; }
    section { max-width: 640px; width: 100%; background: #fff; border-radius: 12px; box-shadow: 0 8px 30px rgba(0,0,0,0.08); padding: 24px; }
    h1 { margin: 0 0 8px; font-size: 22px; }
    p { margin: 0; line-height: 1.5; }
  </style>
</head>
<body>
  <main>
    <section>
      <h1>Authorization received</h1>
      <p>${escaped}</p>
    </section>
  </main>
</body>
</html>`;
}

async function waitForOAuthCallback(
  redirectUri: string,
  expectedState: string,
  output: (line: string) => void,
): Promise<string | null> {
  const redirect = new URL(redirectUri);
  if (redirect.protocol !== "http:") {
    return null;
  }
  const hostname = redirect.hostname;
  const port = Number(redirect.port || "80");
  const expectedPath = redirect.pathname;
  if (!Number.isFinite(port) || port <= 0) {
    return null;
  }

  let settle: ((value: string | null) => void) | null = null;
  const pending = new Promise<string | null>((resolve) => {
    settle = resolve;
  });
  let settled = false;
  const finish = (value: string | null) => {
    if (settled || !settle) return;
    settled = true;
    settle(value);
  };
  const timeoutId = setTimeout(
    () => finish(null),
    OAUTH_CALLBACK_WAIT_TIMEOUT_MS,
  );

  const serveWithHandle = getPlatform().http.serveWithHandle;
  if (!serveWithHandle) {
    clearTimeout(timeoutId);
    output(
      "OAuth auto-callback listener is not available on this runtime. Falling back to manual paste.",
    );
    return null;
  }

  let server = null as ReturnType<typeof serveWithHandle> | null;
  try {
    server = serveWithHandle(
      (req) => {
        const incoming = new URL(req.url);
        if (incoming.pathname !== expectedPath) {
          return new Response("Not Found", { status: 404 });
        }

        const code = incoming.searchParams.get("code");
        const state = incoming.searchParams.get("state");
        if (!code) {
          return new Response(
            oauthCallbackPage(
              "Missing authorization code. Return to terminal and retry login.",
            ),
            {
              status: 400,
              headers: { "Content-Type": "text/html; charset=utf-8" },
            },
          );
        }
        if (state && state !== expectedState) {
          return new Response(
            oauthCallbackPage(
              "State mismatch. Return to terminal and retry login.",
            ),
            {
              status: 400,
              headers: { "Content-Type": "text/html; charset=utf-8" },
            },
          );
        }

        const fullUrl = incoming.toString();
        finish(fullUrl);
        return new Response(
          oauthCallbackPage(
            "You can close this tab and return to your terminal.",
          ),
          { headers: { "Content-Type": "text/html; charset=utf-8" } },
        );
      },
      {
        hostname,
        port,
        onListen: () => {
          // Keep output clean; login flow already prints the authorize URL.
        },
      },
    );
  } catch (error) {
    clearTimeout(timeoutId);
    output(
      `Could not start OAuth callback listener at ${redirectUri}: ${
        getErrorMessage(error)
      }`,
    );
    return null;
  }

  try {
    return await pending;
  } finally {
    clearTimeout(timeoutId);
    if (server) {
      try {
        await server.shutdown();
        await server.finished;
      } catch {
        // ignore shutdown errors
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

function ensureHttpServerConfig(
  server: McpServerConfig,
): asserts server is McpServerConfig & { url: string } {
  if (!server.url) {
    throw new ValidationError(
      `MCP server '${server.name}' is not an HTTP server (missing --url)`,
      "mcp_oauth",
    );
  }
}

// ---------------------------------------------------------------------------
// Token Refresh (SDK-backed)
// ---------------------------------------------------------------------------

async function refreshAccessToken(
  record: McpOAuthRecord,
  storePath?: string,
): Promise<McpOAuthRecord | null> {
  if (!record.refreshToken) return null;
  try {
    const tokens = await refreshAuthorization(record.authorizationServer, {
      metadata: recordToMetadata(record),
      clientInformation: recordToClientInfo(record),
      refreshToken: record.refreshToken,
      resource: new URL(record.resource ?? record.serverUrl),
      fetchFn: ssotFetch,
    });
    const next = tokensToRecord(tokens, record);
    await upsertRecord(next, storePath);
    return next;
  } catch (error) {
    getAgentLogger().warn(
      `MCP OAuth refresh failed (${record.serverName}): ${
        getErrorMessage(error)
      }`,
    );
    return null;
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function loginMcpHttpServer(
  server: McpServerConfig,
  options: McpOAuthLoginOptions = {},
): Promise<void> {
  ensureHttpServerConfig(server);

  const output = options.output ??
    ((line: string) => getAgentLogger().info(line));
  const promptInput = options.promptInput ?? defaultPromptInput;
  const openBrowser = options.openBrowser ??
    ((url: string) => getPlatform().openUrl(url));

  // 1. Discover authorization server via SDK
  const serverInfo = await discoverOAuthServerInfo(server.url, {
    fetchFn: ssotFetch,
  });
  const authServerUrl = serverInfo.authorizationServerUrl;
  const metadata = serverInfo.authorizationServerMetadata;
  const resourceMetadata = serverInfo.resourceMetadata;

  const key = getServerKey(server);
  if (!key) {
    throw new ValidationError(
      `Invalid MCP server URL: ${server.url}`,
      "mcp_oauth",
    );
  }

  // 2. Resolve client registration (reuse existing or register new)
  const existing = findRecord(await loadStore(options.storePath), server);
  const reusableClient = existing &&
      existing.authorizationServer === authServerUrl &&
      existing.tokenEndpoint ===
        (metadata?.token_endpoint
          ? String(metadata.token_endpoint)
          : existing.tokenEndpoint)
    ? recordToClientInfo(existing)
    : null;

  const staticClientId = getPlatform().env.get("HLVM_MCP_OAUTH_CLIENT_ID");
  let clientInfo: OAuthClientInformationMixed;

  if (reusableClient) {
    clientInfo = reusableClient;
  } else if (metadata?.registration_endpoint) {
    const fullInfo = await registerClient(authServerUrl, {
      metadata,
      clientMetadata: HLVM_CLIENT_METADATA,
      fetchFn: ssotFetch,
    });
    clientInfo = fullInfo;
  } else if (staticClientId) {
    clientInfo = { client_id: staticClientId };
  } else {
    throw new ValidationError(
      "OAuth login requires either dynamic client registration support or HLVM_MCP_OAUTH_CLIENT_ID",
      "mcp_oauth",
    );
  }

  // 3. Build scope
  const scopesSupported = resourceMetadata?.scopes_supported ?? [];
  const scope = scopesSupported.includes("offline_access")
    ? "offline_access"
    : undefined;

  // 4. Start authorization (PKCE + URL construction via SDK)
  const resourceUrl = resourceMetadata?.resource
    ? new URL(String(resourceMetadata.resource))
    : new URL(server.url);

  const { authorizationUrl, codeVerifier } = await startAuthorization(
    authServerUrl,
    {
      metadata,
      clientInformation: clientInfo,
      redirectUrl: MCP_OAUTH_REDIRECT_URI,
      scope,
      resource: resourceUrl,
    },
  );

  const state = authorizationUrl.searchParams.get("state") ?? "";

  // 5. Open browser + wait for callback
  output(`Open this URL to authorize MCP server '${server.name}':`);
  output(authorizationUrl.toString());
  await openBrowser(authorizationUrl.toString());

  let callbackInput = "";
  if (!options.promptInput) {
    const receivedCallbackUrl = await waitForOAuthCallback(
      MCP_OAUTH_REDIRECT_URI,
      state,
      output,
    );
    if (receivedCallbackUrl) {
      callbackInput = receivedCallbackUrl;
      output("OAuth callback received.");
    }
  }
  if (!callbackInput) {
    callbackInput = await promptInput(
      "Paste the full redirected callback URL (or paste just the `code` value)",
    );
  }
  const code = parseAuthorizationCodeInput(callbackInput, state);

  // 6. Exchange authorization code for tokens via SDK
  const tokens = await exchangeAuthorization(authServerUrl, {
    metadata,
    clientInformation: clientInfo,
    authorizationCode: code,
    codeVerifier,
    redirectUri: MCP_OAUTH_REDIRECT_URI,
    resource: resourceUrl,
    fetchFn: ssotFetch,
  });

  // 7. Persist record
  const tokenEndpoint = metadata?.token_endpoint
    ? String(metadata.token_endpoint)
    : `${authServerUrl}/token`;
  const authorizationEndpoint = metadata?.authorization_endpoint
    ? String(metadata.authorization_endpoint)
    : undefined;
  const registrationEndpoint = metadata?.registration_endpoint
    ? String(metadata.registration_endpoint)
    : undefined;

  const finalRecord = tokensToRecord(tokens, {
    key,
    serverName: server.name,
    serverUrl: server.url,
    resource: String(resourceUrl),
    authorizationServer: authServerUrl,
    authorizationEndpoint,
    tokenEndpoint,
    registrationEndpoint,
    clientId: clientInfo.client_id,
    clientSecret: "client_secret" in clientInfo
      ? clientInfo.client_secret
      : undefined,
    accessToken: tokens.access_token,
    updatedAt: new Date().toISOString(),
  });
  await upsertRecord(finalRecord, options.storePath);
  output(`OAuth login complete for MCP server '${server.name}'.`);
}

export async function getMcpOAuthAuthorizationHeader(
  server: McpServerConfig,
  options: McpOAuthStoreOptions = {},
): Promise<string | null> {
  const store = await loadStore(options.storePath);
  const record = findRecord(store, server);
  if (!record) return null;

  let activeRecord = record;
  if (tokenNeedsRefresh(record)) {
    const refreshed = await refreshAccessToken(record, options.storePath);
    if (!refreshed) {
      await removeRecordByKey(record.key, options.storePath);
      return null;
    }
    activeRecord = refreshed;
  }

  return buildBearerHeader(activeRecord);
}

export async function recoverMcpOAuthFromUnauthorized(
  server: McpServerConfig,
  wwwAuthenticateHeader: string | null,
  options: McpOAuthStoreOptions = {},
): Promise<boolean> {
  const challenge = parseBearerChallengeHeader(wwwAuthenticateHeader);
  if (!challenge) return false;

  const store = await loadStore(options.storePath);
  const record = findRecord(store, server);
  if (!record) return false;

  if (!record.refreshToken) {
    return false;
  }
  const refreshed = await refreshAccessToken(record, options.storePath);
  if (!refreshed) {
    await removeRecordByKey(record.key, options.storePath);
    return false;
  }
  return true;
}

export async function logoutMcpHttpServer(
  server: McpServerConfig,
  options: McpOAuthStoreOptions = {},
): Promise<boolean> {
  const key = getServerKey(server);
  if (!key) return false;
  return await removeRecordByKey(key, options.storePath);
}
