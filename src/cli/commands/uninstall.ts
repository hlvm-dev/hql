/**
 * HQL Uninstall Command
 *
 * Removes HQL from the system by deleting the ~/.hql directory.
 */

import { exit as platformExit } from "../../platform/platform.ts";

/**
 * Main uninstall command handler.
 */
export async function uninstall(args: string[]): Promise<void> {
  const force = args.includes("-y") || args.includes("--yes");

  // Get home directory (cross-platform)
  const home = Deno.env.get("HOME") || Deno.env.get("USERPROFILE") || "";
  if (!home) {
    console.error("Could not determine home directory");
    platformExit(1);
  }

  const hqlDir = `${home}/.hql`;

  // Check if HQL is installed
  try {
    await Deno.stat(hqlDir);
  } catch {
    console.log("HQL does not appear to be installed.");
    console.log(`(Directory not found: ${hqlDir})`);
    return;
  }

  // Show what will be removed
  console.log("\nThis will remove:");
  console.log(`  ${hqlDir}/bin/hql  (the binary)`);
  console.log(`  ${hqlDir}/         (config and cache)`);
  console.log("");

  // Confirmation prompt
  if (!force) {
    const response = prompt("Are you sure you want to uninstall HQL? [y/N]");
    if (!response || response.toLowerCase() !== "y") {
      console.log("\nUninstall cancelled.");
      return;
    }
  }

  // Perform uninstall
  console.log("\nUninstalling HQL...");

  try {
    await Deno.remove(hqlDir, { recursive: true });
    console.log(`Removed: ${hqlDir}`);
  } catch (error) {
    console.error(`Failed to remove ${hqlDir}: ${error}`);
    platformExit(1);
  }

  // Success message with PATH cleanup instructions
  console.log(`
HQL has been uninstalled.

To complete the uninstall, remove the PATH entry from your shell config:

  For zsh (~/.zshrc):
    Remove: export PATH="$PATH:$HOME/.hql/bin"

  For bash (~/.bashrc or ~/.bash_profile):
    Remove: export PATH="$PATH:$HOME/.hql/bin"

  For Windows:
    Remove $HOME\\.hql\\bin from your user PATH environment variable.

Thank you for using HQL!
Report issues: https://github.com/hlvm-dev/hql/issues
`);
}

/**
 * Display help for uninstall command.
 */
export function showUninstallHelp(): void {
  console.log(`
HQL Uninstall - Remove HQL from your system

USAGE:
  hql uninstall         Uninstall with confirmation prompt
  hql uninstall --yes   Uninstall without confirmation

OPTIONS:
  -y, --yes     Skip confirmation prompt
  -h, --help    Show this help message

WHAT GETS REMOVED:
  - ~/.hql/bin/hql      The HQL binary
  - ~/.hql/             Config and cache directory

NOTE:
  You will need to manually remove the PATH entry from your shell config.

EXAMPLES:
  hql uninstall         # Interactive uninstall
  hql uninstall --yes   # Non-interactive uninstall
`);
}
