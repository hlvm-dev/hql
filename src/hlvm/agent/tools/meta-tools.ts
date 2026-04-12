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
import {
  createAbortError,
  throwIfAborted,
} from "../../../common/timeout-utils.ts";
import { TEXT_ENCODER } from "../../../common/utils.ts";
import { safeStringify } from "../../../common/safe-stringify.ts";
import { isToolArgsObject } from "../validation.ts";
import type {
  InteractionOption,
  ToolExecutionOptions,
  ToolMetadata,
} from "../registry.ts";
import {
  cloneTodoItems,
  summarizeTodoState,
  type TodoItem,
  type TodoState,
  type TodoStatus,
} from "../todo-state.ts";

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
    throw new ValidationError(
      "question must be a non-empty string",
      "ask_user",
    );
  }

  // Validate options if provided
  const normalizedChoices = normalizeAskUserChoices(choices);

  // GUI mode: emit interaction request and await response
  if (options?.onInteraction) {
    const requestId = crypto.randomUUID();
    const response = await options.onInteraction({
      type: "interaction_request",
      requestId,
      mode: "question",
      toolName: "ask_user",
      question: question as string,
      options: normalizedChoices.length > 0 ? normalizedChoices : undefined,
    });
    return response.userInput ?? "";
  }

  // CLI mode: stdin-based question
  const platform = getPlatform();

  // Display question (async write, NOT writeSync)
  await platform.terminal.stdout.write(TEXT_ENCODER.encode(`\n${question}\n`));

  // Display options if provided
  if (normalizedChoices.length > 0) {
    for (let i = 0; i < normalizedChoices.length; i++) {
      const choice = normalizedChoices[i];
      await platform.terminal.stdout.write(
        TEXT_ENCODER.encode(`  ${i + 1}. ${choice.label}\n`),
      );
      if (choice.detail?.trim()) {
        await platform.terminal.stdout.write(
          TEXT_ENCODER.encode(`     ${choice.detail.trim()}\n`),
        );
      }
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

function normalizeAskUserChoices(
  choices: unknown,
): InteractionOption[] {
  if (choices === undefined) return [];
  if (!Array.isArray(choices)) {
    throw new ValidationError("options must be an array", "ask_user");
  }
  return choices.map((choice, index) => {
    if (typeof choice === "string") {
      const trimmed = choice.trim();
      if (!trimmed) {
        throw new ValidationError(
          `options[${index}] must be a non-empty string`,
          "ask_user",
        );
      }
      return {
        label: trimmed,
        value: trimmed,
      };
    }
    if (
      choice && typeof choice === "object" &&
      "label" in choice && typeof choice.label === "string" &&
      choice.label.trim().length > 0
    ) {
      const record = choice as {
        label: string;
        value?: unknown;
        detail?: unknown;
        recommended?: unknown;
      };
      return {
        label: record.label.trim(),
        value:
          typeof record.value === "string" && record.value.trim().length > 0
            ? record.value.trim()
            : record.label.trim(),
        detail:
          typeof record.detail === "string" && record.detail.trim().length > 0
            ? record.detail.trim()
            : undefined,
        recommended: record.recommended === true,
      };
    }
    throw new ValidationError(
      `options[${index}] must be a string or { label, ... } object`,
      "ask_user",
    );
  });
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
      reject(createAbortError("Ask user aborted"));
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
    throw new ValidationError(
      "query must be a non-empty string",
      "tool_search",
    );
  }

  const resolvedLimit = typeof limit === "number" && Number.isFinite(limit)
    ? Math.max(1, Math.min(Math.floor(limit), 25))
    : 10;

  if (!options?.searchTools) {
    throw new ValidationError("tool search is not configured", "tool_search");
  }

  let matches = options.searchTools(query, {
    ownerId: options?.toolOwnerId,
    limit: resolvedLimit,
  });
  const hasDeferredDiscovery = matches.some((match) =>
    !!match && typeof match === "object" &&
    (match as { loadingExposure?: unknown }).loadingExposure === "deferred"
  );
  const ensureMcpLoaded = options?.ensureMcpLoaded;
  const shouldProbeDeferredMcp = !!ensureMcpLoaded &&
    !hasDeferredDiscovery &&
    matches.length < resolvedLimit;
  if (shouldProbeDeferredMcp) {
    await ensureMcpLoaded();
    const expandedMatches = options.searchTools(query, {
      ownerId: options?.toolOwnerId,
      limit: resolvedLimit,
    });
    if (expandedMatches.length >= matches.length) {
      matches = expandedMatches;
    }
  }

  return {
    query,
    count: matches.length,
    matches,
    suggested_allowlist: matches.map((m) => m.name),
  };
}

const TODO_STATUSES = new Set<TodoStatus>([
  "pending",
  "in_progress",
  "completed",
]);

function formatTodoResult(result: unknown): {
  summaryDisplay: string;
  returnDisplay: string;
} | null {
  if (
    !result || typeof result !== "object" ||
    !Array.isArray((result as TodoState).items)
  ) {
    return null;
  }
  const items = (result as TodoState).items as TodoItem[];
  return {
    summaryDisplay: summarizeTodoState({ items }),
    returnDisplay: safeStringify({ items: cloneTodoItems(items) }, 2),
  };
}

function validateTodoItems(items: unknown): TodoItem[] {
  if (!Array.isArray(items)) {
    throw new ValidationError("items must be an array", "todo_write");
  }
  return items.map((entry, index) => {
    if (!entry || typeof entry !== "object") {
      throw new ValidationError(
        `items[${index}] must be an object`,
        "todo_write",
      );
    }
    const record = entry as Record<string, unknown>;
    const id = typeof record.id === "string" ? record.id.trim() : "";
    const content = typeof record.content === "string"
      ? record.content.trim()
      : "";
    const status = record.status;
    if (!id) {
      throw new ValidationError(
        `items[${index}].id must be a non-empty string`,
        "todo_write",
      );
    }
    if (!content) {
      throw new ValidationError(
        `items[${index}].content must be a non-empty string`,
        "todo_write",
      );
    }
    if (
      typeof status !== "string" || !TODO_STATUSES.has(status as TodoStatus)
    ) {
      throw new ValidationError(
        `items[${index}].status must be one of: pending, in_progress, completed`,
        "todo_write",
      );
    }
    return { id, content, status: status as TodoStatus };
  });
}

async function todoRead(
  _args: unknown,
  _workspace: string,
  options?: ToolExecutionOptions,
): Promise<TodoState> {
  throwIfAborted(options?.signal);
  const items = cloneTodoItems(options?.todoState?.items ?? []);
  return { items };
}

async function todoWrite(
  args: unknown,
  _workspace: string,
  options?: ToolExecutionOptions,
): Promise<TodoState> {
  throwIfAborted(options?.signal);
  if (!isToolArgsObject(args)) {
    throw new ValidationError("args must be an object", "todo_write");
  }
  if (!options?.todoState) {
    throw new ValidationError("todo state is not configured", "todo_write");
  }
  const items = validateTodoItems((args as { items?: unknown }).items);
  options.todoState.items = cloneTodoItems(items);
  return { items: cloneTodoItems(options.todoState.items) };
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
  todo_read: {
    fn: todoRead,
    description: "Read the current task list for this agent session",
    category: "meta",
    args: {},
    returns: {
      items: "object[] - Current todo items for this session",
    },
    safetyLevel: "L0" as const,
    formatResult: formatTodoResult,
  },
  todo_write: {
    fn: todoWrite,
    description:
      "Replace the current task list for this agent session with a full set of todo items",
    category: "meta",
    args: {
      items:
        "object[] - Full todo list to store; each item requires {id, content, status}",
    },
    returns: {
      items: "object[] - Updated todo items for this session",
    },
    safetyLevel: "L0" as const,
    formatResult: formatTodoResult,
  },
  complete_task: {
    fn: (args: unknown): Promise<string> => {
      if (!isToolArgsObject(args)) {
        return Promise.resolve("Task complete.");
      }
      const summary = (args as { summary?: unknown }).summary;
      return Promise.resolve(
        typeof summary === "string" && summary.trim()
          ? summary.trim()
          : "Task complete.",
      );
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
      query:
        "string - Capability needed (e.g., 'find symbol references in TypeScript' or 'move files to trash and reveal the folder')",
      limit: "number (optional) - Max tools to return (1-25, default 10)",
    },
    returns: {
      count: "number - Number of matched tools",
      matches: "array - Ranked tool summaries",
      suggested_allowlist:
        "string[] - Suggested tool names to focus next iteration",
    },
    safetyLevel: "L0" as const,
  },
  skill: {
    fn: async (
      args: unknown,
      workspace: string,
    ): Promise<unknown> => {
      const { loadSkillCatalog } = await import("../../skills/mod.ts");
      const { executeInlineSkill } = await import("../../skills/executor.ts");
      if (!isToolArgsObject(args)) {
        return { error: "Missing arguments. Provide skill name." };
      }
      const record = args as Record<string, unknown>;
      const skillName = typeof record.skill === "string" ? record.skill : "";
      const catalog = await loadSkillCatalog(workspace);
      const skill = catalog.get(skillName);
      if (!skill) {
        return {
          error: `Unknown skill: ${skillName}. Available: ${
            [...catalog.keys()].join(", ")
          }`,
        };
      }
      if (skill.frontmatter.context === "fork") {
        return {
          systemMessage:
            `# Skill: ${skill.name} (delegate this task)\nUse delegate_agent to run this in a background agent.\n\n${skill.body}\n\nArgs: ${record.args ?? ""}`,
          allowedTools: skill.frontmatter.allowed_tools,
        };
      }
      return executeInlineSkill(
        skill,
        typeof record.args === "string" ? record.args : undefined,
      );
    },
    description: "Execute a named skill (reusable workflow)",
    category: "meta",
    args: {
      skill:
        "string - Skill name (e.g. 'commit', 'test', 'review')",
      args: "string (optional) - Arguments for the skill",
    },
    returns: {
      systemMessage: "string - Skill instructions to follow",
      allowedTools: "string[] (optional) - Tools the skill needs",
    },
    safetyLevel: "L0" as const,
  },
};
