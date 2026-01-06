/**
 * HQL Ink REPL - State Hook
 * Manages REPL state, evaluation, and mode switching
 */

import { useState, useCallback, useRef } from "npm:react@18";
import { ReplState } from "../../repl/state.ts";
import { evaluate as hqlEvaluate } from "../../repl/evaluator.ts";
import { resolveAtMentions } from "../../repl/mention-resolver.ts";
import type { EvalResult } from "../types.ts";

interface UseReplOptions {
  jsMode?: boolean;
  state?: ReplState;
}

export interface UseReplReturn {
  jsMode: boolean;
  evaluate: (code: string) => Promise<EvalResult>;
  setJsMode: (mode: boolean) => void;
  reset: () => void;
  state: ReplState;
}

export function useRepl(options: UseReplOptions = {}): UseReplReturn {
  const { jsMode: initialJsMode = false, state: providedState } = options;
  const stateRef = useRef<ReplState>(providedState || new ReplState());
  const [jsMode, setJsMode] = useState(initialJsMode);

  const evaluate = useCallback(async (code: string): Promise<EvalResult> => {
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
      return await hqlEvaluate(resolvedCode, state, jsMode);
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
