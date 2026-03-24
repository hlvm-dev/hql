/**
 * Claude Code Subscription Auth
 *
 * Reads OAuth credentials from the Claude Code CLI's credential store.
 * On macOS: macOS Keychain ("Claude Code-credentials")
 * Fallback: ~/.claude/.credentials.json
 *
 * Returns the access token for Bearer auth against the Anthropic API.
 */

import { getPlatform } from "../../../platform/platform.ts";
import { RuntimeError } from "../../../common/error.ts";

interface ClaudeOAuthCredentials {
  claudeAiOauth?: {
    accessToken: string;
    refreshToken?: string;
    expiresAt?: string;
  };
}

let cachedToken: string | null = null;
let tokenFetchTime = 0;
const TOKEN_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Read the OAuth access token from the Claude Code credential store.
 * Priority: env var CLAUDE_CODE_TOKEN > macOS Keychain > filesystem fallback.
 * Token is cached for 5 minutes to allow periodic refresh detection.
 */
export async function getClaudeCodeToken(): Promise<string> {
  // Re-fetch token if cache is older than 5 minutes
  const now = Date.now();
  if (cachedToken && (now - tokenFetchTime) < TOKEN_CACHE_TTL_MS) {
    return cachedToken;
  }

  const platform = getPlatform();

  // 1. Explicit env var override
  const envToken = platform.env.get("CLAUDE_CODE_TOKEN");
  if (envToken) {
    cachedToken = envToken;
    tokenFetchTime = now;
    return envToken;
  }

  // 2. macOS Keychain (primary store on macOS)
  if (platform.build.os === "darwin") {
    const token = await readFromKeychain();
    if (token) {
      cachedToken = token;
      tokenFetchTime = now;
      return token;
    }
  }

  // 3. Filesystem fallback (~/.claude/.credentials.json)
  const token = await readFromFilesystem(platform);
  if (token) {
    cachedToken = token;
    tokenFetchTime = now;
    return token;
  }

  throw new RuntimeError(
    "Claude Code OAuth token not found. Run `claude login` first to authenticate with your Max subscription.",
  );
}

/** Clear cached token (e.g., after auth failure for retry) */
export function clearTokenCache(): void {
  cachedToken = null;
  tokenFetchTime = 0;
}

async function readFromKeychain(): Promise<string | null> {
  try {
    const platform = getPlatform();
    const result = await platform.command.output({
      cmd: ["security", "find-generic-password", "-s", "Claude Code-credentials", "-w"],
      stdout: "piped",
      stderr: "piped",
    });
    if (!result.success) return null;

    const raw = new TextDecoder().decode(result.stdout).trim();
    if (!raw) return null;

    const creds: ClaudeOAuthCredentials = JSON.parse(raw);
    return creds.claudeAiOauth?.accessToken ?? null;
  } catch {
    return null;
  }
}

async function readFromFilesystem(
  platform: ReturnType<typeof getPlatform>,
): Promise<string | null> {
  try {
    const home = platform.env.get("HOME") ?? platform.env.get("USERPROFILE") ?? "";
    const credPath = `${home}/.claude/.credentials.json`;

    const data = await platform.fs.readFile(credPath);
    const text = new TextDecoder().decode(data);
    const creds: ClaudeOAuthCredentials = JSON.parse(text);
    return creds.claudeAiOauth?.accessToken ?? null;
  } catch {
    return null;
  }
}
