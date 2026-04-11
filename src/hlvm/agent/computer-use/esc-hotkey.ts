/**
 * Computer Use — Escape Hotkey (event-driven)
 *
 * HLVM.app runs an always-on global Escape monitor. On bare Escape,
 * HLVM.app POSTs to hql's /api/cu/escape, which calls fireEscapeAbort().
 * Without HLVM.app, Ctrl+C (SIGINT) is the fallback.
 */

import { getAgentLogger } from "../logger.ts";
import { getPlatform } from "../../../platform/platform.ts";
import { cuNativeRequest } from "./bridge.ts";

let _onEscape: (() => void) | undefined;

export function setEscapeCallback(onEscape: () => void): void {
  _onEscape = onEscape;
}

export function clearEscapeCallback(): void {
  _onEscape = undefined;
}

/** Arm hole-punch so model-sent Escape doesn't trigger abort. */
export function notifyExpectedEscape(): void {
  cuNativeRequest("/cu/esc/notify-expected", {}).catch(() => {});
}

/** Called by /api/cu/escape when HLVM.app detects user Escape. */
export function fireEscapeAbort(): boolean {
  if (!_onEscape) return false;
  getAgentLogger().info("[cu-esc] user Escape — aborting CU");
  _onEscape();
  return true;
}

export async function sendCuNotification(message: string): Promise<void> {
  try {
    await getPlatform().command.output({
      cmd: [
        "osascript", "-e",
        `display notification "${message.replaceAll('"', '\\"')}" with title "HLVM"`,
      ],
      stdin: "null", stdout: "piped", stderr: "piped",
    });
  } catch { /* best-effort */ }
}
