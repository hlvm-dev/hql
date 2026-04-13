/**
 * HLVM Update Check Utilities
 *
 * Background version check with 24h cache to avoid hitting GitHub API every launch.
 * Never throws — all failures silently return null.
 */

import { VERSION } from "../../../common/version.ts";
import { compareVersions } from "../publish/utils.ts";
import { http } from "../../../common/http-client.ts";
import { getHlvmDir } from "../../../common/paths.ts";
import {
  join,
  readTextFile,
  writeTextFile,
  platformGetEnv,
  platformOs,
} from "./platform-helpers.ts";
import { DEFAULT_GITHUB_RELEASES_URL } from "../../../common/config/types.ts";

const GITHUB_RELEASES_API = DEFAULT_GITHUB_RELEASES_URL;

const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
const CACHE_FILENAME = "update-check.json";

/** Result of a successful update check. */
export interface UpdateInfo {
  current: string;
  latest: string;
  releaseUrl: string;
  upgradeCommand: string;
}

interface UpdateCache {
  latest: string;
  current: string;
  checked_at: number;
  release_url: string;
}

/** Returns true if `latest` is newer than `current`. */
export function isNewer(latest: string, current: string): boolean {
  return compareVersions(latest, current) > 0;
}

/** Platform-appropriate upgrade command. */
export function getUpgradeCommand(): string {
  const os = platformOs();
  return os === "windows"
    ? "irm hlvm.dev/install.ps1 | iex"
    : "curl -fsSL hlvm.dev/install.sh | sh";
}

/** Fetch the latest release version and URL from GitHub. */
export async function fetchLatestRelease(): Promise<
  { version: string; releaseUrl: string } | null
> {
  const release = await http.get<{ tag_name?: string; html_url?: string }>(
    GITHUB_RELEASES_API,
    {
      headers: {
        Accept: "application/vnd.github.v3+json",
        "User-Agent": "hlvm-cli",
      },
    },
  );
  const version = (release.tag_name || "").replace(/^v/, "");
  if (!version) return null;
  return {
    version,
    releaseUrl: release.html_url ||
      "https://github.com/hlvm-dev/hql/releases/latest",
  };
}

function getCachePath(): string {
  return join(getHlvmDir(), CACHE_FILENAME);
}

async function readCache(): Promise<UpdateCache | null> {
  try {
    return JSON.parse(await readTextFile(getCachePath())) as UpdateCache;
  } catch {
    return null;
  }
}

async function writeCache(cache: UpdateCache): Promise<void> {
  try {
    await writeTextFile(getCachePath(), JSON.stringify(cache, null, 2));
  } catch { /* ignore */ }
}

function buildUpdateInfo(latest: string, releaseUrl: string): UpdateInfo {
  return { current: VERSION, latest, releaseUrl, upgradeCommand: getUpgradeCommand() };
}

/**
 * Check for available updates, using a 24h cache to minimize API calls.
 * Non-blocking, never-throw. Returns null if no update or on error.
 * Opt out with HLVM_NO_UPDATE_CHECK=1.
 */
export async function checkForUpdate(): Promise<UpdateInfo | null> {
  try {
    if (platformGetEnv("HLVM_NO_UPDATE_CHECK") === "1") return null;

    // Serve from cache if valid
    const cache = await readCache();
    if (
      cache &&
      cache.current === VERSION &&
      Date.now() - cache.checked_at < CACHE_TTL_MS
    ) {
      return isNewer(cache.latest, VERSION)
        ? buildUpdateInfo(cache.latest, cache.release_url)
        : null;
    }

    // Fetch fresh
    const release = await fetchLatestRelease();
    if (!release) return null;

    await writeCache({
      latest: release.version,
      current: VERSION,
      checked_at: Date.now(),
      release_url: release.releaseUrl,
    });

    return isNewer(release.version, VERSION)
      ? buildUpdateInfo(release.version, release.releaseUrl)
      : null;
  } catch {
    return null;
  }
}
