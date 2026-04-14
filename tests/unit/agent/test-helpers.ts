/**
 * Shared test helpers for agent tests.
 *
 * Provides scripted LLM, context factory, and tool registry helpers
 * used by engine-harness.test.ts, etc.
 */

import { assertStringIncludes } from "jsr:@std/assert";
import type {
  LLMFunction,
  ToolCall,
} from "../../../src/hlvm/agent/orchestrator.ts";
import { ContextManager } from "../../../src/hlvm/agent/context.ts";
import { TOOL_REGISTRY } from "../../../src/hlvm/agent/registry.ts";
import { generateSystemPrompt } from "../../../src/hlvm/agent/llm-integration.ts";
import { ENGINE_PROFILES } from "../../../src/hlvm/agent/constants.ts";

export interface ScriptedStep {
  content?: string;
  toolCalls?: ToolCall[];
  expectLastIncludes?: string;
}

export function createScriptedLLM(steps: ScriptedStep[]): LLMFunction {
  let index = 0;
  return (messages, signal) => {
    if (signal?.aborted) {
      const err = new Error("LLM aborted");
      err.name = "AbortError";
      throw err;
    }
    if (index >= steps.length) {
      throw new Error(
        `Scripted LLM exhausted steps (called ${index + 1} times, only ${steps.length} steps)`,
      );
    }
    const step = steps[index++];
    if (step.expectLastIncludes) {
      const last = messages[messages.length - 1];
      assertStringIncludes(last.content, step.expectLastIncludes);
    }
    return Promise.resolve({
      content: step.content ?? "",
      toolCalls: step.toolCalls ?? [],
    });
  };
}

export function createContext(): ContextManager {
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

export function addFakeTool(name: string, result: unknown): void {
  TOOL_REGISTRY[name] = {
    fn: () => Promise.resolve(result),
    description: "Fake tool for deterministic tests",
    args: {},
    skipValidation: true,
  };
}

export function addValidatingTool(
  name: string,
  result: unknown,
  args: Record<string, string>,
): void {
  TOOL_REGISTRY[name] = {
    fn: () => Promise.resolve(result),
    description: "Fake tool for deterministic tests",
    args,
  };
}

export function addFailingTool(name: string, message: string): void {
  TOOL_REGISTRY[name] = {
    fn: () => Promise.reject(new Error(message)),
    description: "Fake failing tool for deterministic tests",
    args: {},
    skipValidation: true,
  };
}

export function removeTool(name: string): void {
  delete TOOL_REGISTRY[name];
}

export function overrideTool(
  name: string,
  tool: typeof TOOL_REGISTRY[string],
): () => void {
  const original = TOOL_REGISTRY[name];
  TOOL_REGISTRY[name] = tool;
  return () => {
    if (original) {
      TOOL_REGISTRY[name] = original;
    } else {
      delete TOOL_REGISTRY[name];
    }
  };
}
