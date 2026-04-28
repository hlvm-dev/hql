/**
 * Playwright Browser Support
 *
 * Handles Playwright Chromium detection and one-time automatic setup.
 */

import { getAgentLogger } from "./logger.ts";
import { getPlatform } from "../../platform/platform.ts";
import { getErrorMessage } from "../../common/utils.ts";

/** Error markers indicating Playwright Chromium is not installed */
const PLAYWRIGHT_ERROR_MARKERS = [
  "executable doesn't exist",
  "install chromium",
  "please run the following command to download new browsers",
  "chromium not available",
];

/** Check if an error message indicates missing Playwright browser */
export function isPlaywrightMissingError(message: string): boolean {
  const lower = message.toLowerCase();
  return PLAYWRIGHT_ERROR_MARKERS.some((marker) => lower.includes(marker));
}

/** Check HLVM-managed Chromium first, then fall back to npx install */
async function runPlaywrightInstall(): Promise<boolean> {
  // 1. Check HLVM-managed Chromium (from hlvm bootstrap)
  try {
    const { isChromiumReady } = await import("../runtime/chromium-runtime.ts");
    if (await isChromiumReady()) {
      getAgentLogger().info("Using HLVM-managed Chromium");
      return true;
    }
  } catch { /* chromium-runtime not available */ }

  // 2. Fall back to npx playwright install
  const platform = getPlatform();
  try {
    const process = platform.command.run({
      cmd: ["npx", "playwright", "install", "chromium"],
      stdout: "inherit",
      stderr: "inherit",
    });
    const status = await process.status;
    if (!status.success) {
      getAgentLogger().error("Playwright install failed");
      return false;
    }
    return true;
  } catch (error) {
    getAgentLogger().error(`Playwright install failed: ${getErrorMessage(error)}`);
    return false;
  }
}

/**
 * Ensure Playwright Chromium is installed.
 * Checks HLVM-managed Chromium first, then attempts npx install once per session.
 *
 * @param config Must have `workspace` and `playwrightInstallAttempted` fields
 */
export async function ensurePlaywrightChromium(
  config: { workspace: string; playwrightInstallAttempted?: boolean },
): Promise<boolean> {
  if (config.playwrightInstallAttempted) return false;
  config.playwrightInstallAttempted = true;
  getAgentLogger().info("Playwright Chromium missing. Installing automatically...");
  return await runPlaywrightInstall();
}
