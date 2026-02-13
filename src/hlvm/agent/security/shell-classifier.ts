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

const SHELL_METACHAR = /[;|&`<>]|\$\(/;

export function classifyShellCommand(command: string): ShellCommandClassification {
  const trimmed = command.trim();

  // Shell metacharacters bypass allowlist — always require confirmation
  if (SHELL_METACHAR.test(trimmed)) {
    return {
      level: "L2",
      reason: `Shell metacharacters detected: ${trimmed}`,
    };
  }

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
