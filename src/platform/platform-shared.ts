/**
 * Platform Shared Implementation
 *
 * Cross-platform utilities used by both deno-platform.ts and node-platform.ts.
 * This module contains the SSOT for OS-specific behavior that all platform
 * implementations share — keeping types.ts pure interfaces/protocols.
 */

import type { OperatingSystem } from "./types.ts";

// =============================================================================
// Open URL/Path — Cross-Platform Command Builder
// =============================================================================

/** Command descriptor returned by buildOpenCommands. */
export interface OpenCommand {
  cmd: string;
  args: string[];
}

/**
 * Build the OS-specific command to open a URL or file path.
 * Single source of truth for all platform implementations.
 *
 * - macOS: NSWorkspace via JXA with `activates = true` (brings target app to front)
 * - Windows: cmd.exe /c start
 * - Linux: xdg-open
 */
/**
 * Build the OS-specific commands to open a URL or file path.
 *
 * Returns an array because macOS requires two sequential steps:
 * 1. `open` to launch the target (synchronous, reliable)
 * 2. `osascript` to bring the opened app to the foreground
 *
 * The previous JXA NSWorkspace approach used the async
 * `openURLConfigurationCompletionHandler` which could exit before the window
 * appeared, causing the "opens but doesn't come to front" bug.
 */
export function buildOpenCommands(os: OperatingSystem, url: string): OpenCommand[] {
  switch (os) {
    case "darwin": {
      // Step 1: `open` is synchronous and reliable for launching
      const openCmd: OpenCommand = { cmd: "open", args: [url] };
      // Step 2: Activate the frontmost app that `open` just launched.
      // For file paths, `open` launches Finder (or default app);
      // for URLs, it launches the default browser.
      // We use AppleScript to activate the app after a tiny delay.
      const isWebUrl = /^https?:\/\//i.test(url);
      const activateScript = isWebUrl
        ? 'tell application "System Events" to set frontmost of the first process whose frontmost is true to true'
        : `tell application "Finder" to activate`;
      const activateCmd: OpenCommand = {
        cmd: "osascript",
        args: ["-e", `delay 0.3\n${activateScript}`],
      };
      return [openCmd, activateCmd];
    }
    case "windows":
      // 'start' is a cmd.exe builtin, not a standalone executable.
      // The empty "" prevents start from treating the URL as window title.
      return [{ cmd: "cmd.exe", args: ["/c", "start", "", url] }];
    default:
      // Linux and other Unix-like systems
      return [{ cmd: "xdg-open", args: [url] }];
  }
}

