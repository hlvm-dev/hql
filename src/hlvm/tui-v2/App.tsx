/**
 * App.tsx — Main orchestrator component for TUI v2.
 *
 * Composes Transcript, ChatInput, StatusLine, and PermissionPrompt,
 * wiring user input through InputDispatch to the agent runner.
 */

import React, { useCallback } from "react";
import Box from "./ink/components/Box.tsx";
import useInput from "./ink/hooks/use-input.ts";
import { useAppState, useAppDispatch } from "./state/context.tsx";
import { useConversation } from "./hooks/useConversation.ts";
import { useAgentRunner } from "./hooks/useAgentRunner.ts";
import { classifyInput } from "./input/InputDispatch.ts";
import ChatInput from "./input/ChatInput.tsx";
import Transcript from "./transcript/Transcript.tsx";
import StatusLine from "./status/StatusLine.tsx";
import PermissionPrompt from "./permissions/PermissionPrompt.tsx";

export default function App() {
  const state = useAppState();
  const dispatch = useAppDispatch();
  const conversation = useConversation();
  const { runConversation, interrupt, pendingInteraction, handleInteractionResponse } =
    useAgentRunner({ conversation, activeModelId: state.activeModelId ?? undefined });

  const handleSubmit = useCallback((text: string) => {
    const classification = classifyInput(text, state.inputMode);
    switch (classification.kind) {
      case "conversation":
        dispatch({ type: "set_loading", loading: true });
        runConversation(text).finally(() =>
          dispatch({ type: "set_loading", loading: false }),
        );
        break;
      case "hql_eval":
        conversation.addHqlEval(text, "[HQL eval not yet implemented]");
        break;
      case "js_eval":
        conversation.addHqlEval(text, "[JS eval not yet implemented]");
        break;
      case "command":
        conversation.addInfo(
          `/${classification.name} ${classification.args}`.trim(),
        );
        break;
      case "shell":
        conversation.addInfo(`$ ${classification.command}`);
        break;
      case "noop":
        break;
    }
  }, [state.inputMode, runConversation, conversation, dispatch]);

  // Ctrl+C interrupt for in-flight agent runs
  useInput((input, key) => {
    if (input === "c" && key.ctrl) interrupt();
  });

  return (
    <Box flexDirection="column">
      <Transcript items={conversation.items} />
      {pendingInteraction && (
        <PermissionPrompt
          toolName={pendingInteraction.toolName ?? "Tool"}
          description={pendingInteraction.question ?? "Allow this action?"}
          onAllow={() =>
            handleInteractionResponse(pendingInteraction.requestId, true)
          }
          onDeny={() =>
            handleInteractionResponse(pendingInteraction.requestId, false)
          }
        />
      )}
      <ChatInput onSubmit={handleSubmit} isLoading={state.isLoading} />
      <StatusLine />
    </Box>
  );
}
