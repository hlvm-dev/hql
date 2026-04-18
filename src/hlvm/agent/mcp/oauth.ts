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
import { atomicWriteTextFile } from "../../../common/atomic-file.ts";
import { getMcpOAuthPath } from "../../../common/paths.ts";
import { releaseDirLock, tryAcquireDirLock } from "../../../common/dir-lock.ts";
import { http } from "../../../common/http-client.ts";
import { sha256HexSync } from "../../../common/sha256.ts";
import { normalizeServerName } from "./config.ts";
import { getErrorMessage, isObjectValue } from "../../../common/utils.ts";
import { getPlatform } from "../../../platform/platform.ts";
import {
  DEFAULT_LOCALHOST,
  DEFAULT_MCP_OAUTH_PORT,
} from "../../../common/config/types.ts";
import { getAgentLogger } from "../logger.ts";
import type { McpServerConfig } from "./types.ts";

import {
  auth,
  discoverOAuthServerInfo,
  exchangeAuthorization,
  type OAuthClientProvider,
  type OAuthDiscoveryState,
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
const MCP_OAUTH_CALLBACK_PATH = "/hlvm/oauth/callback";
const ACCESS_TOKEN_SKEW_MS = 300_000;
const OAUTH_CALLBACK_WAIT_TIMEOUT_MS = 120_000;
const MCP_OAUTH_REFRESH_LOCK_STALE_MS = 30_000;
const MCP_OAUTH_REFRESH_LOCK_WAIT_MS = 100;
const MCP_OAUTH_REFRESH_LOCK_ATTEMPTS = 200;

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
const HLVM_CLIENT_METADATA_BASE = {
  client_name: "HLVM MCP Client",
  grant_types: ["authorization_code", "refresh_token"],
  response_types: ["code"],
  token_endpoint_auth_method: "none",
} as const satisfies Omit<OAuthClientMetadata, "redirect_uris">;

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
  pendingScope?: string;
  pendingResource?: string;
  pendingStepUpAt?: string;
  discoveryState?: OAuthDiscoveryState;
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

interface McpOAuthLoginOptions {
  output?: (line: string) => void;
  promptInput?: (message: string) => Promise<string>;
  openBrowser?: (url: string) => Promise<void>;
  storePath?: string;
}

interface McpOAuthStoreOptions {
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
    authorization_endpoint: record.authorizationEndpoint ??
      record.authorizationServer,
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
    pendingScope: undefined,
    pendingResource: undefined,
    pendingStepUpAt: undefined,
    updatedAt: new Date().toISOString(),
  };
}

