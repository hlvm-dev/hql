import type { ReplState } from "./state.ts";

type PromptHistorySource =
  | "evaluate"
  | "command"
  | "conversation"
  | "interaction";

export function shouldRecordPromptHistory(
  source: PromptHistorySource,
): boolean {
  return true;
}

export function recordPromptHistory(
  replState: Pick<ReplState, "addHistory">,
  input: string,
  source: PromptHistorySource,
): void {
  if (!shouldRecordPromptHistory(source)) {
    return;
  }
  replState.addHistory(input);
}
