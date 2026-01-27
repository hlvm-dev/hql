/**
 * Meta Tools - Tools for agent interaction and clarification
 *
 * Provides tools that enable the agent to:
 * - Ask user for clarification or input
 * - Request additional information during task execution
 *
 * All operations:
 * - Use platform abstraction (getPlatform)
 * - Handle errors gracefully
 * - Return structured results
 */

import { getPlatform } from "../../../platform/platform.ts";
import type { ToolMetadata } from "../registry.ts";

// ============================================================
// Tool 1: ask_user
// ============================================================

/**
 * Ask user for clarification or input during task execution
 *
 * Security: L0 (auto-approve) - user interaction is safe
 * Use cases:
 * - Clarify ambiguous requirements
 * - Get user preferences for implementation choices
 * - Request additional information
 *
 * @example
 * ```ts
 * const answer = await askUser({
 *   question: "Which approach should I use?",
 *   options: ["Approach A: Fast but risky", "Approach B: Slow but safe"]
 * }, "/workspace");
 * // Returns: "Approach B: Slow but safe" (user's choice)
 * ```
 */
async function askUser(
  args: unknown,
  _workspace: string,
): Promise<string> {
  // Type validation
  if (typeof args !== "object" || args === null) {
    throw new Error("args must be an object");
  }

  const { question, options } = args as {
    question: unknown;
    options?: unknown;
  };

  // Validate question
  if (typeof question !== "string" || question.trim() === "") {
    throw new Error("question must be a non-empty string");
  }

  // Validate options if provided
  if (options !== undefined) {
    if (!Array.isArray(options)) {
      throw new Error("options must be an array");
    }
    for (const opt of options) {
      if (typeof opt !== "string") {
        throw new Error("all options must be strings");
      }
    }
  }

  const platform = getPlatform();
  const encoder = new TextEncoder();

  // Display question (async write, NOT writeSync)
  await platform.terminal.stdout.write(encoder.encode(`\n${question}\n`));

  // Display options if provided
  if (options && Array.isArray(options)) {
    for (let i = 0; i < options.length; i++) {
      await platform.terminal.stdout.write(
        encoder.encode(`  ${i + 1}. ${options[i]}\n`),
      );
    }
  }

  // Read user input
  await platform.terminal.stdout.write(encoder.encode("> "));
  const buffer = new Uint8Array(1024);
  const n = await platform.terminal.stdin.read(buffer);

  return new TextDecoder().decode(buffer.subarray(0, n || 0)).trim();
}

// ============================================================
// Tool Registry Export
// ============================================================

export const META_TOOLS: Record<string, ToolMetadata> = {
  ask_user: {
    fn: askUser,
    description: "Ask user for clarification or input during task execution",
    args: {
      question: "string - Question to ask the user",
      options: "string[] (optional) - Multiple choice options",
    },
    safetyLevel: "L0" as const,
  },
};
