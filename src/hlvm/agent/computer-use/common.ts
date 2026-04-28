/**
 * Computer Use — Common (CC clone)
 *
 * CC original: utils/computerUse/common.ts (61 lines)
 * Bridge changes: import paths + shared HLVM helpers.
 */

import { getPlatform } from "../../../platform/platform.ts";
import { ToolError } from "../error-taxonomy.ts";

/**
 * Sentinel bundle ID for the frontmost gate. Claude Code is a terminal — it has
 * no window. This never matches a real `NSWorkspace.frontmostApplication`, so
 * the package's "host is frontmost" branch (mouse click-through exemption,
 * keyboard safety-net) is dead code for us. `prepareForAction`'s "exempt our
 * own window" is likewise a no-op — there is no window to exempt.
 */
export const CLI_HOST_BUNDLE_ID = "com.anthropic.claude-code.cli-no-window";

/**
 * Fallback `env.terminal` → bundleId map for when `__CFBundleIdentifier` is
 * unset. Covers the macOS terminals we can distinguish — Linux entries
 * (konsole, gnome-terminal, xterm) are deliberately absent since
 * `createCliExecutor` is darwin-guarded.
 */
const TERMINAL_BUNDLE_ID_FALLBACK: Readonly<Record<string, string>> = {
  "iTerm.app": "com.googlecode.iterm2",
  Apple_Terminal: "com.apple.Terminal",
  ghostty: "com.mitchellh.ghostty",
  kitty: "net.kovidgoyal.kitty",
  WarpTerminal: "dev.warp.Warp-Stable",
  vscode: "com.microsoft.VSCode",
};

/**
 * Bundle ID of the terminal emulator we're running inside, so `prepareDisplay`
 * can exempt it from hiding and `captureExcluding` can keep it out of
 * screenshots. Returns null when undetectable (ssh, cleared env, unknown
 * terminal) — caller must handle the null case.
 *
 * `__CFBundleIdentifier` is set by LaunchServices when a .app bundle spawns a
 * process and is inherited by children. It's the exact bundleId, no lookup
 * needed — handles terminals the fallback table doesn't know about. Under
 * tmux/screen it reflects the terminal that started the SERVER, which may
 * differ from the attached client. That's harmless here: we exempt A
 * terminal window, and the screenshots exclude it regardless.
 */
export function getTerminalBundleId(): string | null {
  const platform = getPlatform();
  const cfBundleId = platform.env.get("__CFBundleIdentifier");
  if (cfBundleId) return cfBundleId;
  const terminal = platform.env.get("TERM_PROGRAM") ?? "";
  return TERMINAL_BUNDLE_ID_FALLBACK[terminal] ?? null;
}

/**
 * Static capabilities for macOS CLI. `hostBundleId` is not here — it's added
 * by `executor.ts` per `ComputerExecutor.capabilities`. `buildComputerUseTools`
 * takes this shape (no `hostBundleId`, no `teachMode`).
 */
export const CLI_CU_CAPABILITIES = {
  screenshotFiltering: "native" as const,
  platform: "darwin" as const,
};

/** Validate a macOS bundle ID in reverse-DNS form. */
const BUNDLE_ID_RE = /^[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)+$/;

export function isValidBundleId(bundleId: string | null | undefined): boolean {
  return typeof bundleId === "string" && BUNDLE_ID_RE.test(bundleId.trim());
}

export function assertValidBundleId(
  bundleId: string,
  fieldName = "bundleId",
): void {
  if (!isValidBundleId(bundleId)) {
    throw new ToolError(
      `Invalid ${fieldName}: "${bundleId}". Must be reverse-DNS format (e.g. "com.apple.Safari").`,
      "computer_use",
      "validation",
    );
  }
}

export function isComputerUseHostBundleId(
  bundleId: string | null | undefined,
): boolean {
  if (!bundleId) return false;
  return bundleId === CLI_HOST_BUNDLE_ID || bundleId === getTerminalBundleId();
}

export type ComputerUseSettingsPane =
  | "general"
  | "accessibility"
  | "screen_recording";

export async function openComputerUseSettings(
  pane: ComputerUseSettingsPane = "general",
): Promise<void> {
  const platform = getPlatform();
  const openTargets = pane === "accessibility"
    ? [
      "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility",
      "x-apple.systempreferences:com.apple.settings.PrivacySecurity.extension?Privacy_Accessibility",
    ]
    : pane === "screen_recording"
    ? [
      "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture",
      "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenRecording",
      "x-apple.systempreferences:com.apple.settings.PrivacySecurity.extension?Privacy_ScreenCapture",
      "x-apple.systempreferences:com.apple.settings.PrivacySecurity.extension?Privacy_ScreenRecording",
    ]
    : [];

  for (const target of openTargets) {
    const result = await platform.command.output({
      cmd: ["open", target],
      stdin: "null",
      stdout: "piped",
      stderr: "piped",
      timeout: 5000,
    });
    if (result.success) return;
  }

  const scripts = [
    'tell application "System Settings" to activate',
    'tell application "System Preferences" to activate',
  ];
  let lastError = "Unable to open macOS Settings.";
  for (const script of scripts) {
    const result = await platform.command.output({
      cmd: ["osascript", "-e", script],
      stdin: "null",
      stdout: "piped",
      stderr: "piped",
      timeout: 5000,
    });
    if (result.success) return;
    lastError = new TextDecoder().decode(result.stderr).trim() || lastError;
  }
  throw new ToolError(lastError, "cu_request_access", "internal");
}
