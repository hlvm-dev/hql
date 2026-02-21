/**
 * Agent Eval Harness
 *
 * Runs scripted eval cases against the agent's ReAct loop to measure
 * correctness. Uses the same engine-harness pattern as unit tests:
 * scripted LLM responses + real/fake tools.
 *
 * Usage:
 *   deno test --allow-all tests/eval/eval-runner.ts
 *   deno test --allow-all tests/eval/eval-runner.ts -- --live  (real LLM)
 */

import { assertEquals } from "jsr:@std/assert";
import {
  type LLMFunction,
  runReActLoop,
  type ToolCall,
  type TraceEvent,
} from "../../src/hlvm/agent/orchestrator.ts";
import { ContextManager } from "../../src/hlvm/agent/context.ts";
import { TOOL_REGISTRY } from "../../src/hlvm/agent/registry.ts";
import { generateSystemPrompt } from "../../src/hlvm/agent/llm-integration.ts";
import { ENGINE_PROFILES } from "../../src/hlvm/agent/constants.ts";
import { getPlatform } from "../../src/platform/platform.ts";

// ============================================================
// Types
// ============================================================

interface ScriptedStep {
  content?: string;
  toolCalls?: ToolCall[];
}

interface EvalAssertion {
  resultContains?: string[];
  resultNotContains?: string[];
  toolsCalled?: string[];
  minToolCalls?: number;
  maxToolCalls?: number;
}

interface EvalCase {
  name: string;
  description: string;
  query: string;
  steps: ScriptedStep[];
  fakeTools?: Record<string, unknown>;
  assertions: EvalAssertion;
}

interface EvalResult {
  name: string;
  passed: boolean;
  duration: number;
  failures: string[];
  toolsCalled: string[];
}

// ============================================================
// Test helpers (same pattern as engine-harness.test.ts)
// ============================================================

function createScriptedLLM(steps: ScriptedStep[]): LLMFunction {
  let index = 0;
  return (_messages, signal) => {
    if (signal?.aborted) {
      const err = new Error("LLM aborted");
      err.name = "AbortError";
      throw err;
    }
    if (index >= steps.length) {
      throw new Error("Scripted LLM exhausted steps");
    }
    const step = steps[index++];
    return Promise.resolve({
      content: step.content ?? "",
      toolCalls: step.toolCalls ?? [],
    });
  };
}

function addFakeTool(name: string, result: unknown): void {
  TOOL_REGISTRY[name] = {
    fn: () => Promise.resolve(result),
    description: `Fake tool: ${name}`,
    args: {},
    skipValidation: true,
  };
}

function removeFakeTools(names: string[]): void {
  for (const name of names) {
    delete TOOL_REGISTRY[name];
  }
}

function createContext(): ContextManager {
  const context = new ContextManager({
    maxTokens: Math.max(ENGINE_PROFILES.normal.context.maxTokens, 12000),
    overflowStrategy: "fail",
  });
  context.addMessage({
    role: "system",
    content: generateSystemPrompt(),
  });
  return context;
}

// ============================================================
// Eval runner
// ============================================================

async function runEvalCase(evalCase: EvalCase): Promise<EvalResult> {
  const start = Date.now();
  const failures: string[] = [];
  const toolsCalled: string[] = [];
  const fakeToolNames: string[] = [];

  // Register fake tools if needed
  if (evalCase.fakeTools) {
    for (const [name, result] of Object.entries(evalCase.fakeTools)) {
      addFakeTool(name, result);
      fakeToolNames.push(name);
    }
  }

  try {
    const llm = createScriptedLLM(evalCase.steps);
    const context = createContext();

    // Collect trace events to track tool calls
    const onTrace = (event: TraceEvent) => {
      if (event.type === "tool_call") {
        toolsCalled.push(event.toolName);
      }
    };

    const result = await runReActLoop(
      evalCase.query,
      {
        workspace: "/tmp",
        context,
        autoApprove: true,
        maxToolCalls: 10,
        onTrace,
      },
      llm,
    );

    // Check assertions
    const { assertions } = evalCase;

    if (assertions.resultContains) {
      for (const expected of assertions.resultContains) {
        if (!result.includes(expected)) {
          failures.push(`Result missing: "${expected}"`);
        }
      }
    }

    if (assertions.resultNotContains) {
      for (const unexpected of assertions.resultNotContains) {
        if (result.includes(unexpected)) {
          failures.push(`Result should not contain: "${unexpected}"`);
        }
      }
    }

    if (assertions.toolsCalled) {
      for (const expectedTool of assertions.toolsCalled) {
        if (!toolsCalled.includes(expectedTool)) {
          failures.push(`Expected tool not called: "${expectedTool}"`);
        }
      }
    }

    if (assertions.minToolCalls !== undefined) {
      if (toolsCalled.length < assertions.minToolCalls) {
        failures.push(
          `Expected at least ${assertions.minToolCalls} tool calls, got ${toolsCalled.length}`,
        );
      }
    }

    if (assertions.maxToolCalls !== undefined) {
      if (toolsCalled.length > assertions.maxToolCalls) {
        failures.push(
          `Expected at most ${assertions.maxToolCalls} tool calls, got ${toolsCalled.length}`,
        );
      }
    }
  } catch (error) {
    failures.push(`Error: ${(error as Error).message}`);
  } finally {
    removeFakeTools(fakeToolNames);
  }

  return {
    name: evalCase.name,
    passed: failures.length === 0,
    duration: Date.now() - start,
    failures,
    toolsCalled,
  };
}

