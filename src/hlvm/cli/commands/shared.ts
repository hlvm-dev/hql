import { getPlatform } from "../../../platform/platform.ts";

const p = () => getPlatform();
const basename = (path: string) => p().path.basename(path);
const platformCwd = () => p().process.cwd();
const platformExit = (code: number) => p().process.exit(code);
const platformGetEnv = (key: string) => p().env.get(key);

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
    console.error(`\n❌ Invalid package name format: ${name}`);
    console.error(`Expected format: @username/package-name`);
    console.error(`Example: @john/my-lib`);
    platformExit(1);
  }
}

/**
 * Validate version format (semver)
 * @throws {Error} If version is invalid
 */
export function validateVersion(version: string): void {
  if (!SEMVER_REGEX.test(version)) {
    console.error(`\n❌ Invalid version format: ${version}`);
    console.error(`Expected format: X.Y.Z (e.g., 0.0.1)`);
    platformExit(1);
  }
}
