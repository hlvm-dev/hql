/**
 * HLVM Update Checker
 *
 * Checks GitHub releases for newer versions and displays update notifications.
 * Caches results for 24 hours to avoid repeated API calls.
 */

import { VERSION } from "../../../version.ts";
import { getPlatform } from "../../../platform/platform.ts";
import { http } from "../../../common/http-client.ts";
import { log } from "../../api/log.ts";

const GITHUB_API = "https://api.github.com/repos/hlvm-dev/hlvm/releases/latest";
const CACHE_FILE = ".update-check";
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

interface UpdateCache {
  checkedAt: number;
  latestVersion: string;
}

/**
 * Check for updates (non-blocking, fails silently).
 * Call this at CLI startup - it won't slow down the CLI.
 */
export async function checkForUpdates(): Promise<void> {
  try {
    const platform = getPlatform();
    const home = platform.env.get("HOME") || platform.env.get("USERPROFILE") || "";
    const hlvmDir = `${home}/.hlvm`;
    const cacheFile = `${hlvmDir}/${CACHE_FILE}`;

    // Check cache first
    try {
      const content = await platform.fs.readTextFile(cacheFile);
      const cached: UpdateCache = JSON.parse(content);

      // Cache is still fresh
      if (Date.now() - cached.checkedAt < CACHE_TTL_MS) {
        if (
          cached.latestVersion !== VERSION &&
          isNewer(cached.latestVersion, VERSION)
        ) {
          showUpdateBanner(cached.latestVersion);
        }
        return;
      }
    } catch {
      // Cache miss or invalid - continue to fetch
    }

    // Fetch latest version from GitHub API (SSOT: use http client)
    try {
      const release = await http.get<{ tag_name?: string }>(GITHUB_API, {
        timeout: 3000, // 3 second timeout
        headers: {
          "Accept": "application/vnd.github.v3+json",
          "User-Agent": "hlvm-cli",
        },
      });

      const latestVersion = (release.tag_name || "").replace(/^v/, "");

      if (!latestVersion) return;

      // Save to cache
      try {
        await platform.fs.mkdir(hlvmDir, { recursive: true });
        await platform.fs.writeTextFile(
          cacheFile,
          JSON.stringify({
            checkedAt: Date.now(),
            latestVersion,
          } as UpdateCache),
        );
      } catch {
        // Cache write failed - non-fatal
      }

      // Show banner if update available
      if (latestVersion !== VERSION && isNewer(latestVersion, VERSION)) {
        showUpdateBanner(latestVersion);
      }
    } catch {
      // Network error or timeout - silent fail
    }
  } catch {
    // Silent fail - don't break CLI for update check issues
  }
}

/**
 * Compare semantic versions.
 * Returns true if `latest` is newer than `current`.
 */
export function isNewer(latest: string, current: string): boolean {
  return compareVersions(latest, current) > 0;
}

/**
 * Compare two semver strings.
 * Returns -1 if a < b, 0 if a == b, 1 if a > b.
 */
function compareVersions(a: string, b: string): number {
  const pa = a.split(".").map((n) => parseInt(n, 10) || 0);
  const pb = b.split(".").map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] || 0) < (pb[i] || 0)) return -1;
    if ((pa[i] || 0) > (pb[i] || 0)) return 1;
  }
  return 0;
}

/**
 * Display update notification banner to stderr.
 */
function showUpdateBanner(latestVersion: string): void {
  log.raw.error("");
  log.raw.error(`  Update available: ${VERSION} -> ${latestVersion}`);
  log.raw.error(`  Run: hlvm upgrade`);
  log.raw.error("");
}
