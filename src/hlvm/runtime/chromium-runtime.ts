/**
 * Chromium Runtime Manager for HLVM
 *
 * Handles download, verification, and path resolution for the Chromium browser
 * used by Playwright-based browser automation (pw_* tools).
 *
 * At bootstrap time, downloads Chromium (~200 MB) from the Playwright CDN.
 *
 * Runtime directory: ~/.hlvm/.runtime/chromium/
 */

import { log } from "../api/log.ts";
import { ensureRuntimeDir, getRuntimeDir } from "../../common/paths.ts";
import { getPlatform } from "../../platform/platform.ts";

// ── Paths ────────────────────────────────────────────────────────────────

const CHROMIUM_DIR_NAME = "chromium";

/** Root directory for HLVM-managed Chromium: ~/.hlvm/.runtime/chromium/ */
export function getChromiumDir(): string {
  return getPlatform().path.join(getRuntimeDir(), CHROMIUM_DIR_NAME);
}

/**
 * Find the Chromium executable inside the managed directory.
 *
 * Playwright's layout (as of v1.50+):
 *   macOS:   chromium-<rev>/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing
 *   Linux:   chromium-<rev>/chrome-linux/chrome
 *   Windows: chromium-<rev>/chrome-win/chrome.exe
 *
 * Recursively searches for known executable names.
 */
export async function resolveChromiumExecutablePath(
  platform = getPlatform(),
): Promise<string | null> {
  const chromiumDir = getChromiumDir();
  if (!await platform.fs.exists(chromiumDir)) return null;

  const os = platform.build.os;

  // Use `find` to locate the executable — Playwright's directory structure
  // varies by version and platform, so scanning is more reliable than hardcoding.
  if (os === "darwin") {
    // Look for the .app bundle's main executable
    try {
      const result = await platform.command.output({
        cmd: [
          "find", chromiumDir,
          "-path", "*/Contents/MacOS/Google Chrome for Testing",
          "-type", "f",
        ],
        stdin: "null",
        stdout: "piped",
        stderr: "piped",
      });
      const stdout = new TextDecoder().decode(result.stdout).trim();
      if (stdout) return stdout.split("\n")[0];
    } catch { /* fall through */ }

    // Legacy: Chromium.app (older Playwright versions)
    try {
      const result = await platform.command.output({
        cmd: [
          "find", chromiumDir,
          "-path", "*/Contents/MacOS/Chromium",
          "-type", "f",
        ],
        stdin: "null",
        stdout: "piped",
        stderr: "piped",
      });
      const stdout = new TextDecoder().decode(result.stdout).trim();
      if (stdout) return stdout.split("\n")[0];
    } catch { /* fall through */ }
  } else {
    // Linux/Windows: look for chrome or chrome.exe
    const binName = os === "windows" ? "chrome.exe" : "chrome";
    try {
      const result = await platform.command.output({
        cmd: ["find", chromiumDir, "-name", binName, "-type", "f"],
        stdin: "null",
        stdout: "piped",
        stderr: "piped",
      });
      const stdout = new TextDecoder().decode(result.stdout).trim();
      if (stdout) {
        // Pick the shortest path (main binary, not helpers)
        const paths = stdout.split("\n").filter(Boolean);
        paths.sort((a, b) => a.length - b.length);
        return paths[0];
      }
    } catch { /* fall through */ }
  }

  return null;
}

/** Quick check: is a usable Chromium binary available? */
export async function isChromiumReady(
  platform = getPlatform(),
): Promise<boolean> {
  return (await resolveChromiumExecutablePath(platform)) !== null;
}

// ── Download (standard install) ──────────────────────────────────────────

/**
 * Download Chromium using playwright-core's browser registry.
 * Sets PLAYWRIGHT_BROWSERS_PATH so Chromium lands in our managed directory.
 *
 * Falls back to npx playwright-core install if the programmatic API
 * has Node-specific issues in Deno.
 */
export async function downloadChromium(
  onProgress?: (message: string) => void,
): Promise<void> {
  const platform = getPlatform();
  const chromiumDir = getChromiumDir();
  await platform.fs.mkdir(chromiumDir, { recursive: true });

  onProgress?.("Downloading Chromium (~200 MB)...");
  log.info?.(`Downloading Chromium to ${chromiumDir}`);

  // Set PLAYWRIGHT_BROWSERS_PATH so playwright-core installs into our dir
  platform.env.set("PLAYWRIGHT_BROWSERS_PATH", chromiumDir);

  // Use npx playwright-core install chromium (most reliable cross-runtime).
  // NOTE: Do NOT pass an explicit `env` — Deno.Command replaces the entire
  // environment when `env` is set, stripping PATH/HOME and breaking npx/deno.
  // The platform.env.set() above inherits into child processes automatically.
  const result = await platform.command.output({
    cmd: ["npx", "playwright-core", "install", "chromium"],
    stdin: "null",
    stdout: "piped",
    stderr: "piped",
  });

  const stderr = new TextDecoder().decode(result.stderr).trim();
  if (!result.success) {
    // Fallback: try with deno run
    log.debug?.(`npx playwright-core install failed: ${stderr}. Trying deno run...`);
    const fallbackResult = await platform.command.output({
      cmd: [
        "deno", "run", "-A",
        "npm:playwright-core", "install", "chromium",
      ],
      stdin: "null",
      stdout: "piped",
      stderr: "piped",
    });

    if (!fallbackResult.success) {
      const fallbackStderr = new TextDecoder().decode(fallbackResult.stderr).trim();
      throw new Error(`Failed to download Chromium: ${fallbackStderr}`);
    }
  }

  // Make executable
  const execPath = await resolveChromiumExecutablePath(platform);
  if (execPath) {
    try {
      await platform.fs.chmod(execPath, 0o755);
    } catch { /* best-effort */ }
  }

  onProgress?.("Chromium downloaded successfully.");
  log.info?.(`Chromium installed to ${chromiumDir}`);
}

// ── Hash ─────────────────────────────────────────────────────────────────

/** SHA-256 hash of the Chromium binary for manifest verification. */
export async function hashChromiumBinary(
  platform = getPlatform(),
): Promise<string | null> {
  const execPath = await resolveChromiumExecutablePath(platform);
  if (!execPath) return null;

  const bytes = await platform.fs.readFile(execPath);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