// ============================================================
// Eval cases (inline — no external JSON needed)
// ============================================================

const EVAL_CASES: EvalCase[] = [
  {
    name: "list-files",
    description: "Agent lists .ts files using list_files tool",
    query: "List all .ts files in src",
    fakeTools: {
      fake_list_files: {
        files: ["src/main.ts", "src/utils.ts", "src/config.ts"],
        count: 3,
      },
    },
    steps: [
      { toolCalls: [{ toolName: "fake_list_files", args: { path: "src", pattern: "*.ts" } }] },
      { content: "Based on fake_list_files, found 3 TypeScript files: main.ts, utils.ts, config.ts." },
    ],
    assertions: {
      resultContains: ["main.ts"],
      toolsCalled: ["fake_list_files"],
      minToolCalls: 1,
    },
  },
  {
    name: "search-todo",
    description: "Agent searches for TODO comments",
    query: "Search for TODO comments in the codebase",
    fakeTools: {
      fake_search: {
        matches: [
          { file: "src/main.ts", line: 10, content: "// TODO: refactor this", match: "TODO" },
          { file: "src/utils.ts", line: 25, content: "// TODO: add tests", match: "TODO" },
        ],
        count: 2,
      },
    },
    steps: [
      { toolCalls: [{ toolName: "fake_search", args: { pattern: "TODO" } }] },
      { content: "Based on fake_search, found 2 TODO comments: one in main.ts (refactor) and one in utils.ts (add tests)." },
    ],
    assertions: {
      resultContains: ["TODO", "main.ts"],
      toolsCalled: ["fake_search"],
    },
  },
  {
    name: "read-summarize",
    description: "Agent reads and summarizes a file",
    query: "Read and summarize the README",
    fakeTools: {
      fake_read: "# HLVM\nA modern build tool and language runtime.\n\n## Features\n- Fast compilation\n- Type safety",
    },
    steps: [
      { toolCalls: [{ toolName: "fake_read", args: { path: "README.md" } }] },
      { content: "Based on fake_read, HLVM is a modern build tool and language runtime with features like fast compilation and type safety." },
    ],
    assertions: {
      resultContains: ["HLVM", "build tool"],
      toolsCalled: ["fake_read"],
    },
  },
  {
    name: "find-function",
    description: "Agent finds a function declaration",
    query: "Find the function parseDate",
    fakeTools: {
      fake_find: {
        symbols: [{ file: "src/utils.ts", line: 42, type: "function", name: "parseDate" }],
        count: 1,
      },
    },
    steps: [
      { toolCalls: [{ toolName: "fake_find", args: { name: "parseDate" } }] },
      { content: "Based on fake_find, parseDate is defined at src/utils.ts:42." },
    ],
    assertions: {
      resultContains: ["parseDate", "utils.ts"],
      toolsCalled: ["fake_find"],
    },
  },
  {
    name: "count-lines",
    description: "Agent counts lines in a file",
    query: "How many lines are in src/main.ts?",
    fakeTools: {
      fake_read_count: "line1\nline2\nline3\nline4\nline5\nline6\nline7\nline8\nline9\nline10",
    },
    steps: [
      { toolCalls: [{ toolName: "fake_read_count", args: { path: "src/main.ts" } }] },
      { content: "Based on fake_read_count, src/main.ts has 10 lines." },
    ],
    assertions: {
      resultContains: ["10"],
      toolsCalled: ["fake_read_count"],
    },
  },
  {
    name: "fix-typo",
    description: "Agent uses edit_file to fix a typo",
    query: "Fix the typo 'recieve' to 'receive' in src/main.ts",
    fakeTools: {
      fake_edit: { success: true, message: "Replaced 1 occurrence" },
    },
    steps: [
      {
        toolCalls: [{
          toolName: "fake_edit",
          args: { path: "src/main.ts", find: "recieve", replace: "receive" },
        }],
      },
      { content: "Based on fake_edit, fixed the typo: replaced 'recieve' with 'receive' in src/main.ts." },
    ],
    assertions: {
      resultContains: ["receive"],
      toolsCalled: ["fake_edit"],
    },
  },
  {
    name: "create-file",
    description: "Agent creates a new file",
    query: "Create a new file src/types.ts with a User interface",
    fakeTools: {
      fake_write: { success: true, message: "File written", bytesWritten: 42 },
    },
    steps: [
      {
        toolCalls: [{
          toolName: "fake_write",
          args: { path: "src/types.ts", content: "interface User { name: string; }" },
        }],
      },
      { content: "Based on fake_write, created src/types.ts with the User interface." },
    ],
    assertions: {
      resultContains: ["types.ts", "User"],
      toolsCalled: ["fake_write"],
    },
  },
  {
    name: "multi-step-search-read",
    description: "Agent performs search then read (multi-step)",
    query: "Find the Config class and show me its implementation",
    fakeTools: {
      fake_search_multi: {
        symbols: [{ file: "src/config.ts", line: 5, type: "class", name: "Config" }],
        count: 1,
      },
      fake_read_multi: "export class Config {\n  constructor(public name: string) {}\n  get value() { return this.name; }\n}",
    },
    steps: [
      {
        toolCalls: [{
          toolName: "fake_search_multi",
          args: { name: "Config", type: "class" },
        }],
      },
      {
        toolCalls: [{
          toolName: "fake_read_multi",
          args: { path: "src/config.ts" },
        }],
      },
      {
        content: "Based on fake_search_multi and fake_read_multi, Config is a class in src/config.ts with a constructor that takes a name string and a value getter.",
      },
    ],
    assertions: {
      resultContains: ["Config", "constructor"],
      toolsCalled: ["fake_search_multi", "fake_read_multi"],
      minToolCalls: 2,
    },
  },
  {
    name: "git-status",
    description: "Agent checks git status using the new git_status tool",
    query: "What's the git status?",
    fakeTools: {
      fake_git_status: {
        entries: [{ file: "src/main.ts", status: "modified", staged: false }],
        staged: [],
        unstaged: ["src/main.ts"],
        untracked: [],
        clean: false,
        message: "1 file(s) changed",
      },
    },
    steps: [
      { toolCalls: [{ toolName: "fake_git_status", args: {} }] },
      {
        content: "Based on fake_git_status, there is 1 modified file: src/main.ts (unstaged).",
      },
    ],
    assertions: {
      resultContains: ["main.ts", "modified"],
      toolsCalled: ["fake_git_status"],
    },
  },
  {
    name: "greeting-no-tools",
    description: "Agent responds to greeting without using any tools",
    query: "Hello! How are you?",
    steps: [
      { content: "Hello! I'm doing well. How can I help you today?" },
    ],
    assertions: {
      resultContains: ["Hello"],
      maxToolCalls: 0,
    },
  },
];

