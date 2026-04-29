import { spawnSync } from "node:child_process";
import { TextDecoder } from "node:util";
import { getPlatform } from "../../../../platform/platform.ts";

let checkedTmuxMouseHint = false;
let tmuxControlModeProbed: boolean | undefined;

function env(key: string): string | undefined {
  return getPlatform().env.get(key);
}

function isEnvTruthy(value: string | boolean | undefined): boolean {
  if (!value) return false;
  if (typeof value === "boolean") return value;
  return ["1", "true", "yes", "on"].includes(value.toLowerCase().trim());
}

function isEnvDefinedFalsy(value: string | boolean | undefined): boolean {
  if (value === undefined) return false;
  if (typeof value === "boolean") return !value;
  return ["0", "false", "no", "off"].includes(value.toLowerCase().trim());
}

function isTmuxControlModeEnvHeuristic(): boolean {
  if (!env("TMUX")) return false;
  if (env("TERM_PROGRAM") !== "iTerm.app") return false;
  const term = env("TERM") ?? "";
  return !term.startsWith("screen") && !term.startsWith("tmux");
}

function probeTmuxControlModeSync(): void {
  tmuxControlModeProbed = isTmuxControlModeEnvHeuristic();
  if (tmuxControlModeProbed) return;
  if (!env("TMUX")) return;
  if (env("TERM_PROGRAM")) return;

  let result: ReturnType<typeof spawnSync> | undefined;

  try {
    result = spawnSync(
      "tmux",
      ["display-message", "-p", "#{client_control_mode}"],
      { encoding: "utf8", timeout: 2000 },
    );
  } catch {
    return;
  }

  if (!result || result.status !== 0) return;
  tmuxControlModeProbed = String(result.stdout).trim() === "1";
}

export function isTmuxControlMode(): boolean {
  if (tmuxControlModeProbed === undefined) {
    probeTmuxControlModeSync();
  }
  return tmuxControlModeProbed ?? false;
}

export function isFullscreenEnvEnabled(): boolean {
  const fullscreenEnv = env("HLVM_NO_FLICKER");
  if (isEnvDefinedFalsy(fullscreenEnv)) return false;
  if (isEnvTruthy(fullscreenEnv)) return true;

  if (isTmuxControlMode()) return false;

  return true;
}

export function isFullscreenActive(): boolean {
  return getPlatform().terminal.stdin.isTerminal() && isFullscreenEnvEnabled();
}

export async function maybeGetTmuxMouseHint(): Promise<string | null> {
  if (!env("TMUX")) return null;
  if (!isFullscreenActive() || isTmuxControlMode()) return null;
  if (checkedTmuxMouseHint) return null;
  checkedTmuxMouseHint = true;

  const result = await getPlatform().command.output({
    cmd: ["tmux", "show", "-Av", "mouse"],
    stdout: "piped",
    stderr: "piped",
    stdin: "null",
    timeout: 2000,
  });

  if (!result.success) return null;

  const stdout = new TextDecoder().decode(result.stdout).trim();
  if (stdout === "on") return null;

  return "tmux detected · PgUp/PgDn scroll here · set 'mouse on' in tmux for terminal scrollback";
}

export function _resetFullscreenProbeForTesting(): void {
  checkedTmuxMouseHint = false;
  tmuxControlModeProbed = undefined;
}
