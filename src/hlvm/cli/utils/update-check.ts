/**
 * HLVM Update Utilities
 */

import { compareVersions } from "../publish/utils.ts";

export const GITHUB_RELEASES_API = "https://api.github.com/repos/hlvm-dev/hql/releases/latest";

/**
 * Compare semantic versions.
 * Returns true if `latest` is newer than `current`.
 */
export function isNewer(latest: string, current: string): boolean {
  return compareVersions(latest, current) > 0;
}
