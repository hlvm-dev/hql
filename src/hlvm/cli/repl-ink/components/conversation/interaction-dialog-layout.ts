import type { InteractionRequestEvent } from "../../../../agent/registry.ts";

const CONFIRMATION_DIALOG_MAX_ARG_LINES = 10;
export const QUESTION_DIALOG_HINT =
  "Answer at answer> below, then press Enter";

interface ConfirmationDialogDisplay {
  isPlanReview: boolean;
  visibleArgLines: string[];
  hiddenArgLines: number;
}

function estimateWrappedTextRows(text: string, width: number): number {
  if (!text) return 0;
  const usableWidth = Math.max(1, width);
  return text.split("\n").reduce((rows: number, line: string) => {
    const chars = Array.from(line).length;
    return rows + Math.max(1, Math.ceil(chars / usableWidth));
  }, 0);
}

export function getConfirmationDialogDisplay(
  toolName?: string,
  toolArgs?: string,
): ConfirmationDialogDisplay {
  const isPlanReview = toolName === "plan_review";
  if (!toolArgs) {
    return {
      isPlanReview,
      visibleArgLines: [],
      hiddenArgLines: 0,
    };
  }

  const parsedArgs = (() => {
    try {
      return JSON.stringify(JSON.parse(toolArgs), null, 2).split("\n");
    } catch {
      return toolArgs.split("\n");
    }
  })();

  const visibleArgLines = parsedArgs.slice(0, CONFIRMATION_DIALOG_MAX_ARG_LINES);
  return {
    isPlanReview,
    visibleArgLines,
    hiddenArgLines: Math.max(0, parsedArgs.length - visibleArgLines.length),
  };
}

function estimateConfirmationDialogRows(
  toolName: string | undefined,
  toolArgs: string | undefined,
  width: number,
): number {
  const contentWidth = Math.max(18, width - 6);
  const dialog = getConfirmationDialogDisplay(toolName, toolArgs);
  let rows = 2; // header + bottom actions

  if (toolName) {
    rows += 1;
  }

  if (dialog.visibleArgLines.length > 0) {
    rows += 1; // Args/Plan label
    rows += dialog.visibleArgLines.reduce(
      (total: number, line: string) =>
        total + estimateWrappedTextRows(line, Math.max(12, contentWidth - 2)),
      0,
    );
    if (dialog.hiddenArgLines > 0) {
      rows += 1;
    }
  }

  return rows + 2; // border + spacing
}

function estimateQuestionDialogRows(
  question: string | undefined,
  width: number,
): number {
  const contentWidth = Math.max(18, width - 6);
  let rows = 2; // header + hint

  if (question) {
    rows += estimateWrappedTextRows(question, contentWidth);
  }

  rows += estimateWrappedTextRows(QUESTION_DIALOG_HINT, contentWidth);
  return rows + 2; // border + spacing
}

function estimateInteractionDialogRows(
  request: InteractionRequestEvent | undefined,
  width: number,
): number {
  if (!request) return 0;
  if (request.mode === "question") {
    return estimateQuestionDialogRows(request.question, width);
  }
  return estimateConfirmationDialogRows(
    request.toolName,
    request.toolArgs,
    width,
  );
}
