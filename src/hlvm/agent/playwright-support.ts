/**
 * Playwright Browser Support
 *
 * Handles Playwright Chromium detection, installation prompts, and setup.
 * Extracted from orchestrator.ts to keep the ReAct loop focused.
 */

import { getTool } from "./registry.ts";
import { log } from "../api/log.ts";
import { getPlatform } from "../../platform/platform.ts";
import { getErrorMessage } from "../../common/utils.ts";

/** Error markers indicating Playwright Chromium is not installed */
export const PLAYWRIGHT_ERROR_MARKERS = [
  "executable doesn't exist",
  "install chromium",
  "please run the following command to download new browsers",
];

/** Check if an error message indicates missing Playwright browser */
export function isPlaywrightMissingError(message: string): boolean {
  const lower = message.toLowerCase();
  return PLAYWRIGHT_ERROR_MARKERS.some((marker) => lower.includes(marker));
}

/**
 * Prompt user to install Playwright Chromium via ask_user tool.
 * Returns true if user confirms.
 */
export async function promptPlaywrightInstall(
  config: { workspace: string },
): Promise<boolean> {
  try {
    const tool = getTool("ask_user");
    const response = await tool.fn(
      {
        question:
          "Playwright Chromium is required to render this page. Install now? (y/n)",
      },
      config.workspace,
    );
    return String(response).trim().toLowerCase().startsWith("y");
  } catch (error) {
    log.warn(`Playwright install prompt failed: ${getErrorMessage(error)}`);
    return false;
  }
}

/** Run `npx playwright install chromium` */
export async function runPlaywrightInstall(): Promise<boolean> {
  const platform = getPlatform();
  try {
    const process = platform.command.run({
      cmd: ["npx", "playwright", "install", "chromium"],
      stdout: "inherit",
      stderr: "inherit",
    });
    const status = await process.status;
    if (!status.success) {
      log.error("Playwright install failed");
      return false;
    }
    return true;
  } catch (error) {
    log.error(`Playwright install failed: ${getErrorMessage(error)}`);
    return false;
  }
}

/**
 * Ensure Playwright Chromium is installed.
 * Prompts user once per session, then installs if confirmed.
 *
 * @param config Must have `workspace` and `playwrightInstallAttempted` fields
 */
export async function ensurePlaywrightChromium(
  config: { workspace: string; playwrightInstallAttempted?: boolean },
): Promise<boolean> {
  if (config.playwrightInstallAttempted) return false;
  config.playwrightInstallAttempted = true;
  const confirmed = await promptPlaywrightInstall(config);
  if (!confirmed) return false;

  log.info("Installing Playwright Chromium...");
  return await runPlaywrightInstall();
}
