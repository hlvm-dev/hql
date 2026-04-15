/**
 * CLI Command — hlvm chrome-ext
 * Setup, status, and uninstall for Chrome Extension Browser Bridge.
 */

import { log } from "../../api/log.ts";
import { ValidationError } from "../../../common/error.ts";
import {
  installNativeHost,
  uninstallNativeHost,
  checkStatus,
} from "../../agent/chrome-ext/mod.ts";
import { hasHelpFlag } from "../utils/common-helpers.ts";

export function showChromeExtHelp(): void {
  log.raw.log(`
Chrome Extension Browser Bridge — Use your authenticated Chrome sessions

Usage: hlvm chrome-ext <command>

Commands:
  setup       Install native messaging host for all detected browsers
  status      Check extension connection and installation status
  uninstall   Remove native messaging host manifests

After setup, load the extension in Chrome:
  chrome://extensions → Developer mode → Load unpacked
  → src/hlvm/agent/chrome-ext/extension/

Then ch_* tools can control your real Chrome with all your logged-in sessions.
`);
}

export async function chromeExtCommand(args: string[]): Promise<void> {
  if (args.length === 0 || hasHelpFlag(args)) {
    showChromeExtHelp();
    return;
  }

  const subcommand = args[0];
  switch (subcommand) {
    case "setup":
      return await chromeExtSetup();
    case "status":
      return await chromeExtStatus();
    case "uninstall":
      return await chromeExtUninstall();
    default:
      throw new ValidationError(
        `Unknown chrome-ext command: ${subcommand}. Run 'hlvm chrome-ext --help' for usage.`,
        "chrome-ext",
      );
  }
}

async function chromeExtSetup(): Promise<void> {
  log.info("Installing Chrome Extension native messaging host...");
  const { installed, errors } = await installNativeHost();

  for (const msg of installed) {
    log.info(`  ✓ ${msg}`);
  }
  for (const msg of errors) {
    log.warn(`  ✗ ${msg}`);
  }

  if (installed.length > 0) {
    log.info("");
    log.info("Native host installed. Now load the extension in Chrome:");
    log.info("  chrome://extensions → Developer mode → Load unpacked");
    log.info("  → src/hlvm/agent/chrome-ext/extension/");
  } else {
    log.error("No browsers found. Install Chrome, Brave, or another Chromium browser.");
  }
}

async function chromeExtStatus(): Promise<void> {
  const status = await checkStatus();
  for (const detail of status.details) {
    log.info(detail);
  }
}

async function chromeExtUninstall(): Promise<void> {
  log.info("Removing Chrome Extension native messaging host...");
  const { removed, errors } = await uninstallNativeHost();

  for (const msg of removed) {
    log.info(`  ✓ Removed: ${msg}`);
  }
  for (const msg of errors) {
    log.warn(`  ✗ ${msg}`);
  }

  if (removed.length === 0 && errors.length === 0) {
    log.info("Nothing to remove.");
  }
}
