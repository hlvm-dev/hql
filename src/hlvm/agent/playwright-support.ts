/**
 * Playwright Browser Support
 *
 * Handles Playwright Chromium detection and one-time automatic setup.
 * Extracted from orchestrator.ts to keep the ReAct loop focused.
 */

import { getAgentLogger } from "./logger.ts";
import { getPlatform } from "../../platform/platform.ts";
import { getErrorMessage } from "../../common/utils.ts";

/** Error markers indicating Playwright Chromium is not installed */
const PLAYWRIGHT_ERROR_MARKERS = [
  "executable doesn't exist",
  "install chromium",
  "please run the following command to download new browsers",
];

/** Check if an error message indicates missing Playwright browser */
export function isPlaywrightMissingError(message: string): boolean {
  const lower = message.toLowerCase();
  return PLAYWRIGHT_ERROR_MARKERS.some((marker) => lower.includes(marker));
}

/** Run `npx playwright install chromium` */
async function runPlaywrightInstall(): Promise<boolean> {
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
 * Attempts automatic install once per session when missing.
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
