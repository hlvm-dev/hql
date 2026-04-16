/**
 * useAgentRunner — React hook for sending user queries to the AI agent
 * and processing streaming responses via the runtime host.
 *
 * Wraps `runChatViaHost` from `host-client.ts`, managing abort controllers,
 * interaction (permission) requests, and conversation state updates.
 */

import { useCallback, useRef, useState } from "react";
import type { UseConversationResult } from "./useConversation.ts";

// ---------------------------------------------------------------------------
// Interaction types (mirrors RuntimeInteractionRequest from host-client.ts)
// ---------------------------------------------------------------------------

export interface PendingInteraction {
  requestId: string;
  mode: "permission" | "question";
  toolName?: string;
  toolArgs?: string;
  question?: string;
  options?: Array<{ label: string; value: string }>;
  sourceLabel?: string;
  sourceThreadId?: string;
  resolve: (response: { approved?: boolean }) => void;
}

// ---------------------------------------------------------------------------
// Hook options & return type
// ---------------------------------------------------------------------------

export interface UseAgentRunnerOptions {
  /** The conversation hook instance (useConversation result). */
  conversation: UseConversationResult;
  /** Currently selected model ID (optional — runtime uses default if omitted). */
  activeModelId?: string;
}

export interface UseAgentRunnerResult {
  /** Send a user query and stream the agent response. */
  runConversation: (query: string) => Promise<void>;
  /** Abort the current run (if any). */
  interrupt: () => void;
  /** The current pending interaction request (permission prompt), or null. */
  pendingInteraction: PendingInteraction | null;
  /** Respond to a pending interaction request. */
  handleInteractionResponse: (requestId: string, approved: boolean) => void;
}

// ---------------------------------------------------------------------------
// Lazy import helper — avoids hard dependency on runtime modules at load time.
// Falls back to a stub that echoes the query when the real module is
// unavailable (e.g. during early TUI development or isolated tests).
// ---------------------------------------------------------------------------

type RunChatFn = (options: any) => Promise<any>;

let _runChatViaHost: RunChatFn | undefined;

async function getRunChatViaHost(): Promise<RunChatFn> {
  if (_runChatViaHost) return _runChatViaHost;
  try {
    const mod = await import("../../runtime/host-client.ts");
    _runChatViaHost = mod.runChatViaHost;
    return _runChatViaHost!;
  } catch {
    // Stub: echo the last user message content back after a short delay.
    _runChatViaHost = async (options: any) => {
      const lastMessage = options.messages?.at(-1);
      const content = typeof lastMessage?.content === "string"
        ? lastMessage.content
        : "...";
      const tokens = `[echo] ${content}`.split("");
      for (const ch of tokens) {
        if (options.signal?.aborted) break;
        options.callbacks?.onToken?.(ch);
        await new Promise((r) => setTimeout(r, 20));
      }
      return {
        text: `[echo] ${content}`,
        stats: { messageCount: 1, estimatedTokens: 0, toolMessages: 0 },
        sessionVersion: 0,
      };
    };
    return _runChatViaHost;
  }
}

// ---------------------------------------------------------------------------
// Hook implementation
// ---------------------------------------------------------------------------

export function useAgentRunner(
  options: UseAgentRunnerOptions,
): UseAgentRunnerResult {
  const { conversation, activeModelId } = options;

  const controllerRef = useRef<AbortController | null>(null);
  const interactionRef = useRef<PendingInteraction | null>(null);
  const [pendingInteraction, setPendingInteraction] =
    useState<PendingInteraction | null>(null);

  // -- interrupt --------------------------------------------------------------

  const interrupt = useCallback(() => {
    controllerRef.current?.abort();
    controllerRef.current = null;
  }, []);

  // -- handleInteractionResponse ---------------------------------------------

  const handleInteractionResponse = useCallback(
    (requestId: string, approved: boolean) => {
      const pending = interactionRef.current;
      if (pending && pending.requestId === requestId) {
        pending.resolve({ approved });
        interactionRef.current = null;
        setPendingInteraction(null);
      }
    },
    [],
  );

  // -- runConversation -------------------------------------------------------

  const runConversation = useCallback(
    async (query: string) => {
      // Abort any in-flight run.
      controllerRef.current?.abort();
      const controller = new AbortController();
      controllerRef.current = controller;

      // Add the user message to the conversation transcript.
      conversation.addUserMessage(query);

      try {
        const runChat = await getRunChatViaHost();

        await runChat({
          mode: "agent" as const,
          messages: [
            {
              role: "user",
              content: query,
              client_turn_id: crypto.randomUUID(),
            },
          ],
          model: activeModelId || undefined,
          signal: controller.signal,
          callbacks: {
            onToken: (text: string) => {
              conversation.addAssistantText(text, true);
            },
            onAgentEvent: (event: unknown) => {
              conversation.addEvent(event);
            },
          },
          onInteraction: (
            event: any,
          ): Promise<{ approved?: boolean }> => {
            return new Promise((resolve) => {
              const pending: PendingInteraction = {
                requestId: event.requestId,
                mode: event.mode,
                toolName: event.toolName,
                toolArgs: event.toolArgs,
                question: event.question,
                options: event.options,
                sourceLabel: event.sourceLabel,
                sourceThreadId: event.sourceThreadId,
                resolve,
              };
              interactionRef.current = pending;
              setPendingInteraction(pending);
            });
          },
        });

        conversation.finalize("completed");
      } catch (error: unknown) {
        if (controller.signal.aborted) {
          conversation.finalize("cancelled");
        } else {
          const message = error instanceof Error
            ? error.message
            : String(error);
          conversation.addError(message);
          conversation.finalize("failed");
        }
      } finally {
        if (controllerRef.current === controller) {
          controllerRef.current = null;
        }
      }
    },
    [conversation, activeModelId],
  );

  return {
    runConversation,
    interrupt,
    pendingInteraction,
    handleInteractionResponse,
  };
}
