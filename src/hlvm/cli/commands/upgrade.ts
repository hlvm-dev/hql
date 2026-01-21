/**
 * HLVM Upgrade Command
 *
 * Updates HLVM to the latest version from GitHub releases.
 *
 * NOTE: HLVM upgrades require rebuilding from source.
 */

import { VERSION } from "../../../version.ts";
import { log } from "../../api/log.ts";
import { getPlatform } from "../../../platform/platform.ts";
import { http } from "../../../common/http-client.ts";

// Local alias for platform exit
const platformExit = (code: number) => getPlatform().process.exit(code);
import { isNewer } from "../utils/update-check.ts";
import { getErrorMessage } from "../../../common/utils.ts";

const GITHUB_API = "https://api.github.com/repos/hlvm-dev/hlvm/releases/latest";

/**
 * Main upgrade command handler.
 */
export async function upgrade(args: string[]): Promise<void> {
  const checkOnly = args.includes("--check") || args.includes("-c");

  log.raw.log(`Current version: ${VERSION}`);
  log.raw.log("Checking for updates...");

  // Fetch latest release info (SSOT: use http client)
  let latestVersion: string;
  try {
    const release = await http.get<{ tag_name?: string }>(GITHUB_API, {
      headers: {
        Accept: "application/vnd.github.v3+json",
        "User-Agent": "hlvm-cli",
      },
    });

    latestVersion = (release.tag_name || "").replace(/^v/, "");

    if (!latestVersion) {
      log.raw.error("Failed to parse latest version");
      platformExit(1);
    }
  } catch (error) {
    log.raw.error(`Failed to check for updates: ${getErrorMessage(error)}`);
    platformExit(1);
  }

  // Compare versions
  if (latestVersion === VERSION) {
    log.raw.log("\nAlready up to date!");
    return;
  }

  if (!isNewer(latestVersion, VERSION)) {
    log.raw.log(`\nYou have version ${VERSION}, latest is ${latestVersion}`);
    log.raw.log("You're on a newer or equal version.");
    return;
  }

  log.raw.log(`\nNew version available: ${latestVersion}`);

  // Check-only mode
  if (checkOnly) {
    log.raw.log("\nRun 'hlvm upgrade' to see update instructions.");
    return;
  }

  log.raw.log("\nTo upgrade, rebuild HLVM from source:");
  log.raw.log("  make build");
  log.raw.log("  ./hlvm --version");
  log.raw.log("\nSee docs/BUILD.md for more options.");
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

NOTES:
  - Upgrades require rebuilding from source

EXAMPLES:
  hlvm upgrade           # Show upgrade instructions
  hlvm upgrade --check   # Just check
`);
}
