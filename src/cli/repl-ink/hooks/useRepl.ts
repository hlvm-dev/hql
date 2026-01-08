/**
 * HQL Ink REPL - State Hook
 * Manages REPL state, evaluation, and mode switching
 */

import { useState, useCallback, useRef } from "npm:react@18";
import { ReplState } from "../../repl/state.ts";
import { evaluate as hqlEvaluate } from "../../repl/evaluator.ts";
import { resolveAtMentions } from "../../repl/mention-resolver.ts";
import type { EvalResult } from "../types.ts";
import { attachmentsToContentBlocks, type AnyAttachment } from "../../repl/attachment-protocol.ts";

interface UseReplOptions {
  jsMode?: boolean;
  state?: ReplState;
}

export interface UseReplReturn {
  jsMode: boolean;
  evaluate: (code: string, attachments?: AnyAttachment[]) => Promise<EvalResult>;
  setJsMode: (mode: boolean) => void;
  reset: () => void;
  state: ReplState;
}

export function useRepl(options: UseReplOptions = {}): UseReplReturn {
  const { jsMode: initialJsMode = false, state: providedState } = options;
  const stateRef = useRef<ReplState>(providedState || new ReplState());
  const [jsMode, setJsMode] = useState(initialJsMode);

  const evaluate = useCallback(async (code: string, attachments?: AnyAttachment[]): Promise<EvalResult> => {
    const state = stateRef.current;
    const trimmed = code.trim();

    if (!trimmed) {
      return { success: true, suppressOutput: true };
    }

    state.addHistory(trimmed);
    state.nextLine();

    try {
      // Resolve @ mentions before evaluation
      const resolvedCode = await resolveAtMentions(code);

      // If attachments are present, prepare content blocks for AI backend
      // NOTE: Backend integration is a separate story. For now, we log and
      // proceed with normal evaluation. The attachments are formatted and
      // Prepare content blocks for when multimodal AI support is implemented.
      if (attachments && attachments.length > 0) {
        const contentBlocks = attachmentsToContentBlocks(resolvedCode, attachments);
        // The contentBlocks are ready to be sent to a multimodal AI API
        // when backend support is implemented
        void contentBlocks; // Suppress unused variable warning
      }

      // Pass attachments to evaluator for paste-N variable registration
      return await hqlEvaluate(resolvedCode, state, jsMode, attachments);
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error : new Error(String(error)),
      };
    }
  }, [jsMode]);

  const reset = useCallback(() => {
    stateRef.current.reset();
  }, []);

  return {
    jsMode,
    evaluate,
    setJsMode,
    reset,
    state: stateRef.current,
  };
}
