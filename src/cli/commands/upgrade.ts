/**
 * HQL Upgrade Command
 *
 * Updates HQL to the latest version from GitHub releases.
 *
 * WARNING: The upgrade command uses `sh` and `curl` which only works on macOS/Linux.
 * Windows users must re-run install.ps1 to upgrade.
 */

import { VERSION } from "../../version.ts";
import { exit as platformExit } from "../../platform/platform.ts";
import { isNewer } from "../utils/update-check.ts";

const GITHUB_API = "https://api.github.com/repos/hlvm-dev/hql/releases/latest";
const INSTALL_SCRIPT =
  "https://raw.githubusercontent.com/hlvm-dev/hql/main/install.sh";
const INSTALL_PS1 =
  "https://raw.githubusercontent.com/hlvm-dev/hql/main/install.ps1";

/**
 * Main upgrade command handler.
 */
export async function upgrade(args: string[]): Promise<void> {
  const checkOnly = args.includes("--check") || args.includes("-c");

  console.log(`Current version: ${VERSION}`);
  console.log("Checking for updates...");

  // Fetch latest release info
  let latestVersion: string;
  try {
    const resp = await fetch(GITHUB_API, {
      headers: {
        Accept: "application/vnd.github.v3+json",
        "User-Agent": "hql-cli",
      },
    });

    if (!resp.ok) {
      console.error(`Failed to check for updates (HTTP ${resp.status})`);
      platformExit(1);
    }

    const release = await resp.json();
    latestVersion = (release.tag_name || "").replace(/^v/, "");

    if (!latestVersion) {
      console.error("Failed to parse latest version");
      platformExit(1);
    }
  } catch (error) {
    console.error(`Failed to check for updates: ${error}`);
    platformExit(1);
  }

  // Compare versions
  if (latestVersion === VERSION) {
    console.log("\nAlready up to date!");
    return;
  }

  if (!isNewer(latestVersion, VERSION)) {
    console.log(`\nYou have version ${VERSION}, latest is ${latestVersion}`);
    console.log("You're on a newer or equal version.");
    return;
  }

  console.log(`\nNew version available: ${latestVersion}`);

  // Check-only mode
  if (checkOnly) {
    console.log("\nRun 'hql upgrade' to update.");
    return;
  }

  // Windows - show instructions instead of running sh
  if (Deno.build.os === "windows") {
    console.log(
      "\nWindows detected. To upgrade, run this command in PowerShell:",
    );
    console.log(`  irm ${INSTALL_PS1} | iex`);
    return;
  }

  // macOS/Linux - run install script
  console.log("\nUpgrading...");

  try {
    const cmd = new Deno.Command("sh", {
      args: ["-c", `curl -fsSL ${INSTALL_SCRIPT} | sh`],
      stdin: "inherit",
      stdout: "inherit",
      stderr: "inherit",
    });

    const result = await cmd.output();

    if (!result.success) {
      console.error("\nUpgrade failed. Please try running manually:");
      console.error(`  curl -fsSL ${INSTALL_SCRIPT} | sh`);
      platformExit(1);
    }

    console.log("\nUpgrade complete! Run 'hql --version' to verify.");
  } catch (error) {
    console.error(`\nUpgrade failed: ${error}`);
    console.error("\nPlease try running manually:");
    console.error(`  curl -fsSL ${INSTALL_SCRIPT} | sh`);
    platformExit(1);
  }
}

/**
 * Display help for upgrade command.
 */
export function showUpgradeHelp(): void {
  console.log(`
HQL Upgrade - Update HQL to the latest version

USAGE:
  hql upgrade           Upgrade to latest version
  hql upgrade --check   Check for updates only (don't install)

OPTIONS:
  -c, --check   Check for updates without installing
  -h, --help    Show this help message

NOTES:
  - On macOS/Linux: Downloads and runs the install script
  - On Windows: Shows PowerShell command to run manually

EXAMPLES:
  hql upgrade           # Upgrade to latest
  hql upgrade --check   # Just check, don't install
`);
}

