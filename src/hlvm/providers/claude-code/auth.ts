/**
 * Claude Code Subscription Auth
 *
 * Reads OAuth credentials from the Claude Code CLI's credential store.
 * On macOS: macOS Keychain ("Claude Code-credentials")
 * Fallback: ~/.claude/.credentials.json
 *
 * Automatically refreshes expired tokens using the stored refresh token,
 * matching the same flow as the Claude Code CLI itself.
 *
 * Returns the access token for Bearer auth against the Anthropic API.
 */

import { getPlatform } from "../../../platform/platform.ts";
import { RuntimeError } from "../../../common/error.ts";
import { ProviderErrorCode } from "../../../common/error-codes.ts";
import { http } from "../../../common/http-client.ts";
import { DEFAULT_CLAUDE_CODE_OAUTH_TOKEN_ENDPOINT } from "../../../common/config/types.ts";

// Claude Code OAuth constants (mirrors Claude Code CLI)
const OAUTH_TOKEN_ENDPOINT = DEFAULT_CLAUDE_CODE_OAUTH_TOKEN_ENDPOINT;
const OAUTH_CLIENT_ID = "9d1c250a-e61b-44d9-88ed-5944d1962f5e";
const TOKEN_EXPIRY_BUFFER_MS = 5 * 60 * 1000; // refresh 5 min before actual expiry
const TOKEN_CACHE_TTL_MS = 5 * 60 * 1000; // re-read from store every 5 min

interface ClaudeAiOAuth {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: number;
  scopes?: string[];
  subscriptionType?: string;
  rateLimitTier?: string;
}

interface ClaudeCredentials {
  claudeAiOauth?: ClaudeAiOAuth;
  [key: string]: unknown; // preserve mcpOAuth and other data
}

let cachedToken: string | null = null;
let cachedCredentials: ClaudeCredentials | null = null;
let tokenFetchTime = 0;
let forceNextRefresh = false;

type Platform = ReturnType<typeof getPlatform>;

/**
 * Read the OAuth access token from the Claude Code credential store.
 * Priority: env var CLAUDE_CODE_TOKEN > macOS Keychain > filesystem fallback.
 * Automatically refreshes expired tokens using the stored refresh token.
 * Token is cached for 5 minutes to allow periodic refresh detection.
 */
export async function getClaudeCodeToken(): Promise<string> {
  const now = Date.now();
  if (cachedToken && (now - tokenFetchTime) < TOKEN_CACHE_TTL_MS) {
    // Even when cached, proactively refresh if token is about to expire
    if (cachedCredentials && isTokenExpired(cachedCredentials)) {
      return await refreshAndCache(cachedCredentials);
    }
    return cachedToken;
  }

  const platform = getPlatform();

  // 1. Explicit env var override (no refresh needed)
  const envToken = platform.env.get("CLAUDE_CODE_TOKEN");
  if (envToken) {
    cachedToken = envToken;
    tokenFetchTime = now;
    return envToken;
  }

  // 2. Read full credentials (Keychain → filesystem)
  let creds = await readFullCredentials(platform);
  if (!creds?.claudeAiOauth?.accessToken) {
    throw new RuntimeError(
      "Claude Code OAuth token not found. Run `claude login` first to authenticate with your Max subscription.",
      { code: ProviderErrorCode.AUTH_FAILED },
    );
  }

  // 3. Auto-refresh if expired, about to expire, or forced (e.g., after 401)
  const needsRefresh = forceNextRefresh || isTokenExpired(creds);
  forceNextRefresh = false;
  if (needsRefresh && creds.claudeAiOauth?.refreshToken) {
    creds = await refreshOAuthToken(creds, platform);
  }

  const token = creds.claudeAiOauth!.accessToken;
  cachedToken = token;
  cachedCredentials = creds;
  tokenFetchTime = Date.now();
  return token;
}

/** Clear cached token and force refresh on next read (e.g., after 401/403) */
export function clearTokenCache(): void {
  cachedToken = null;
  cachedCredentials = null;
  tokenFetchTime = 0;
  forceNextRefresh = true;
}

// ── Token expiry check ──

function isTokenExpired(creds: ClaudeCredentials): boolean {
  const expiresAt = creds.claudeAiOauth?.expiresAt;
  if (!expiresAt) return false; // no expiry info — assume valid
  return Date.now() >= expiresAt - TOKEN_EXPIRY_BUFFER_MS;
}

// ── Token refresh ──

