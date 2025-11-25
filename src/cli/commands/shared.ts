import {
  basename,
  cwd as platformCwd,
  exit as platformExit,
  getEnv as platformGetEnv,
} from "../../platform/platform.ts";

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
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");

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
  if (!/^\d+\.\d+\.\d+$/.test(version)) {
    console.error(`\n❌ Invalid version format: ${version}`);
    console.error(`Expected format: X.Y.Z (e.g., 0.0.1)`);
    platformExit(1);
  }
}
