/**
 * Chromium Runtime Manager for HLVM
 *
 * Handles download, extraction, and verification of a bundled Chromium browser
 * for Playwright-based browser automation. Follows the same sidecar pattern as
 * the Ollama engine + Gemma model in ai-runtime.ts.
 *
 * Two install paths:
 *   Standard:    hlvm bootstrap → download Chromium (~200 MB) from Playwright CDN
 *   Full bundle: sidecar tarball (hlvm-chromium.tar) → extract locally, no download
 *
 * Runtime directory: ~/.hlvm/.runtime/chromium/
 */

import { log } from "../api/log.ts";
import { ensureRuntimeDir, getRuntimeDir } from "../../common/paths.ts";
import { getPlatform } from "../../platform/platform.ts";

// ── Paths ────────────────────────────────────────────────────────────────

const CHROMIUM_DIR_NAME = "chromium";
const SIDECAR_CHROMIUM_FILENAME = "hlvm-chromium.tar";

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

// ── Sidecar detection (bundled install) ──────────────────────────────────

/**
 * Search for the sidecar Chromium tarball in well-known locations:
 * 1. Beside the hlvm binary
 * 2. In ~/.hlvm/
 * 3. In the current working directory
 *
 * Same 3-location pattern as findSidecarModelTarball in ai-runtime.ts.
 */
async function findSidecarChromiumTarball(
  platform = getPlatform(),
): Promise<string | null> {
  const candidates: string[] = [];

  // 1. Beside the hlvm binary
  const execPath = platform.process.execPath?.();
  if (execPath) {
    candidates.push(
      platform.path.join(
        platform.path.dirname(execPath),
        SIDECAR_CHROMIUM_FILENAME,
      ),
    );
  }

  // 2. In ~/.hlvm/
  const homeDir = platform.env.get("HOME") ??
    platform.env.get("USERPROFILE") ?? "";
  if (homeDir) {
    candidates.push(
      platform.path.join(homeDir, ".hlvm", SIDECAR_CHROMIUM_FILENAME),
    );
  }

  // 3. Current working directory
  candidates.push(SIDECAR_CHROMIUM_FILENAME);

  for (const candidate of candidates) {
    if (await platform.fs.exists(candidate)) {
      return candidate;
    }
  }

  return null;
}

/** Whether a sidecar Chromium tarball is available for extraction. */
export async function hasBundledChromium(
  platform = getPlatform(),
): Promise<boolean> {
  return (await findSidecarChromiumTarball(platform)) !== null;
}

/**
 * Extract sidecar Chromium tarball to ~/.hlvm/.runtime/chromium/.
 * Deletes the tarball after successful extraction.
 * Same pattern as extractBundledModel in ai-runtime.ts.
 */
export async function extractBundledChromium(
  platform = getPlatform(),
  onProgress?: (message: string) => void,
): Promise<void> {
  const tarballPath = await findSidecarChromiumTarball(platform);
  if (!tarballPath) return;

  const chromiumDir = getChromiumDir();
  await platform.fs.mkdir(chromiumDir, { recursive: true });

  onProgress?.("Extracting sidecar Chromium tarball...");
  log.info?.(`Extracting sidecar Chromium from ${tarballPath} to ${chromiumDir}`);

  const result = await platform.command.output({
    cmd: ["tar", "-xf", tarballPath, "-C", chromiumDir],
    stdin: "null",
    stdout: "piped",
    stderr: "piped",
  });

  const stderr = new TextDecoder().decode(result.stderr).trim();
  if (!result.success) {
    throw new Error(`Failed to extract sidecar Chromium tarball: ${stderr}`);
  }

  onProgress?.("Sidecar Chromium extracted successfully.");
  log.info?.(`Sidecar Chromium extracted to ${chromiumDir}`);

  // Make executable
  const execPath = await resolveChromiumExecutablePath(platform);
  if (execPath) {
    try {
      await platform.fs.chmod(execPath, 0o755);
    } catch { /* best-effort */ }
  }

  // Delete tarball to reclaim disk space
  try {
    await platform.fs.remove(tarballPath);
    log.info?.(`Deleted sidecar Chromium tarball: ${tarballPath}`);
  } catch {
    log.debug?.(`Could not delete sidecar Chromium tarball: ${tarballPath}`);
  }
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

  // Use npx playwright-core install chromium (most reliable cross-runtime)
  const result = await platform.command.output({
    cmd: ["npx", "playwright-core", "install", "chromium"],
    stdin: "null",
    stdout: "piped",
    stderr: "piped",
    env: { PLAYWRIGHT_BROWSERS_PATH: chromiumDir },
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
      env: { PLAYWRIGHT_BROWSERS_PATH: chromiumDir },
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
