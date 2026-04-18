/**
 * HLVM Update Command
 *
 * Checks for and installs the latest GitHub release.
 */

import { VERSION } from "../../../common/version.ts";
import { getPlatform } from "../../../platform/platform.ts";
import { log } from "../../api/log.ts";
import { platformExit } from "../utils/platform-helpers.ts";
import {
  fetchLatestRelease,
  getInstallerCommand,
  isNewer,
} from "../utils/update-check.ts";
import { getErrorMessage } from "../../../common/utils.ts";

function getInstallerArgs(): string[] {
  const installerCommand = getInstallerCommand();
  return getPlatform().build.os === "windows"
    ? [
      "powershell",
      "-NoProfile",
      "-ExecutionPolicy",
      "Bypass",
      "-Command",
      installerCommand,
    ]
    : ["sh", "-c", installerCommand];
}

function getPinnedInstallVersion(version: string): string {
  return version.startsWith("v") ? version : `v${version}`;
}

async function runInstaller(version: string): Promise<void> {
  const platform = getPlatform();
  const process = platform.command.run({
    cmd: getInstallerArgs(),
    env: {
      ...platform.env.toObject(),
      HLVM_INSTALL_VERSION: getPinnedInstallVersion(version),
    },
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  });
  const status = await process.status;
  if (!status.success) {
    throw new Error(`Installer exited with code ${status.code}`);
  }
}

export async function update(args: string[]): Promise<void> {
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
    log.raw.log("\nRun 'hlvm update' to install it.");
    return;
  }

  log.raw.log(`\nUpdating to ${release.version}...`);

  try {
    await runInstaller(release.version);
  } catch (error) {
    log.raw.error(`Failed to update: ${getErrorMessage(error)}`);
    log.raw.log(`\nRetry manually:\n  ${getInstallerCommand()}`);
    return platformExit(1);
  }
}

export function showUpdateHelp(): void {
  log.raw.log(`
HLVM Update - Install the latest HLVM release

USAGE:
  hlvm update            Install the latest release
  hlvm update --check    Check for updates only

OPTIONS:
  -c, --check   Check for updates without installing
  -h, --help    Show this help message

EXAMPLES:
  hlvm update            # Install the latest release
  hlvm update --check    # Just check
`);
}
