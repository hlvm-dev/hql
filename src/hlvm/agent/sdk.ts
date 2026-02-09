/**
 * HLVM Agent SDK — Thin wrapper over agent internals for programmatic use.
 *
 * @example
 * ```typescript
 * import { Agent } from "@hlvm/hql/agent";
 *
 * const agent = new Agent();
 * const r1 = await agent.chat("read config.json");
 * const r2 = await agent.chat("change port to 3000"); // remembers r1
 * console.log(r2.text);
 * await agent.dispose();
 * ```
 */

import { initializeRuntime } from "../../common/runtime-initializer.ts";
import { getConfiguredModel } from "../../common/ai-default-model.ts";
import { getPlatform } from "../../platform/platform.ts";
import { createAgentSession } from "./session.ts";
import { runReActLoop } from "./orchestrator.ts";
import { DEFAULT_TOOL_DENYLIST } from "./constants.ts";
import type { AgentSession } from "./session.ts";
import type { TraceEvent } from "./orchestrator.ts";

/** Configuration for the Agent SDK. */
export interface AgentConfig {
  /** Model identifier (e.g. "ollama/llama3.1:8b", "openai/gpt-4o"). Defaults to configured model. */
  model?: string;
  /** Working directory for tool execution. Defaults to cwd. */
  workspace?: string;
  /** Tool denylist override. Defaults to DEFAULT_TOOL_DENYLIST. */
  toolDenylist?: string[];
  /** Tool allowlist override. */
  toolAllowlist?: string[];
  /** Trace callback for observability. */
  onTrace?: (event: TraceEvent) => void;
  /** Token streaming callback. */
  onToken?: (text: string) => void;
}

/** Result from a single chat turn. */
export interface ChatResult {
  /** Final text response from the agent. */
  text: string;
  /** Tool calls made during this turn. */
  toolCalls: Array<{ name: string; args: unknown; result?: unknown }>;
}

/** Programmatic agent interface with conversation memory. */
export class Agent {
  private config: AgentConfig;
  private session: AgentSession | null = null;
  private initialized = false;

  constructor(config: AgentConfig = {}) {
    this.config = config;
  }

  /** Lazy initialization — called once on first chat(). */
  private async ensureInit(): Promise<void> {
    if (this.initialized) return;

    await initializeRuntime({ ai: true });

    const model = this.config.model ?? getConfiguredModel();
    const workspace = this.config.workspace ?? getPlatform().process.cwd();

    this.session = await createAgentSession({
      workspace,
      model,
      toolDenylist: this.config.toolDenylist ??
        [...DEFAULT_TOOL_DENYLIST],
      toolAllowlist: this.config.toolAllowlist,
      onToken: this.config.onToken,
    });

    this.initialized = true;
  }

  /** Send a message and get a response. Context accumulates across calls. */
  async chat(prompt: string): Promise<ChatResult> {
    await this.ensureInit();
    const session = this.session!;

    const toolCalls: ChatResult["toolCalls"] = [];
    const onTrace = (event: TraceEvent): void => {
      if (event.type === "tool_call") {
        toolCalls.push({ name: event.toolName, args: event.args });
      }
      if (event.type === "tool_result") {
        const last = toolCalls.findLast((tc) => tc.name === event.toolName);
        if (last) last.result = event.result;
      }
      this.config.onTrace?.(event);
    };

    const text = await runReActLoop(
      prompt,
      {
        workspace: this.config.workspace ?? getPlatform().process.cwd(),
        context: session.context,
        autoApprove: true,
        groundingMode: "off",
        policy: session.policy,
        onTrace,
        noInput: true,
        planning: { mode: "off", requireStepMarkers: false },
        skipModelCompensation: session.isFrontierModel,
      },
      session.llm,
    );

    return { text, toolCalls };
  }

  /** Clean up resources. Safe to call multiple times. */
  async dispose(): Promise<void> {
    if (this.session) {
      await this.session.dispose();
      this.session = null;
    }
    this.initialized = false;
  }

  /** One-shot: create agent, run single prompt, dispose. */
  static async run(
    prompt: string,
    config?: AgentConfig,
  ): Promise<ChatResult> {
    const agent = new Agent(config);
    try {
      return await agent.chat(prompt);
    } finally {
      await agent.dispose();
    }
  }
}