function recordToTokens(record: McpOAuthRecord): OAuthTokens {
  const expiresAt = parseExpiresAt(record.expiresAt);
  const expiresIn = expiresAt === null
    ? undefined
    : Math.max(0, Math.floor((expiresAt - Date.now()) / 1000));
  return {
    access_token: record.accessToken,
    token_type: record.tokenType ?? "Bearer",
    ...(record.refreshToken ? { refresh_token: record.refreshToken } : {}),
    ...(record.scope ? { scope: record.scope } : {}),
    ...(expiresIn !== undefined ? { expires_in: expiresIn } : {}),
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

function getRefreshLockPath(key: string, storePath?: string): string {
  const platform = getPlatform();
  const storeDir = platform.path.dirname(getStorePath(storePath));
  return platform.path.join(
    storeDir,
    `.mcp-oauth-refresh-${sha256HexSync(key)}.lock`,
  );
}

function getMcpOAuthCallbackPort(server: McpServerConfig): number {
  return server.oauth?.callbackPort ?? DEFAULT_MCP_OAUTH_PORT;
}

function getMcpOAuthRedirectUri(server: McpServerConfig): string {
  return `http://${DEFAULT_LOCALHOST}:${
    getMcpOAuthCallbackPort(server)
  }${MCP_OAUTH_CALLBACK_PATH}`;
}

function getMcpOAuthClientMetadata(
  server: McpServerConfig,
): OAuthClientMetadata {
  return {
    ...HLVM_CLIENT_METADATA_BASE,
    redirect_uris: [getMcpOAuthRedirectUri(server)],
  };
}

function getMcpOAuthStaticClientId(
  server: McpServerConfig,
): string | undefined {
  return server.oauth?.clientId ??
    getPlatform().env.get("HLVM_MCP_OAUTH_CLIENT_ID");
}

async function fetchConfiguredAuthorizationServerMetadata(
  metadataUrl: string,
): Promise<AuthorizationServerMetadata> {
  if (!metadataUrl.startsWith("https://")) {
    throw new ValidationError(
      `authServerMetadataUrl must use https:// (got: ${metadataUrl})`,
      "mcp_oauth",
    );
  }
  const response = await http.fetchRaw(metadataUrl, {
    headers: { Accept: "application/json" },
  });
  if (!response.ok) {
    throw new ValidationError(
      `HTTP ${response.status} fetching configured auth server metadata from ${metadataUrl}`,
      "mcp_oauth",
    );
  }
  return await response.json() as AuthorizationServerMetadata;
}

async function discoverMcpOAuthServerInfo(
  server: McpServerConfig & { url: string },
): Promise<OAuthDiscoveryState> {
  const serverInfo = await discoverOAuthServerInfo(server.url, {
    fetchFn: ssotFetch,
  });
  if (!server.oauth?.authServerMetadataUrl) {
    return serverInfo;
  }
  const authorizationServerMetadata =
    await fetchConfiguredAuthorizationServerMetadata(
      server.oauth.authServerMetadataUrl,
    );
  return {
    ...serverInfo,
    authorizationServerUrl: authorizationServerMetadata.issuer ??
      serverInfo.authorizationServerUrl,
    authorizationServerMetadata,
  };
}

function redactSensitiveOAuthText(value: string): string {
  return value
    .replace(
      /\b(Bearer)\s+[A-Za-z0-9._~+/=-]+\b/gi,
      "$1 [REDACTED]",
    )
    .replace(
      /([?&](?:access_token|refresh_token|client_secret|code|registration_access_token)=)[^&]+/gi,
      "$1[REDACTED]",
    )
    .replace(
      /\b(access_token|refresh_token|client_secret|code_verifier|registration_access_token)=([^&\s]+)/gi,
      "$1=[REDACTED]",
    );
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
          (record.pendingScope === undefined ||
            typeof record.pendingScope === "string") &&
          (record.pendingResource === undefined ||
            typeof record.pendingResource === "string") &&
          (record.pendingStepUpAt === undefined ||
            typeof record.pendingStepUpAt === "string") &&
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

async function withRefreshLock<T>(
  key: string,
  storePath: string | undefined,
  run: () => Promise<T>,
): Promise<T> {
  const lockPath = getRefreshLockPath(key, storePath);
  for (let attempt = 0; attempt < MCP_OAUTH_REFRESH_LOCK_ATTEMPTS; attempt++) {
    if (await tryAcquireDirLock(lockPath, MCP_OAUTH_REFRESH_LOCK_STALE_MS)) {
      try {
        return await run();
      } finally {
        await releaseDirLock(lockPath);
      }
    }
    await new Promise((resolve) =>
      setTimeout(resolve, MCP_OAUTH_REFRESH_LOCK_WAIT_MS)
    );
  }
  throw new ValidationError(
    "Timed out waiting for MCP OAuth refresh lock",
    "mcp_oauth",
  );
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

type RefreshResult =
  | { ok: true; record: McpOAuthRecord }
  | { ok: false; terminal: boolean; reason: string };

function extractHttpStatus(error: unknown): number | undefined {
  if (!isObjectValue(error)) return undefined;
  if (typeof error.status === "number") return error.status;
  if (typeof error.statusCode === "number") return error.statusCode;
  const response = isObjectValue(error.response)
    ? error.response as Record<string, unknown>
    : undefined;
  return typeof response?.status === "number" ? response.status : undefined;
}

async function refreshAccessToken(
  record: McpOAuthRecord,
  storePath?: string,
): Promise<RefreshResult> {
  if (!record.refreshToken) {
    return { ok: false, terminal: true, reason: "no refresh token" };
  }
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
    return { ok: true, record: next };
  } catch (error) {
    const msg = getErrorMessage(error);
    const status = extractHttpStatus(error);
    const isTerminal = status === 401 || status === 403 ||
      msg.includes("invalid_grant") || msg.includes("invalid_client");
    getAgentLogger().warn(
      `MCP OAuth refresh ${
        isTerminal ? "terminal" : "transient"
      } failure (${record.serverName}): ${redactSensitiveOAuthText(msg)}`,
    );
    return { ok: false, terminal: isTerminal, reason: msg };
  }
}

async function getActiveRecord(
  server: McpServerConfig,
  storePath?: string,
): Promise<McpOAuthRecord | null> {
  const initialStore = await loadStore(storePath);
  const record = findRecord(initialStore, server);
  if (!record) return null;
  if (!tokenNeedsRefresh(record)) return record;
  return await withRefreshLock(record.key, storePath, async () => {
    const refreshedStore = await loadStore(storePath);
    const latest = findRecord(refreshedStore, server);
    if (!latest) return null;
    if (!tokenNeedsRefresh(latest)) return latest;
    const result = await refreshAccessToken(latest, storePath);
    if (!result.ok) {
      if (result.terminal) {
        await removeRecordByKey(latest.key, storePath);
      }
      return null;
    }
    return result.record;
  });
}

export class McpOAuthTransportAuthProvider implements OAuthClientProvider {
  private pendingAuthorizationUrl: URL | null = null;
  private pendingState: string | undefined;
  private pendingCodeVerifier: string | null = null;
  private pendingClientInformation: OAuthClientInformationMixed | undefined;
  private pendingDiscoveryState: OAuthDiscoveryState | undefined;
  private readonly output: (line: string) => void;
  private readonly promptInput: (message: string) => Promise<string>;
  private readonly openBrowser: (url: string) => Promise<void>;

  constructor(
    private readonly server: McpServerConfig & { url: string },
    private readonly options: McpOAuthLoginOptions = {},
  ) {
    this.output = options.output ??
      ((line: string) => getAgentLogger().info(line));
    this.promptInput = options.promptInput ?? defaultPromptInput;
    this.openBrowser = options.openBrowser ??
      ((url: string) => getPlatform().openUrl(url));
  }

  get redirectUrl(): string {
    return getMcpOAuthRedirectUri(this.server);
  }

  get clientMetadata(): OAuthClientMetadata {
    return getMcpOAuthClientMetadata(this.server);
  }

  private async loadExistingRecord(): Promise<McpOAuthRecord | null> {
    return await getActiveRecord(this.server, this.options.storePath);
  }

  private buildRecordSkeleton(
    clientInfo: OAuthClientInformationMixed,
    discoveryState?: OAuthDiscoveryState,
    existing?: McpOAuthRecord | null,
  ): McpOAuthRecord {
    const key = getServerKey(this.server);
    if (!key) {
      throw new ValidationError(
        `Invalid MCP server URL: ${this.server.url}`,
        "mcp_oauth",
      );
    }
    const authServerUrl = discoveryState?.authorizationServerUrl ??
      existing?.authorizationServer;
    if (!authServerUrl) {
      throw new ValidationError(
        `OAuth discovery state missing for MCP server '${this.server.name}'`,
        "mcp_oauth",
      );
    }
    const metadata = discoveryState?.authorizationServerMetadata;
    const pendingResource = existing?.pendingResource;
    const resource = pendingResource ??
      existing?.resource ??
      (discoveryState?.resourceMetadata?.resource
        ? String(discoveryState.resourceMetadata.resource)
        : this.server.url);
    return {
      key,
      serverName: this.server.name,
      serverUrl: this.server.url,
      resource,
      authorizationServer: authServerUrl,
      authorizationEndpoint: metadata?.authorization_endpoint
        ? String(metadata.authorization_endpoint)
        : existing?.authorizationEndpoint,
      tokenEndpoint: metadata?.token_endpoint
        ? String(metadata.token_endpoint)
        : existing?.tokenEndpoint ?? `${authServerUrl}/token`,
      registrationEndpoint: metadata?.registration_endpoint
        ? String(metadata.registration_endpoint)
        : existing?.registrationEndpoint,
      clientId: clientInfo.client_id,
      clientSecret: "client_secret" in clientInfo
        ? clientInfo.client_secret
        : existing?.clientSecret,
      accessToken: existing?.accessToken ?? "",
      tokenType: existing?.tokenType,
      refreshToken: existing?.refreshToken,
      scope: existing?.scope,
      expiresAt: existing?.expiresAt,
      discoveryState: discoveryState ?? existing?.discoveryState,
      updatedAt: new Date().toISOString(),
    };
  }

  async clientInformation(): Promise<OAuthClientInformationMixed | undefined> {
    const record = await this.loadExistingRecord();
    if (record) return recordToClientInfo(record);
    if (this.pendingClientInformation) return this.pendingClientInformation;
    const staticClientId = getMcpOAuthStaticClientId(this.server);
    return staticClientId ? { client_id: staticClientId } : undefined;
  }

  async saveClientInformation(
    clientInformation: OAuthClientInformationMixed,
  ): Promise<void> {
    this.pendingClientInformation = clientInformation;
  }

  async tokens(): Promise<OAuthTokens | undefined> {
    const record = await this.loadExistingRecord();
    return record?.accessToken ? recordToTokens(record) : undefined;
  }

  async saveTokens(tokens: OAuthTokens): Promise<void> {
    const store = await loadStore(this.options.storePath);
    const existing = findRecord(store, this.server);
    const clientInfo = this.pendingClientInformation ??
      (existing ? recordToClientInfo(existing) : undefined);
    if (!clientInfo) {
      throw new ValidationError(
        `OAuth client registration missing for MCP server '${this.server.name}'`,
        "mcp_oauth",
      );
    }
    const baseRecord = this.buildRecordSkeleton(
      clientInfo,
      this.pendingDiscoveryState ?? existing?.discoveryState,
      existing,
    );
    await upsertRecord(
      tokensToRecord(tokens, baseRecord),
      this.options.storePath,
    );
    this.pendingAuthorizationUrl = null;
    this.pendingState = undefined;
    this.pendingCodeVerifier = null;
  }

  async redirectToAuthorization(authorizationUrl: URL): Promise<void> {
    this.pendingAuthorizationUrl = new URL(authorizationUrl);
    this.pendingState = authorizationUrl.searchParams.get("state") ?? undefined;
    const store = await loadStore(this.options.storePath);
    const existing = findRecord(store, this.server);
    if (existing) {
      await upsertRecord(
        {
          ...existing,
          pendingScope: authorizationUrl.searchParams.get("scope") ??
            existing.pendingScope,
          pendingResource: authorizationUrl.searchParams.get("resource") ??
            existing.pendingResource,
          pendingStepUpAt: new Date().toISOString(),
          discoveryState: this.pendingDiscoveryState ?? existing.discoveryState,
          updatedAt: new Date().toISOString(),
        },
        this.options.storePath,
      );
    }
    this.output(`Open this URL to authorize MCP server '${this.server.name}':`);
    this.output(redactSensitiveOAuthText(authorizationUrl.toString()));
    await this.openBrowser(authorizationUrl.toString());
  }

  async saveCodeVerifier(codeVerifier: string): Promise<void> {
    this.pendingCodeVerifier = codeVerifier;
  }

  async codeVerifier(): Promise<string> {
    if (!this.pendingCodeVerifier) {
      throw new ValidationError(
        `OAuth code verifier missing for MCP server '${this.server.name}'`,
        "mcp_oauth",
      );
    }
    return this.pendingCodeVerifier;
  }

  async saveDiscoveryState(state: OAuthDiscoveryState): Promise<void> {
    this.pendingDiscoveryState = state;
    const store = await loadStore(this.options.storePath);
    const existing = findRecord(store, this.server);
    if (existing) {
      await upsertRecord(
        {
          ...existing,
          discoveryState: state,
          updatedAt: new Date().toISOString(),
        },
        this.options.storePath,
      );
    }
  }

  async discoveryState(): Promise<OAuthDiscoveryState | undefined> {
    if (this.pendingDiscoveryState) return this.pendingDiscoveryState;
    const store = await loadStore(this.options.storePath);
    const existing = findRecord(store, this.server)?.discoveryState;
    if (existing) return existing;
    if (!this.server.oauth?.authServerMetadataUrl) return undefined;
    const serverInfo = await discoverMcpOAuthServerInfo(this.server);
    return {
      authorizationServerUrl: serverInfo.authorizationServerUrl,
      resourceMetadata: serverInfo.resourceMetadata,
      authorizationServerMetadata: serverInfo.authorizationServerMetadata,
    };
  }

  async invalidateCredentials(
    scope: "all" | "client" | "tokens" | "verifier" | "discovery",
  ): Promise<void> {
    if (scope === "verifier" || scope === "all") {
      this.pendingAuthorizationUrl = null;
      this.pendingState = undefined;
      this.pendingCodeVerifier = null;
    }
    if (scope === "client" || scope === "all") {
      this.pendingClientInformation = undefined;
    }
    if (scope === "discovery" || scope === "all") {
      this.pendingDiscoveryState = undefined;
    }

    const store = await loadStore(this.options.storePath);
    const existing = findRecord(store, this.server);
    if (!existing) return;

    if (scope === "all" || scope === "client") {
      await removeRecordByKey(existing.key, this.options.storePath);
      return;
    }

    const next: McpOAuthRecord = {
      ...existing,
      updatedAt: new Date().toISOString(),
    };
    if (scope === "tokens") {
      next.accessToken = "";
      next.refreshToken = undefined;
      next.tokenType = undefined;
      next.expiresAt = undefined;
    }
    if (scope === "discovery") {
      next.discoveryState = undefined;
    }
    await upsertRecord(next, this.options.storePath);
  }

  hasPendingAuthorization(): boolean {
    return this.pendingAuthorizationUrl !== null;
  }

  async promptForAuthorizationCode(): Promise<string> {
    if (!this.pendingAuthorizationUrl) {
      throw new ValidationError(
        `No pending OAuth authorization for MCP server '${this.server.name}'`,
        "mcp_oauth",
      );
    }
    const state = this.pendingState ?? "";
    let callbackInput = "";
    const receivedCallbackUrl = await waitForOAuthCallback(
      this.redirectUrl,
      state,
      this.output,
    );
    if (receivedCallbackUrl) {
      callbackInput = receivedCallbackUrl;
      this.output("OAuth callback received.");
    }
    if (!callbackInput) {
      callbackInput = await this.promptInput(
        "Paste the full redirected callback URL (or paste just the `code` value)",
      );
    }
    return parseAuthorizationCodeInput(callbackInput, state);
  }
}

export function createMcpOAuthTransportAuthProvider(
  server: McpServerConfig,
  options: McpOAuthLoginOptions = {},
): McpOAuthTransportAuthProvider {
  ensureHttpServerConfig(server);
  return new McpOAuthTransportAuthProvider(server, options);
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
  const serverInfo = await discoverMcpOAuthServerInfo(server);
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

  const staticClientId = getMcpOAuthStaticClientId(server);
  let clientInfo: OAuthClientInformationMixed;

  if (reusableClient) {
    clientInfo = reusableClient;
  } else if (staticClientId) {
    clientInfo = { client_id: staticClientId };
  } else if (metadata?.registration_endpoint) {
    const fullInfo = await registerClient(authServerUrl, {
      metadata,
      clientMetadata: getMcpOAuthClientMetadata(server),
      fetchFn: ssotFetch,
    });
    clientInfo = fullInfo;
  } else {
    throw new ValidationError(
      "OAuth login requires either dynamic client registration support or HLVM_MCP_OAUTH_CLIENT_ID",
      "mcp_oauth",
    );
  }

  // 3. Build scope
  const scopesSupported = resourceMetadata?.scopes_supported ?? [];
  const requestedScopes = new Set<string>();
  if (scopesSupported.includes("offline_access")) {
    requestedScopes.add("offline_access");
  }
  for (const scopeEntry of (existing?.pendingScope ?? "").split(/\s+/)) {
    if (scopeEntry.trim()) requestedScopes.add(scopeEntry.trim());
  }
  const scope = requestedScopes.size > 0
    ? [...requestedScopes].join(" ")
    : undefined;

  // 4. Start authorization (PKCE + URL construction via SDK)
  const resourceUrl = existing?.pendingResource
    ? new URL(existing.pendingResource)
    : resourceMetadata?.resource
    ? new URL(String(resourceMetadata.resource))
    : existing?.resource
    ? new URL(existing.resource)
    : new URL(server.url);

  const { authorizationUrl, codeVerifier } = await startAuthorization(
    authServerUrl,
    {
      metadata,
      clientInformation: clientInfo,
      redirectUrl: getMcpOAuthRedirectUri(server),
      scope,
      resource: resourceUrl,
    },
  );

  const state = authorizationUrl.searchParams.get("state") ?? "";

  // 5. Open browser + wait for callback
  output(`Open this URL to authorize MCP server '${server.name}':`);
  output(redactSensitiveOAuthText(authorizationUrl.toString()));
  await openBrowser(authorizationUrl.toString());

  let callbackInput = "";
  if (!options.promptInput) {
    const receivedCallbackUrl = await waitForOAuthCallback(
      getMcpOAuthRedirectUri(server),
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
    redirectUri: getMcpOAuthRedirectUri(server),
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
    discoveryState: {
      authorizationServerUrl: authServerUrl,
      resourceMetadata,
      authorizationServerMetadata: metadata,
    },
    updatedAt: new Date().toISOString(),
  });
  await upsertRecord(finalRecord, options.storePath);
  output(`OAuth login complete for MCP server '${server.name}'.`);
}

export async function getMcpOAuthAuthorizationHeader(
  server: McpServerConfig,
  options: McpOAuthStoreOptions = {},
): Promise<string | null> {
  const record = await getActiveRecord(server, options.storePath);
  if (!record?.accessToken) return null;
  return buildBearerHeader(record);
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

  if (challenge.params.error === "insufficient_scope") {
    await upsertRecord(
      {
        ...record,
        pendingScope: challenge.params.scope ?? record.pendingScope,
        pendingResource: record.resource ?? record.pendingResource,
        pendingStepUpAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      options.storePath,
    );
    return false;
  }

  if (!record.refreshToken) {
    return false;
  }
  const result = await withRefreshLock(
    record.key,
    options.storePath,
    async () => {
      const latest = findRecord(await loadStore(options.storePath), server);
      if (!latest?.refreshToken) {
        return {
          ok: false,
          terminal: true,
          reason: "no refresh token",
        } satisfies RefreshResult;
      }
      return await refreshAccessToken(latest, options.storePath);
    },
  );
  if (!result.ok) {
    // Only delete token on terminal failure — preserve on transient errors
    if (result.terminal) {
      await removeRecordByKey(record.key, options.storePath);
    }
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