// ============================================================
// Deno test runner
// ============================================================

for (const evalCase of EVAL_CASES) {
  Deno.test({
    name: `Eval: ${evalCase.name} - ${evalCase.description}`,
    async fn() {
      const result = await runEvalCase(evalCase);

      if (!result.passed) {
        const failMsg = result.failures.join("\n  - ");
        throw new Error(`Eval case '${evalCase.name}' failed:\n  - ${failMsg}`);
      }

      assertEquals(result.passed, true);
    },
  });
}

// Scorecard summary test
Deno.test({
  name: "Eval: Scorecard - all cases pass",
  async fn() {
    const results: EvalResult[] = [];

    for (const evalCase of EVAL_CASES) {
      results.push(await runEvalCase(evalCase));
    }

    const passed = results.filter((r) => r.passed).length;
    const failed = results.filter((r) => !r.passed).length;
    const totalDuration = results.reduce((s, r) => s + r.duration, 0);

    // Print scorecard
    const lines = [
      "",
      "=== EVAL SCORECARD ===",
      `Total: ${results.length} | Passed: ${passed} | Failed: ${failed}`,
      `Duration: ${totalDuration}ms`,
      "",
    ];

    for (const r of results) {
      const status = r.passed ? "PASS" : "FAIL";
      const tools = r.toolsCalled.length > 0
        ? ` [tools: ${r.toolsCalled.join(", ")}]`
        : " [no tools]";
      lines.push(`  ${status} ${r.name} (${r.duration}ms)${tools}`);
      if (!r.passed) {
        for (const f of r.failures) {
          lines.push(`    - ${f}`);
        }
      }
    }

    lines.push("");

    // Log scorecard (visible in test output)
    console.log(lines.join("\n"));

    assertEquals(failed, 0, `${failed}/${results.length} eval cases failed`);
  },
});

