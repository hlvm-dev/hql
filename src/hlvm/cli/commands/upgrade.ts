/**
 * HLVM Upgrade Command
 *
 * Updates HLVM to the latest version from GitHub releases.
 *
 * WARNING: The upgrade command uses `sh` and `curl` which only works on macOS/Linux.
 * Windows users must re-run install.ps1 to upgrade.
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
const INSTALL_SCRIPT =
  "https://raw.githubusercontent.com/hlvm-dev/hlvm/main/install.sh";
const INSTALL_PS1 =
  "https://raw.githubusercontent.com/hlvm-dev/hlvm/main/install.ps1";

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
    log.raw.log("\nRun 'hlvm upgrade' to update.");
    return;
  }

  const platform = getPlatform();

  // Windows - show instructions instead of running sh
  if (platform.build.os === "windows") {
    log.raw.log(
      "\nWindows detected. To upgrade, run this command in PowerShell:",
    );
    log.raw.log(`  irm ${INSTALL_PS1} | iex`);
    return;
  }

  // macOS/Linux - run install script
  log.raw.log("\nUpgrading...");

  try {
    const proc = platform.command.run({
      cmd: ["sh", "-c", `curl -fsSL ${INSTALL_SCRIPT} | sh`],
      stdin: "inherit",
      stdout: "inherit",
      stderr: "inherit",
    });

    const result = await proc.status;

    if (!result.success) {
      log.raw.error("\nUpgrade failed. Please try running manually:");
      log.raw.error(`  curl -fsSL ${INSTALL_SCRIPT} | sh`);
      platformExit(1);
    }

    log.raw.log("\nUpgrade complete! Run 'hlvm --version' to verify.");
  } catch (error) {
    log.raw.error(`\nUpgrade failed: ${getErrorMessage(error)}`);
    log.raw.error("\nPlease try running manually:");
    log.raw.error(`  curl -fsSL ${INSTALL_SCRIPT} | sh`);
    platformExit(1);
  }
}

/**
 * Display help for upgrade command.
 */
export function showUpgradeHelp(): void {
  log.raw.log(`
HLVM Upgrade - Update HLVM to the latest version

USAGE:
  hlvm upgrade           Upgrade to latest version
  hlvm upgrade --check   Check for updates only (don't install)

OPTIONS:
  -c, --check   Check for updates without installing
  -h, --help    Show this help message

NOTES:
  - On macOS/Linux: Downloads and runs the install script
  - On Windows: Shows PowerShell command to run manually

EXAMPLES:
  hlvm upgrade           # Upgrade to latest
  hlvm upgrade --check   # Just check, don't install
`);
}
