/**
 * MCP OAuth — Authorization and token lifecycle support for HTTP MCP servers.
 *
 * Supports:
 * - Bearer challenge parsing (`WWW-Authenticate`)
 * - Protected resource metadata discovery
 * - Authorization server metadata discovery
 * - PKCE authorization-code login flow (browser + pasted callback URL/code)
 * - Token persistence and refresh
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

const MCP_OAUTH_STORE_VERSION = 1;
const MCP_OAUTH_REDIRECT_URI = "http://127.0.0.1:35017/hlvm/oauth/callback";
const ACCESS_TOKEN_SKEW_MS = 60_000;
const OAUTH_CALLBACK_WAIT_TIMEOUT_MS = 120_000;

interface OAuthAuthorizationServerMetadata {
  issuer?: string;
  authorization_endpoint?: string;
  token_endpoint?: string;
  registration_endpoint?: string;
  code_challenge_methods_supported?: string[];
}

interface OAuthTokenResponse {
  access_token: string;
  token_type?: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
}

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

interface ParsedMetadata {
  authorizationServer: string;
  authorizationEndpoint: string;
  tokenEndpoint: string;
  registrationEndpoint?: string;
  scopesSupported: string[];
  resource: string;
}

interface OAuthClientRegistration {
  clientId: string;
  clientSecret?: string;
  registrationClientUri?: string;
  registrationAccessToken?: string;
}

export interface McpOAuthLoginOptions {
  output?: (line: string) => void;
  promptInput?: (message: string) => Promise<string>;
  openBrowser?: (url: string) => Promise<void>;
}

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

function getStorePath(): string {
  const override = getPlatform().env.get("HLVM_MCP_OAUTH_PATH");
  if (override) return override;
  return getMcpOAuthPath();
}

async function loadStore(): Promise<McpOAuthStore> {
  const platform = getPlatform();
  try {
    const raw = await platform.fs.readTextFile(getStorePath());
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

async function saveStore(store: McpOAuthStore): Promise<void> {
  const payload = JSON.stringify(store, null, 2) + "\n";
  const path = getStorePath();
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

async function upsertRecord(record: McpOAuthRecord): Promise<void> {
  const store = await loadStore();
  const idx = store.records.findIndex((r) => r.key === record.key);
  if (idx === -1) {
    store.records.push(record);
  } else {
    store.records[idx] = record;
  }
  await saveStore(store);
}

async function removeRecordByKey(key: string): Promise<boolean> {
  const store = await loadStore();
  const next = store.records.filter((r) => r.key !== key);
  if (next.length === store.records.length) return false;
  store.records = next;
  await saveStore(store);
  return true;
}

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

function randomBase64Url(size: number): string {
  const bytes = crypto.getRandomValues(new Uint8Array(size));
  return bytesToBase64Url(bytes);
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let raw = "";
  for (let i = 0; i < bytes.length; i++) raw += String.fromCharCode(bytes[i]);
  return btoa(raw).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

async function pkceChallenge(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(verifier),
  );
  return bytesToBase64Url(new Uint8Array(digest));
}

function toFormUrlEncoded(params: Record<string, string>): string {
  const encoded = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) encoded.set(k, v);
  return encoded.toString();
}

async function readResponseBody(response: Response): Promise<string> {
  try {
    return await response.text();
  } catch {
    return "";
  }
}

function parseTokenResponse(payload: unknown): OAuthTokenResponse {
  if (!isObjectValue(payload) || typeof payload.access_token !== "string") {
    throw new ValidationError(
      "OAuth token response missing access_token",
      "mcp_oauth",
    );
  }
  const token = payload as Record<string, unknown>;
  return {
    access_token: token.access_token as string,
    token_type: typeof token.token_type === "string"
      ? token.token_type
      : undefined,
    refresh_token: typeof token.refresh_token === "string"
      ? token.refresh_token
      : undefined,
    expires_in: typeof token.expires_in === "number"
      ? token.expires_in
      : undefined,
    scope: typeof token.scope === "string" ? token.scope : undefined,
  };
}

function applyTokenResponse(
  record: McpOAuthRecord,
  token: OAuthTokenResponse,
): McpOAuthRecord {
  const expiresAt = typeof token.expires_in === "number"
    ? new Date(Date.now() + token.expires_in * 1000).toISOString()
    : record.expiresAt;
  return {
    ...record,
    accessToken: token.access_token,
    tokenType: token.token_type ?? record.tokenType,
    refreshToken: token.refresh_token ?? record.refreshToken,
    scope: token.scope ?? record.scope,
    expiresAt,
    updatedAt: new Date().toISOString(),
  };
}

function selectScopes(
  challenge: ParsedBearerChallenge | null,
  metadataScopes: string[],
): string | undefined {
  const challengeScope = challenge?.params.scope?.trim();
  if (challengeScope) return challengeScope;
  if (metadataScopes.includes("offline_access")) return "offline_access";
  return undefined;
}

function tokenExchangeParams(
  record: McpOAuthRecord,
  fields: Record<string, string>,
): Record<string, string> {
  const params: Record<string, string> = {
    client_id: record.clientId,
    resource: record.resource ?? record.serverUrl,
    ...fields,
  };
  if (record.clientSecret) {
    params.client_secret = record.clientSecret;
  }
  return params;
}

async function exchangeAuthorizationCode(
  record: McpOAuthRecord,
  code: string,
  codeVerifier: string,
  redirectUri: string,
): Promise<OAuthTokenResponse> {
  const response = await http.fetchRaw(record.tokenEndpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: toFormUrlEncoded(
      tokenExchangeParams(record, {
        grant_type: "authorization_code",
        code,
        redirect_uri: redirectUri,
        code_verifier: codeVerifier,
      }),
    ),
  });
  if (!response.ok) {
    const body = await readResponseBody(response);
    throw new ValidationError(
      `OAuth token exchange failed (${response.status}): ${
        body || response.statusText
      }`,
      "mcp_oauth",
    );
  }
  const payload = await response.json();
  return parseTokenResponse(payload);
}

async function refreshAccessToken(
  record: McpOAuthRecord,
): Promise<McpOAuthRecord | null> {
  if (!record.refreshToken) return null;
  try {
    const response = await http.fetchRaw(record.tokenEndpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body: toFormUrlEncoded(
        tokenExchangeParams(record, {
          grant_type: "refresh_token",
          refresh_token: record.refreshToken,
        }),
      ),
    });
    if (!response.ok) {
      getAgentLogger().warn(
        `MCP OAuth refresh failed (${record.serverName}): HTTP ${response.status}`,
      );
      return null;
    }
    const payload = await response.json();
    const token = parseTokenResponse(payload);
    const next = applyTokenResponse(record, token);
    await upsertRecord(next);
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

async function fetchProtectedResourceMetadata(
  serverUrl: string,
  challenge: ParsedBearerChallenge | null,
): Promise<{
  authorizationServers: string[];
  scopesSupported: string[];
  resource: string;
}> {
  const resourceMetadata = challenge?.params.resource_metadata;
  const requestedResource = challenge?.params.resource ?? serverUrl;
  const metadataUrl = resourceMetadata
    ? new URL(resourceMetadata)
    : new URL("/.well-known/oauth-protected-resource", new URL(serverUrl));
  if (!metadataUrl.searchParams.has("resource")) {
    metadataUrl.searchParams.set("resource", requestedResource);
  }
  const response = await http.fetchRaw(metadataUrl.toString(), {
    method: "GET",
    headers: { Accept: "application/json" },
  });
  if (!response.ok) {
    throw new ValidationError(
      `OAuth discovery failed (${response.status}) fetching protected resource metadata`,
      "mcp_oauth",
    );
  }
  const payload = await response.json();
  if (!isObjectValue(payload)) {
    throw new ValidationError(
      "OAuth protected resource metadata is invalid",
      "mcp_oauth",
    );
  }
  const meta = payload as Record<string, unknown>;
  const rawAuthorizationServers = meta.authorization_servers;
  const authorizationServers = Array.isArray(rawAuthorizationServers)
    ? rawAuthorizationServers.filter((s): s is string =>
      typeof s === "string" && s.length > 0
    )
    : [];
  if (authorizationServers.length === 0) {
    throw new ValidationError(
      "OAuth protected resource metadata missing authorization_servers",
      "mcp_oauth",
    );
  }
  const rawScopes = meta.scopes_supported;
  const scopesSupported = Array.isArray(rawScopes)
    ? rawScopes.filter((s): s is string =>
      typeof s === "string" && s.length > 0
    )
    : [];
  const resource = typeof meta.resource === "string" && meta.resource.length > 0
    ? meta.resource
    : requestedResource;
  return { authorizationServers, scopesSupported, resource };
}

async function fetchAuthorizationServerMetadata(
  authorizationServer: string,
): Promise<OAuthAuthorizationServerMetadata> {
  const issuer = authorizationServer.replace(/\/+$/, "");
  const candidates = [
    `${issuer}/.well-known/oauth-authorization-server`,
    `${issuer}/.well-known/openid-configuration`,
  ];
  let lastStatus = 0;
  for (const url of candidates) {
    const response = await http.fetchRaw(url, {
      method: "GET",
      headers: { Accept: "application/json" },
    });
    if (!response.ok) {
      lastStatus = response.status;
      continue;
    }
    const payload = await response.json();
    if (!isObjectValue(payload)) continue;
    return payload as OAuthAuthorizationServerMetadata;
  }
  throw new ValidationError(
    `OAuth discovery failed: no authorization server metadata (${
      lastStatus || "no response"
    })`,
    "mcp_oauth",
  );
}

async function discoverMetadata(
  serverUrl: string,
  challenge: ParsedBearerChallenge | null,
): Promise<ParsedMetadata> {
  const protectedResource = await fetchProtectedResourceMetadata(
    serverUrl,
    challenge,
  );
  const authorizationServer = protectedResource.authorizationServers[0];
  const authMetadata = await fetchAuthorizationServerMetadata(
    authorizationServer,
  );
  const authorizationEndpoint = authMetadata.authorization_endpoint;
  const tokenEndpoint = authMetadata.token_endpoint;
  if (!authorizationEndpoint || !tokenEndpoint) {
    throw new ValidationError(
      "OAuth authorization server metadata missing required endpoints",
      "mcp_oauth",
    );
  }
  const challengeMethods = authMetadata.code_challenge_methods_supported;
  if (Array.isArray(challengeMethods) && challengeMethods.length > 0) {
    const supportsS256 = challengeMethods.includes("S256");
    if (!supportsS256) {
      throw new ValidationError(
        "OAuth authorization server does not advertise PKCE S256 support",
        "mcp_oauth",
      );
    }
  }
  return {
    authorizationServer,
    authorizationEndpoint,
    tokenEndpoint,
    registrationEndpoint: authMetadata.registration_endpoint,
    scopesSupported: protectedResource.scopesSupported,
    resource: protectedResource.resource,
  };
}

async function registerPublicClient(
  registrationEndpoint: string,
): Promise<OAuthClientRegistration> {
  const response = await http.fetchRaw(registrationEndpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      client_name: "HLVM MCP Client",
      application_type: "native",
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      redirect_uris: [MCP_OAUTH_REDIRECT_URI],
      token_endpoint_auth_method: "none",
    }),
  });
  if (!response.ok) {
    const body = await readResponseBody(response);
    throw new ValidationError(
      `OAuth dynamic registration failed (${response.status}): ${
        body || response.statusText
      }`,
      "mcp_oauth",
    );
  }
  const payload = await response.json();
  if (!isObjectValue(payload) || typeof payload.client_id !== "string") {
    throw new ValidationError(
      "OAuth dynamic registration response missing client_id",
      "mcp_oauth",
    );
  }
  const p = payload as Record<string, unknown>;
  return {
    clientId: p.client_id as string,
    clientSecret: typeof p.client_secret === "string"
      ? p.client_secret
      : undefined,
    registrationClientUri: typeof p.registration_client_uri === "string"
      ? p.registration_client_uri
      : undefined,
    registrationAccessToken: typeof p.registration_access_token === "string"
      ? p.registration_access_token
      : undefined,
  };
}

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

  const challenge = null;
  const metadata = await discoverMetadata(server.url, challenge);
  const key = getServerKey(server);
  if (!key) {
    throw new ValidationError(
      `Invalid MCP server URL: ${server.url}`,
      "mcp_oauth",
    );
  }

  const existing = findRecord(await loadStore(), server);
  const reusableClient = existing &&
      existing.authorizationServer === metadata.authorizationServer &&
      existing.tokenEndpoint === metadata.tokenEndpoint
    ? {
      clientId: existing.clientId,
      clientSecret: existing.clientSecret,
      registrationClientUri: existing.registrationClientUri,
      registrationAccessToken: existing.registrationAccessToken,
    }
    : null;

  const staticClientId = getPlatform().env.get("HLVM_MCP_OAUTH_CLIENT_ID");
  const registration = reusableClient ??
    (metadata.registrationEndpoint
      ? await registerPublicClient(metadata.registrationEndpoint)
      : (staticClientId ? { clientId: staticClientId } : null));

  if (!registration) {
    throw new ValidationError(
      "OAuth login requires either dynamic client registration support or HLVM_MCP_OAUTH_CLIENT_ID",
      "mcp_oauth",
    );
  }

  const codeVerifier = randomBase64Url(48);
  const challengeValue = await pkceChallenge(codeVerifier);
  const state = randomBase64Url(24);
  const scope = selectScopes(null, metadata.scopesSupported);

  const authorizationUrl = new URL(metadata.authorizationEndpoint);
  authorizationUrl.searchParams.set("response_type", "code");
  authorizationUrl.searchParams.set("client_id", registration.clientId);
  authorizationUrl.searchParams.set("redirect_uri", MCP_OAUTH_REDIRECT_URI);
  authorizationUrl.searchParams.set("code_challenge", challengeValue);
  authorizationUrl.searchParams.set("code_challenge_method", "S256");
  authorizationUrl.searchParams.set("state", state);
  authorizationUrl.searchParams.set("resource", metadata.resource);
  if (scope) authorizationUrl.searchParams.set("scope", scope);

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

  const provisionalRecord: McpOAuthRecord = {
    key,
    serverName: server.name,
    serverUrl: server.url,
    resource: metadata.resource,
    authorizationServer: metadata.authorizationServer,
    authorizationEndpoint: metadata.authorizationEndpoint,
    tokenEndpoint: metadata.tokenEndpoint,
    registrationEndpoint: metadata.registrationEndpoint,
    clientId: registration.clientId,
    clientSecret: registration.clientSecret,
    registrationClientUri: registration.registrationClientUri,
    registrationAccessToken: registration.registrationAccessToken,
    accessToken: "",
    updatedAt: new Date().toISOString(),
  };

  const token = await exchangeAuthorizationCode(
    provisionalRecord,
    code,
    codeVerifier,
    MCP_OAUTH_REDIRECT_URI,
  );
  const finalRecord = applyTokenResponse(
    {
      ...provisionalRecord,
      accessToken: token.access_token,
      tokenType: token.token_type,
      refreshToken: token.refresh_token,
      scope: token.scope,
    },
    token,
  );
  await upsertRecord(finalRecord);
  output(`OAuth login complete for MCP server '${server.name}'.`);
}

export async function getMcpOAuthAuthorizationHeader(
  server: McpServerConfig,
): Promise<string | null> {
  const store = await loadStore();
  const record = findRecord(store, server);
  if (!record) return null;

  let activeRecord = record;
  if (tokenNeedsRefresh(record)) {
    const refreshed = await refreshAccessToken(record);
    if (!refreshed) {
      await removeRecordByKey(record.key);
      return null;
    }
    activeRecord = refreshed;
  }

  return buildBearerHeader(activeRecord);
}

export async function recoverMcpOAuthFromUnauthorized(
  server: McpServerConfig,
  wwwAuthenticateHeader: string | null,
): Promise<boolean> {
  const challenge = parseBearerChallengeHeader(wwwAuthenticateHeader);
  if (!challenge) return false;

  const store = await loadStore();
  const record = findRecord(store, server);
  if (!record) return false;

  if (!record.refreshToken) {
    return false;
  }
  const refreshed = await refreshAccessToken(record);
  if (!refreshed) {
    await removeRecordByKey(record.key);
    return false;
  }
  return true;
}

export async function logoutMcpHttpServer(
  server: McpServerConfig,
): Promise<boolean> {
  const key = getServerKey(server);
  if (!key) return false;
  return await removeRecordByKey(key);
}
