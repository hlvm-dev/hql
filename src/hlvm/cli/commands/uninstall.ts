/**
 * HLVM Uninstall Command
 *
 * Removes HLVM from the system by deleting the ~/.hlvm directory.
 */

import { getPlatform } from "../../../platform/platform.ts";

// Local alias for platform exit
const platformExit = (code: number) => getPlatform().process.exit(code);
import { getErrorMessage } from "../../../common/utils.ts";

/**
 * Main uninstall command handler.
 */
export async function uninstall(args: string[]): Promise<void> {
  const platform = getPlatform();
  const force = args.includes("-y") || args.includes("--yes");

  // Get home directory (cross-platform)
  const home = platform.env.get("HOME") || platform.env.get("USERPROFILE") || "";
  if (!home) {
    console.error("Could not determine home directory");
    platformExit(1);
  }

  const hlvmDir = `${home}/.hlvm`;

  // Check if HLVM is installed
  try {
    await platform.fs.stat(hlvmDir);
  } catch {
    console.log("HLVM does not appear to be installed.");
    console.log(`(Directory not found: ${hlvmDir})`);
    return;
  }

  // Show what will be removed
  console.log("\nThis will remove:");
  console.log(`  ${hlvmDir}/bin/hlvm  (the binary)`);
  console.log(`  ${hlvmDir}/          (config and cache)`);
  console.log("");

  // Confirmation prompt
  if (!force) {
    const response = prompt("Are you sure you want to uninstall HLVM? [y/N]");
    if (!response || response.toLowerCase() !== "y") {
      console.log("\nUninstall cancelled.");
      return;
    }
  }

  // Perform uninstall
  console.log("\nUninstalling HLVM...");

  try {
    await platform.fs.remove(hlvmDir, { recursive: true });
    console.log(`Removed: ${hlvmDir}`);
  } catch (error) {
    console.error(`Failed to remove ${hlvmDir}: ${getErrorMessage(error)}`);
    platformExit(1);
  }

  // Success message with PATH cleanup instructions
  console.log(`
HLVM has been uninstalled.

To complete the uninstall, remove the PATH entry from your shell config:

  For zsh (~/.zshrc):
    Remove: export PATH="$PATH:$HOME/.hlvm/bin"

  For bash (~/.bashrc or ~/.bash_profile):
    Remove: export PATH="$PATH:$HOME/.hlvm/bin"

  For Windows:
    Remove $HOME\\.hlvm\\bin from your user PATH environment variable.

Thank you for using HLVM!
Report issues: https://github.com/hlvm-dev/hlvm/issues
`);
}

/**
 * Display help for uninstall command.
 */
export function showUninstallHelp(): void {
  console.log(`
HLVM Uninstall - Remove HLVM from your system

USAGE:
  hlvm uninstall         Uninstall with confirmation prompt
  hlvm uninstall --yes   Uninstall without confirmation

OPTIONS:
  -y, --yes     Skip confirmation prompt
  -h, --help    Show this help message

WHAT GETS REMOVED:
  - ~/.hlvm/bin/hlvm     The HLVM binary
  - ~/.hlvm/             Config and cache directory

NOTE:
  You will need to manually remove the PATH entry from your shell config.

EXAMPLES:
  hlvm uninstall         # Interactive uninstall
  hlvm uninstall --yes   # Non-interactive uninstall
`);
}
