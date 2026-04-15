import type { ConversationAttachmentPayload } from "../attachments/types.ts";
import {
  createCompositeEventSink,
  createReadableStreamEventSink,
} from "./agent-events.ts";
import { composeAbortSignals } from "./concurrency.ts";
import { ContextManager } from "./context.ts";
import {
  type AgentEvent,
  type AgentEventSink,
  type AgentLoopResult,
  type OrchestratorConfig,
  runReActLoop,
} from "./orchestrator.ts";
import type { LLMFunction } from "./orchestrator-llm.ts";

export interface AgentRunOptions {
  config?: Partial<OrchestratorConfig>;
  llmFunction?: LLMFunction;
  attachments?: ConversationAttachmentPayload[];
  eventSink?: AgentEventSink;
  signal?: AbortSignal;
}

/**
 * Handle returned by `agent.start()`.
 *
 * `events` contains UI events, trace events, and the final result event.
 * NOTE: LLM token-streaming events are NOT included in the stream because
 * the provider's token callback is captured at session creation time,
 * before the event sink is wired.  Token streaming goes directly through
 * the `onToken` callback on OrchestratorConfig.  Use `agent.run()` with
 * an `onToken` callback for real-time token delivery.
 */
export interface AgentStartHandle {
  result: Promise<AgentLoopResult>;
  events: ReadableStream<AgentEvent>;
  cancel(reason?: unknown): void;
}

export interface Agent {
  run(prompt: string, options?: AgentRunOptions): Promise<AgentLoopResult>;
  start(prompt: string, options?: AgentRunOptions): AgentStartHandle;
  fork(
    overrides: Partial<OrchestratorConfig> & {
      llmFunction?: LLMFunction;
      attachments?: ConversationAttachmentPayload[];
    },
  ): Agent;
}

export interface CreateAgentOptions {
  config: OrchestratorConfig;
  llmFunction: LLMFunction;
  attachments?: ConversationAttachmentPayload[];
}

function mergeRunConfig(
  baseConfig: OrchestratorConfig,
  overrideConfig: Partial<OrchestratorConfig> | undefined,
  options: Pick<AgentRunOptions, "eventSink" | "signal">,
): OrchestratorConfig {
  const merged = {
    ...baseConfig,
    ...(overrideConfig ?? {}),
  } as OrchestratorConfig;
  const signal = composeAbortSignals([
    baseConfig.signal,
    overrideConfig?.signal,
    options.signal,
  ]);
  if (signal) merged.signal = signal;
  if (options.eventSink) {
    merged.eventSink = merged.eventSink
      ? createCompositeEventSink([merged.eventSink, options.eventSink])
      : options.eventSink;
  }
  return merged;
}

export function createAgent(options: CreateAgentOptions): Agent {
  const baseConfig = { ...options.config } as OrchestratorConfig;
  const baseAttachments = options.attachments;
  const baseLlmFunction = options.llmFunction;

  return {
    run(prompt, runOptions = {}) {
      return runReActLoop(
        prompt,
        mergeRunConfig(baseConfig, runOptions.config, runOptions),
        runOptions.llmFunction ?? baseLlmFunction,
        runOptions.attachments ?? baseAttachments,
      );
    },
    start(prompt, runOptions = {}) {
      const controller = new AbortController();
      const { sink, stream } = createReadableStreamEventSink();
      const signal = composeAbortSignals([
        runOptions.signal,
        controller.signal,
      ]);
      const result = this.run(prompt, {
        ...runOptions,
        eventSink: runOptions.eventSink
          ? createCompositeEventSink([runOptions.eventSink, sink])
          : sink,
        signal,
      });
      result.catch((error) => sink.error?.(error));
      return {
        result,
        events: stream,
        cancel(reason?: unknown) {
          controller.abort(reason);
        },
      };
    },
    fork(overrides) {
      const { llmFunction, attachments, ...configOverrides } = overrides;
      // Fork MUST get an isolated ContextManager — sharing context between
      // concurrent agents corrupts message history.
      const forkedConfig = {
        ...baseConfig,
        ...configOverrides,
      } as OrchestratorConfig;
      if (!configOverrides.context) {
        forkedConfig.context = new ContextManager(
          baseConfig.context?.getConfig?.(),
        );
      }
      return createAgent({
        config: forkedConfig,
        llmFunction: llmFunction ?? baseLlmFunction,
        attachments: attachments ?? baseAttachments,
      });
    },
  };
}
