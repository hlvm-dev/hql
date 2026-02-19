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

/** Command descriptor returned by buildOpenCommand. */
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
export function buildOpenCommand(os: OperatingSystem, url: string): OpenCommand {
  switch (os) {
    case "darwin": {
      // Plain `open` doesn't bring the target app to foreground when called
      // from a child process of a GUI wrapper. Use NSWorkspace with
      // `activates = true` via JXA — works universally for any app.
      const isWebUrl = /^https?:\/\//i.test(url);
      const jxa = `
        ObjC.import('AppKit');
        var ws = $.NSWorkspace.sharedWorkspace;
        var u = ${isWebUrl
          ? `$.NSURL.URLWithString(${JSON.stringify(url)})`
          : `$.NSURL.fileURLWithPath(${JSON.stringify(url)})`};
        var c = $.NSWorkspaceOpenConfiguration.configuration;
        c.activates = true;
        ws.openURLConfigurationCompletionHandler(u, c, $());
      `;
      return { cmd: "osascript", args: ["-l", "JavaScript", "-e", jxa] };
    }
    case "windows":
      // 'start' is a cmd.exe builtin, not a standalone executable.
      // The empty "" prevents start from treating the URL as window title.
      return { cmd: "cmd.exe", args: ["/c", "start", "", url] };
    default:
      // Linux and other Unix-like systems
      return { cmd: "xdg-open", args: [url] };
  }
}
