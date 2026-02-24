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
import { ValidationError } from "../../../common/error.ts";
import { throwIfAborted } from "../../../common/timeout-utils.ts";
import { TEXT_ENCODER } from "../../../common/utils.ts";
import { isToolArgsObject } from "../validation.ts";
import type { ToolExecutionOptions, ToolMetadata } from "../registry.ts";

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
  options?: ToolExecutionOptions,
): Promise<string> {
  throwIfAborted(options?.signal);

  // Type validation
  if (!isToolArgsObject(args)) {
    throw new ValidationError("args must be an object", "ask_user");
  }

  const { question, options: choices } = args as {
    question: unknown;
    options?: unknown;
  };

  // Validate question
  if (typeof question !== "string" || question.trim() === "") {
    throw new ValidationError("question must be a non-empty string", "ask_user");
  }

  // Validate options if provided
  if (choices !== undefined) {
    if (!Array.isArray(choices)) {
      throw new ValidationError("options must be an array", "ask_user");
    }
    for (const opt of choices) {
      if (typeof opt !== "string") {
        throw new ValidationError("all options must be strings", "ask_user");
      }
    }
  }

  // GUI mode: emit interaction request and await response
  if (options?.onInteraction) {
    const requestId = crypto.randomUUID();
    const response = await options.onInteraction({
      type: "interaction_request",
      requestId,
      mode: "question",
      question: question as string,
    });
    return response.userInput ?? "";
  }

  // CLI mode: stdin-based question
  const platform = getPlatform();

  // Display question (async write, NOT writeSync)
  await platform.terminal.stdout.write(TEXT_ENCODER.encode(`\n${question}\n`));

  // Display options if provided
  if (choices && Array.isArray(choices)) {
    for (let i = 0; i < choices.length; i++) {
      await platform.terminal.stdout.write(
        TEXT_ENCODER.encode(`  ${i + 1}. ${choices[i]}\n`),
      );
    }
  }

  // Read user input
  await platform.terminal.stdout.write(TEXT_ENCODER.encode("> "));
  const buffer = new Uint8Array(1024);
  const n = await readStdinWithAbort(
    platform.terminal.stdin,
    buffer,
    options?.signal,
  );

  return new TextDecoder().decode(buffer.subarray(0, n || 0)).trim();
}

async function readStdinWithAbort(
  stdin: { read: (p: Uint8Array) => Promise<number | null> },
  buffer: Uint8Array,
  signal?: AbortSignal,
): Promise<number | null> {
  throwIfAborted(signal);

  if (!signal) {
    return await stdin.read(buffer);
  }

  return await new Promise((resolve, reject) => {
    const onAbort = (): void => {
      const error = new Error("Ask user aborted");
      error.name = "AbortError";
      reject(error);
    };

    if (signal.aborted) {
      onAbort();
      return;
    }

    signal.addEventListener("abort", onAbort, { once: true });

    stdin.read(buffer).then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (error) => {
        signal.removeEventListener("abort", onAbort);
        reject(error);
      },
    );
  });
}

// ============================================================
// Tool 2: tool_search
// ============================================================

async function toolSearch(
  args: unknown,
  _workspace: string,
  options?: ToolExecutionOptions,
): Promise<Record<string, unknown>> {
  throwIfAborted(options?.signal);

  if (!isToolArgsObject(args)) {
    throw new ValidationError("args must be an object", "tool_search");
  }

  const { query, limit } = args as {
    query?: unknown;
    limit?: unknown;
  };

  if (typeof query !== "string" || query.trim() === "") {
    throw new ValidationError("query must be a non-empty string", "tool_search");
  }

  if (options?.ensureMcpLoaded) {
    await options.ensureMcpLoaded();
  }

  const resolvedLimit = typeof limit === "number" && Number.isFinite(limit)
    ? Math.max(1, Math.min(Math.floor(limit), 25))
    : 10;

  if (!options?.searchTools) {
    throw new ValidationError("tool search is not configured", "tool_search");
  }

  const matches = options.searchTools(query, {
    ownerId: options?.toolOwnerId,
    limit: resolvedLimit,
  });

  return {
    query,
    count: matches.length,
    matches,
    suggested_allowlist: matches.map((m) => m.name),
  };
}

// ============================================================
// Tool Registry Export
// ============================================================

export const META_TOOLS: Record<string, ToolMetadata> = {
  ask_user: {
    fn: askUser,
    description: "Ask user for clarification or input during task execution",
    category: "meta",
    args: {
      question: "string - Question to ask the user",
      options: "string[] (optional) - Multiple choice options",
    },
    returns: {
      value: "string - User input response",
    },
    safetyLevel: "L0" as const,
  },
  complete_task: {
    fn: (args: unknown): Promise<string> => {
      if (!isToolArgsObject(args)) {
        return Promise.resolve("Task complete.");
      }
      const summary = (args as { summary?: unknown }).summary;
      return Promise.resolve(typeof summary === "string" && summary.trim()
        ? summary.trim()
        : "Task complete.");
    },
    description:
      "Signal task completion with an optional summary. Prefer this when finished.",
    category: "meta",
    args: {
      summary: "string (optional) - Final summary to return to the user",
    },
    returns: {
      summary: "string - Completion summary",
    },
    safetyLevel: "L0" as const,
  },
  tool_search: {
    fn: toolSearch,
    description:
      "Search and rank tools by intent. Returns suggested_allowlist for narrowing next LLM tool schema.",
    category: "meta",
    args: {
      query: "string - Capability needed (e.g., 'find symbol references in TypeScript')",
      limit: "number (optional) - Max tools to return (1-25, default 10)",
    },
    returns: {
      count: "number - Number of matched tools",
      matches: "array - Ranked tool summaries",
      suggested_allowlist: "string[] - Suggested tool names to focus next iteration",
    },
    safetyLevel: "L0" as const,
  },
};
