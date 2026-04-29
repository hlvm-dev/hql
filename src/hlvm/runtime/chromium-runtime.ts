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
import { getRuntimeDir } from "../../common/paths.ts";
import { getPlatform } from "../../platform/platform.ts";
import { BootstrapError } from "../agent/error-taxonomy.ts";

// ── Paths ────────────────────────────────────────────────────────────────

const CHROMIUM_DIR_NAME = "chromium";

/** Root directory for HLVM-managed Chromium: ~/.hlvm/.runtime/chromium/ */
function getChromiumDir(): string {
  return getPlatform().path.join(getRuntimeDir(), CHROMIUM_DIR_NAME);
}

function configurePlaywrightBrowsersPath(chromiumDir = getChromiumDir()): void {
  getPlatform().env.set("PLAYWRIGHT_BROWSERS_PATH", chromiumDir);
}

/**
 * Resolve the Chromium executable for the revision expected by the installed
 * playwright-core. Returns null when the expected revision is missing — which
 * forces a fresh download instead of launching a stale binary against a newer
 * Playwright (that mismatch hangs browser launch indefinitely).
 */
export async function resolveChromiumExecutablePath(
  platform = getPlatform(),
): Promise<string | null> {
  const chromiumDir = getChromiumDir();
  configurePlaywrightBrowsersPath(chromiumDir);
  if (!await platform.fs.exists(chromiumDir)) return null;

  try {
    const { registry } = await import("playwright-core/lib/server");
    const entry = registry.findExecutable("chromium");
    const execPath = entry?.executablePath?.();
    if (!execPath) return null;
    if (!await platform.fs.exists(execPath)) return null;
    return execPath;
  } catch (error) {
    log.debug?.(
      `Failed to resolve Chromium via playwright-core registry: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    return null;
  }
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
  configurePlaywrightBrowsersPath(chromiumDir);

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
      throw new BootstrapError(
        `Failed to download Chromium: ${fallbackStderr}`,
        "engine_download",
      );
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
  const digest = await crypto.subtle.digest(
    "SHA-256",
    bytes as Uint8Array<ArrayBuffer>,
  );
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
