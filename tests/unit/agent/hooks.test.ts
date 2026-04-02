import {
  assertEquals,
  assertExists,
} from "jsr:@std/assert";
import { runAgentQuery } from "../../../src/hlvm/agent/agent-runner.ts";
import { getPlatform } from "../../../src/platform/platform.ts";

const platform = getPlatform();
const HOOK_RECORDER_PATH = platform.path.fromFileUrl(
  new URL("../../fixtures/agent-hook-recorder.ts", import.meta.url),
);

async function createHookFixture(workspace: string): Promise<string> {
  const fixturePath = platform.path.join(workspace, "hooks-fixture.json");
  await platform.fs.writeTextFile(
    platform.path.join(workspace, "demo.txt"),
    "hook fixture content\n",
  );

  const fixture = {
    version: 1,
    name: "hook fixture",
    cases: [
      {
        name: "tool-run",
        match: { contains: ["hook tool smoke"] },
        steps: [
          {
            toolCalls: [{
              id: "read_1",
              toolName: "read_file",
              args: { path: "demo.txt" },
            }],
          },
          { response: "Hook tool response" },
        ],
      },
      {
        name: "text-run",
        match: { contains: ["hook text smoke"] },
        steps: [{ response: "Hook text response" }],
      },
      {
        name: "continuation-run",
        match: { contains: ["hook continuation smoke"] },
        steps: [
          {
            response:
              "Leading answer segment repeated-overlap-segment repeated-overlap-segment ",
            completionState: "truncated_max_tokens",
          },
          {
            response:
              "repeated-overlap-segment repeated-overlap-segment tail.",
            completionState: "complete",
          },
        ],
      },
    ],
  };

  await platform.fs.writeTextFile(fixturePath, JSON.stringify(fixture, null, 2));
  return fixturePath;
}

async function writeHooksConfig(
  workspace: string,
  hooks: Record<string, unknown>,
): Promise<void> {
  const hooksDir = platform.path.join(workspace, ".hlvm");
  await platform.fs.mkdir(hooksDir, { recursive: true });
  await platform.fs.writeTextFile(
    platform.path.join(hooksDir, "hooks.json"),
    JSON.stringify({ version: 1, hooks }, null, 2),
  );
}

function parseJsonLines(text: string): Array<{
  hook: string;
  payload: Record<string, unknown>;
}> {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

Deno.test({
  name: "agent hooks: runAgentQuery dispatches lifecycle hooks in order",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const workspace = await platform.fs.makeTempDir({ prefix: "hlvm-hooks-" });
    try {
      const fixturePath = await createHookFixture(workspace);
      const logPath = platform.path.join(workspace, "hook-log.jsonl");
      await writeHooksConfig(workspace, {
        pre_llm: [{
          command: [Deno.execPath(), "run", "-A", HOOK_RECORDER_PATH, logPath],
        }],
        post_llm: [{
          command: [Deno.execPath(), "run", "-A", HOOK_RECORDER_PATH, logPath],
        }],
        pre_tool: [{
          command: [Deno.execPath(), "run", "-A", HOOK_RECORDER_PATH, logPath],
        }],
        post_tool: [{
          command: [Deno.execPath(), "run", "-A", HOOK_RECORDER_PATH, logPath],
        }],
        final_response: [{
          command: [Deno.execPath(), "run", "-A", HOOK_RECORDER_PATH, logPath],
        }],
      });

      const result = await runAgentQuery({
        query: "hook tool smoke",
        model: "ollama/test-fixture",
        fixturePath,
        workspace,
        callbacks: {},
      });

      assertEquals(result.text, "Hook tool response");
      const hookLog = await platform.fs.readTextFile(logPath);
      const events = parseJsonLines(hookLog);
      assertEquals(
        events.map((event) => event.hook),
        [
          "pre_llm",
          "post_llm",
          "pre_tool",
          "post_tool",
          "pre_llm",
          "post_llm",
          "final_response",
        ],
      );
      assertEquals(events[2]?.payload?.toolName, "read_file");
      assertEquals(events[1]?.payload?.completionState, "tool_calls");
      assertEquals(events[5]?.payload?.completionState, "complete");
      assertEquals(events[6]?.payload?.text, "Hook tool response");
    } finally {
      await platform.fs.remove(workspace, { recursive: true });
    }
  },
});

Deno.test({
  name: "agent hooks: timeout and failing hooks do not abort the agent run",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const workspace = await platform.fs.makeTempDir({ prefix: "hlvm-hooks-fail-open-" });
    try {
      const fixturePath = await createHookFixture(workspace);
      const logPath = platform.path.join(workspace, "hook-fail-open.jsonl");
      await writeHooksConfig(workspace, {
        pre_llm: [
          {
            command: [Deno.execPath(), "run", "-A", HOOK_RECORDER_PATH, logPath, "sleep"],
            timeoutMs: 50,
          },
          {
            command: [Deno.execPath(), "run", "-A", HOOK_RECORDER_PATH, logPath, "fail"],
          },
        ],
        final_response: [{
          command: [Deno.execPath(), "run", "-A", HOOK_RECORDER_PATH, logPath],
        }],
      });

      const result = await runAgentQuery({
        query: "hook text smoke",
        model: "ollama/test-fixture",
        fixturePath,
        workspace,
        callbacks: {},
      });

      assertEquals(result.text, "Hook text response");
      const hookLog = await platform.fs.readTextFile(logPath);
      const events = parseJsonLines(hookLog);
      const finalEvent = events.find((event) => event.hook === "final_response");
      assertExists(finalEvent);
      assertEquals(finalEvent.payload.text, "Hook text response");
    } finally {
      await platform.fs.remove(workspace, { recursive: true });
    }
  },
});

Deno.test({
  name:
    "agent hooks: continuation metadata is included in post_llm and final_response payloads",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const workspace = await platform.fs.makeTempDir({
      prefix: "hlvm-hooks-continuation-",
    });
    try {
      const fixturePath = await createHookFixture(workspace);
      const logPath = platform.path.join(workspace, "hook-continuation.jsonl");
      await writeHooksConfig(workspace, {
        post_llm: [{
          command: [Deno.execPath(), "run", "-A", HOOK_RECORDER_PATH, logPath],
        }],
        final_response: [{
          command: [Deno.execPath(), "run", "-A", HOOK_RECORDER_PATH, logPath],
        }],
      });

      const result = await runAgentQuery({
        query: "hook continuation smoke",
        model: "ollama/test-fixture",
        fixturePath,
        workspace,
        callbacks: {},
      });

      assertEquals(result.text.includes("tail."), true);
      const hookLog = await platform.fs.readTextFile(logPath);
      const events = parseJsonLines(hookLog);
      const postLlmEvents = events.filter((event) => event.hook === "post_llm");
      const finalEvent = events.find((event) => event.hook === "final_response");
      assertEquals(postLlmEvents.length, 2);
      assertEquals(postLlmEvents[0]?.payload?.completionState, "truncated_max_tokens");
      assertEquals(postLlmEvents[1]?.payload?.continuedThisTurn, true);
      assertEquals(postLlmEvents[1]?.payload?.continuationCount, 1);
      assertExists(finalEvent);
      assertEquals(finalEvent.payload.continuedThisTurn, true);
      assertEquals(finalEvent.payload.continuationCount, 1);
    } finally {
      await platform.fs.remove(workspace, { recursive: true });
    }
  },
});
