/**
 * HLVM Ink REPL - State Hook
 * Manages REPL state, evaluation, and mode switching
 */

import { useCallback, useRef } from "react";
import { ReplState } from "../../repl/state.ts";
import { evaluate as hqlEvaluate } from "../../repl/evaluator.ts";
import { resolveAtMentions } from "../../repl/mention-resolver.ts";
import type { EvalResult } from "../types.ts";
import type { AnyAttachment } from "../../repl/attachment.ts";
import { ensureError } from "../../../../common/utils.ts";

interface UseReplOptions {
  state?: ReplState;
}

interface EvaluateOptions {
  attachments?: AnyAttachment[];
  /** AbortSignal for cancellation support */
  signal?: AbortSignal;
}

interface UseReplReturn {
  evaluate: (code: string, options?: EvaluateOptions) => Promise<EvalResult>;
  reset: () => void;
  state: ReplState;
}

export function useRepl(options: UseReplOptions = {}): UseReplReturn {
  const { state: providedState } = options;
  const stateRef = useRef<ReplState>(providedState || new ReplState());

  const evaluate = useCallback(async (code: string, options?: EvaluateOptions): Promise<EvalResult> => {
    const { attachments, signal } = options ?? {};
    const state = stateRef.current;
    const trimmed = code.trim();

    if (!trimmed) {
      return { success: true, suppressOutput: true };
    }

    // Check if already aborted before starting
    if (signal?.aborted) {
      return { success: false, error: new Error("Cancelled") };
    }

    state.nextLine();

    try {
      // Resolve @ mentions before evaluation
      const resolvedCode = await resolveAtMentions(code);

      // Check abort after async operation
      if (signal?.aborted) {
        return { success: false, error: new Error("Cancelled") };
      }

      // Pass attachments and signal to evaluator
      return await hqlEvaluate(resolvedCode, state, attachments, signal);
    } catch (error) {
      // Check if this was an abort error
      if (error instanceof Error && error.name === "AbortError") {
        return { success: false, error: new Error("Cancelled") };
      }
      return {
        success: false,
        error: ensureError(error),
      };
    }
  }, []);

  const reset = useCallback(() => {
    stateRef.current.reset();
  }, []);

  return {
    evaluate,
    reset,
    state: stateRef.current,
  };
}