async function refreshAndCache(creds: ClaudeCredentials): Promise<string> {
  const platform = getPlatform();
  const updated = await refreshOAuthToken(creds, platform);
  const token = updated.claudeAiOauth!.accessToken;
  cachedToken = token;
  cachedCredentials = updated;
  tokenFetchTime = Date.now();
  return token;
}

async function refreshOAuthToken(
  creds: ClaudeCredentials,
  platform: Platform,
): Promise<ClaudeCredentials> {
  const refreshToken = creds.claudeAiOauth?.refreshToken;
  if (!refreshToken) {
    throw new RuntimeError(
      "OAuth token expired and no refresh token available. Run `claude login` to re-authenticate.",
      { code: ProviderErrorCode.AUTH_FAILED },
    );
  }

  // Token refresh is silent — errors surface as RuntimeError to caller

  const response = await http.fetchRaw(OAUTH_TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: OAUTH_CLIENT_ID,
    }),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new RuntimeError(
      `OAuth token refresh failed (${response.status}). ${body ? body + " " : ""}Run \`claude login\` to re-authenticate.`,
      { code: ProviderErrorCode.AUTH_FAILED },
    );
  }

  const tokens = await response.json() as {
    access_token: string;
    refresh_token?: string;
    expires_in: number;
    scope?: string;
  };

  const updated: ClaudeCredentials = {
    ...creds,
    claudeAiOauth: {
      ...creds.claudeAiOauth!,
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token ?? refreshToken,
      expiresAt: Date.now() + tokens.expires_in * 1000,
      ...(tokens.scope ? { scopes: tokens.scope.split(" ") } : {}),
    },
  };

  // Persist refreshed credentials back to store (best-effort)
  await writeCredentials(updated, platform);
  // Refreshed credentials persisted
  return updated;
}

// ── Credential storage readers ──

async function readFullCredentials(
  platform: Platform,
): Promise<ClaudeCredentials | null> {
  if (platform.build.os === "darwin") {
    const creds = await readCredentialsFromKeychain(platform);
    if (creds) return creds;
  }
  return await readCredentialsFromFilesystem(platform);
}

async function readCredentialsFromKeychain(
  platform: Platform,
): Promise<ClaudeCredentials | null> {
  const username = claudeCodeAccount(platform);
  if (username) {
    const creds = await readKeychainEntry(platform, username);
    if (creds) return creds;
  }
  return await readKeychainEntry(platform, null);
}

function claudeCodeAccount(platform: Platform): string | null {
  return platform.env.get("USER") ?? platform.env.get("LOGNAME") ?? null;
}

async function readKeychainEntry(
  platform: Platform,
  account: string | null,
): Promise<ClaudeCredentials | null> {
  try {
    const cmd = [
      "security",
      "find-generic-password",
      "-s",
      "Claude Code-credentials",
      ...(account ? ["-a", account] : []),
      "-w",
    ];
    const result = await platform.command.output({
      cmd,
      stdout: "piped",
      stderr: "piped",
    });
    if (!result.success) return null;
    const raw = new TextDecoder().decode(result.stdout).trim();
    if (!raw) return null;
    return JSON.parse(raw) as ClaudeCredentials;
  } catch {
    return null;
  }
}

async function readCredentialsFromFilesystem(
  platform: Platform,
): Promise<ClaudeCredentials | null> {
  try {
    const home =
      platform.env.get("HOME") ?? platform.env.get("USERPROFILE") ?? "";
    const credPath = `${home}/.claude/.credentials.json`;
    const data = await platform.fs.readFile(credPath);
    const text = new TextDecoder().decode(data);
    return JSON.parse(text) as ClaudeCredentials;
  } catch {
    return null;
  }
}

// ── Credential storage writers ──

async function writeCredentials(
  creds: ClaudeCredentials,
  platform: Platform,
): Promise<void> {
  const json = JSON.stringify(creds);

  if (platform.build.os === "darwin") {
    const account = claudeCodeAccount(platform);
    if (account) {
      try {
        await platform.command.output({
          cmd: [
            "security",
            "add-generic-password",
            "-U",
            "-s",
            "Claude Code-credentials",
            "-a",
            account,
            "-w",
            json,
          ],
          stdout: "piped",
          stderr: "piped",
        });
      } catch {
        /* best effort */
      }
    }
  }

  // Also update filesystem fallback
  try {
    const home =
      platform.env.get("HOME") ?? platform.env.get("USERPROFILE") ?? "";
    const credPath = `${home}/.claude/.credentials.json`;
    await platform.fs.writeFile(credPath, new TextEncoder().encode(json));
  } catch {
    /* best effort */
  }
}
