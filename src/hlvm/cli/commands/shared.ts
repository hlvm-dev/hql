import { log } from "../../api/log.ts";
import {
  basename,
  platformCwd,
  platformExit,
  platformGetEnv,
} from "../utils/platform-helpers.ts";

// Shared URL constants
export const OLLAMA_SETTINGS_URL = "https://ollama.com/settings";

// Pre-compiled patterns for sanitizePackageName
const NON_ALPHANUMERIC_HYPHEN_REGEX = /[^a-z0-9-]/g;
const MULTIPLE_HYPHEN_REGEX = /-+/g;
const LEADING_TRAILING_HYPHEN_REGEX = /^-|-$/g;

// Pre-compiled semver validation pattern (exported for reuse)
export const SEMVER_REGEX = /^\d+\.\d+\.\d+$/;

/**
 * Generate smart default package name from directory and username
 */
export function generateDefaultPackageName(): string {
  const cwd = platformCwd();
  const dirName = basename(cwd);
  const username = platformGetEnv("USER") || platformGetEnv("USERNAME") ||
    "user";

  // Sanitize directory name (replace spaces/special chars with hyphens)
  const sanitizedDirName = dirName
    .toLowerCase()
    .replace(NON_ALPHANUMERIC_HYPHEN_REGEX, "-")
    .replace(MULTIPLE_HYPHEN_REGEX, "-")
    .replace(LEADING_TRAILING_HYPHEN_REGEX, "");

  return `@${username}/${sanitizedDirName}`;
}

/**
 * Validate package name format
 * @throws {Error} If package name is invalid
 */
export function validatePackageName(name: string): void {
  if (!name.startsWith("@") || !name.includes("/")) {
    log.raw.error(`\n❌ Invalid package name format: ${name}`);
    log.raw.error(`Expected format: @username/package-name`);
    log.raw.error(`Example: @john/my-lib`);
    platformExit(1);
  }
}

/**
 * Validate version format (semver)
 * @throws {Error} If version is invalid
 */
export function validateVersion(version: string): void {
  if (!SEMVER_REGEX.test(version)) {
    log.raw.error(`\n❌ Invalid version format: ${version}`);
    log.raw.error(`Expected format: X.Y.Z (e.g., 0.0.1)`);
    platformExit(1);
  }
}
