/**
 * Shell Command Classifier
 *
 * SSOT for determining shell_exec safety level based on allow-lists.
 * Shared by safety classifier and shell tools.
 *
 * Three levels:
 * - L0: Read-only commands, auto-approved (same trust as read_file/list_files)
 * - L1: Low-risk commands, prompt once per session
 * - L2: Everything else, always prompt
 */

import { SHELL_ALLOWLIST_L0, SHELL_ALLOWLIST_L1 } from "../constants.ts";

interface ShellCommandClassification {
  level: "L0" | "L1" | "L2";
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

  for (const pattern of SHELL_ALLOWLIST_L0) {
    if (pattern.test(trimmed)) {
      return {
        level: "L0",
        reason: `Read-only command (auto-approved): ${trimmed}`,
      };
    }
  }

  for (const pattern of SHELL_ALLOWLIST_L1) {
    if (pattern.test(trimmed)) {
      return {
        level: "L1",
        reason: `Allow-listed command: ${trimmed}`,
      };
    }
  }

  return {
    level: "L2",
    reason: `Shell command requires confirmation: ${trimmed}`,
  };
}
