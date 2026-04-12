/**
 * HLVM Upgrade Command
 *
 * Checks for and shows instructions to update to the latest GitHub release.
 */

import { VERSION } from "../../../common/version.ts";
import { log } from "../../api/log.ts";
import { platformExit } from "../utils/platform-helpers.ts";
import {
  isNewer,
  fetchLatestRelease,
  getUpgradeCommand,
} from "../utils/update-check.ts";
import { getErrorMessage } from "../../../common/utils.ts";

/**
 * Main upgrade command handler.
 */
export async function upgrade(args: string[]): Promise<void> {
  const checkOnly = args.includes("--check") || args.includes("-c");

  log.raw.log(`Current version: ${VERSION}`);
  log.raw.log("Checking for updates...");

  let release;
  try {
    release = await fetchLatestRelease();
    if (!release) {
      log.raw.error("Failed to parse latest version");
      return platformExit(1);
    }
  } catch (error) {
    log.raw.error(`Failed to check for updates: ${getErrorMessage(error)}`);
    return platformExit(1);
  }

  if (release.version === VERSION) {
    log.raw.log("\nAlready up to date!");
    return;
  }

  if (!isNewer(release.version, VERSION)) {
    log.raw.log(
      `\nYou have version ${VERSION}, latest is ${release.version}`,
    );
    log.raw.log("You're on a newer or equal version.");
    return;
  }

  log.raw.log(`\nNew version available: ${release.version}`);

  if (checkOnly) {
    log.raw.log("\nRun 'hlvm upgrade' to see update instructions.");
    return;
  }

  const cmd = getUpgradeCommand();
  log.raw.log(`\nTo upgrade, run:\n  ${cmd}`);
  log.raw.log("\nOr rebuild from source:\n  make build\n  ./hlvm --version");
}

/**
 * Display help for upgrade command.
 */
export function showUpgradeHelp(): void {
  log.raw.log(`
HLVM Upgrade - Show upgrade instructions

USAGE:
  hlvm upgrade           Show upgrade instructions
  hlvm upgrade --check   Check for updates only

OPTIONS:
  -c, --check   Check for updates without installing
  -h, --help    Show this help message

EXAMPLES:
  hlvm upgrade           # Show upgrade instructions
  hlvm upgrade --check   # Just check
`);
}