// ============================================================
// Live Eval (real LLM — skipped unless --live flag or HLVM_EVAL_LIVE=1)
// ============================================================

interface LiveEvalCase {
  name: string;
  query: string;
  assertions: EvalAssertion;
}

const LIVE_EVAL_CASES: LiveEvalCase[] = [
  {
    name: "live-greeting",
    query: "Hello! Just say 'Hi there!' and nothing else.",
    assertions: {
      maxToolCalls: 0,
    },
  },
  {
    name: "live-list-files",
    query: "List the files in the current workspace directory. Use list_files tool.",
    assertions: {
      toolsCalled: ["list_files"],
      minToolCalls: 1,
    },
  },
  {
    name: "live-git-status",
    query: "Check the git status of this workspace. Use git_status tool.",
    assertions: {
      toolsCalled: ["git_status"],
      minToolCalls: 1,
    },
  },
];

async function isLLMAvailable(): Promise<boolean> {
  try {
    const { ai } = await import("../../src/hlvm/api/ai.ts");
    const status = await ai.status();
    return status.available;
  } catch {
    return false;
  }
}

const isLiveMode = Deno.args.includes("--live") ||
  Deno.env.get("HLVM_EVAL_LIVE") === "1";

if (isLiveMode) {
  for (const liveCase of LIVE_EVAL_CASES) {
    Deno.test({
      name: `Live Eval: ${liveCase.name}`,
      async fn() {
        const available = await isLLMAvailable();
        if (!available) {
          console.log("  [SKIP] LLM not available");
          return;
        }

        const { generateSystemPrompt: genPrompt } =
          await import("../../src/hlvm/agent/llm-integration.ts");
        const { SdkAgentEngine } = await import(
          "../../src/hlvm/agent/engine-sdk.ts"
        );
        const { getConfiguredModel } = await import(
          "../../src/common/ai-default-model.ts"
        );

        const context = new ContextManager({
          maxTokens: 8000,
          overflowStrategy: "fail",
        });
        context.addMessage({ role: "system", content: genPrompt() });

        const toolsCalled: string[] = [];
        const onTrace = (event: TraceEvent) => {
          if (event.type === "tool_call") {
            toolsCalled.push(event.toolName);
          }
        };

        const platform = getPlatform();
        const workspace = platform.process.cwd();
        const llm = new SdkAgentEngine().createLLM({
          model: getConfiguredModel(),
        });

        const result = await runReActLoop(
          liveCase.query,
          {
            workspace,
            context,
            autoApprove: true,
            maxToolCalls: 5,
            onTrace,
          },
          llm,
        );

        // Check assertions
        const failures: string[] = [];
        const { assertions } = liveCase;

        if (assertions.toolsCalled) {
          for (const expected of assertions.toolsCalled) {
            if (!toolsCalled.includes(expected)) {
              failures.push(`Expected tool not called: "${expected}"`);
            }
          }
        }

        if (assertions.minToolCalls !== undefined) {
          if (toolsCalled.length < assertions.minToolCalls) {
            failures.push(
              `Expected >= ${assertions.minToolCalls} tool calls, got ${toolsCalled.length}`,
            );
          }
        }

        if (assertions.maxToolCalls !== undefined) {
          if (toolsCalled.length > assertions.maxToolCalls) {
            failures.push(
              `Expected <= ${assertions.maxToolCalls} tool calls, got ${toolsCalled.length}`,
            );
          }
        }

        // Save result for regression comparison
        try {
          const resultsDir = `${Deno.cwd()}/tests/eval/results`;
          await platform.fs.mkdir(resultsDir, { recursive: true });
          await platform.fs.writeTextFile(
            `${resultsDir}/${liveCase.name}.json`,
            JSON.stringify({
              name: liveCase.name,
              query: liveCase.query,
              result,
              toolsCalled,
              failures,
              timestamp: new Date().toISOString(),
            }, null, 2),
          );
        } catch {
          // Ignore results save errors
        }

        if (failures.length > 0) {
          throw new Error(
            `Live eval '${liveCase.name}' failed:\n  - ${failures.join("\n  - ")}`,
          );
        }
      },
    });
  }
}
