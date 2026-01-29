/**
 * Shell Command Classifier
 *
 * SSOT for determining shell_exec safety level based on allow-list.
 * Shared by safety classifier and shell tools.
 */

import { SHELL_ALLOWLIST_L1 } from "../constants.ts";

interface ShellCommandClassification {
  level: "L1" | "L2";
  reason: string;
}

export function classifyShellCommand(command: string): ShellCommandClassification {
  const trimmed = command.trim();

  for (const pattern of SHELL_ALLOWLIST_L1) {
    if (pattern.test(trimmed)) {
      return {
        level: "L1",
        reason: `Allow-listed read-only command: ${trimmed}`,
      };
    }
  }

  return {
    level: "L2",
    reason: `Shell command requires confirmation: ${trimmed}`,
  };
}
