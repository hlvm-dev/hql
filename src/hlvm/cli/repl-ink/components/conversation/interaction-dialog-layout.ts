import type { InteractionRequestEvent } from "../../../../agent/registry.ts";
import type { Plan } from "../../../../agent/planning.ts";
import { isObjectValue } from "../../../../../common/utils.ts";

const CONFIRMATION_DIALOG_MAX_ARG_LINES = 10;
const PLAN_REVIEW_MAX_STEPS = 6;
export const QUESTION_DIALOG_HINT = "Answer at answer> below, then press Enter";

export interface PlanReviewDialogDisplay {
  plan: Plan;
  visibleSteps: Plan["steps"];
  hiddenStepCount: number;
}

interface ConfirmationDialogDisplay {
  isPlanReview: boolean;
  planReview?: PlanReviewDialogDisplay;
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

function parsePlanReview(
  toolName?: string,
  toolArgs?: string,
): Plan | undefined {
  if (toolName !== "plan_review" || !toolArgs) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(toolArgs);
  } catch {
    return undefined;
  }
  if (
    !isObjectValue(parsed) || typeof parsed.goal !== "string" ||
    !Array.isArray(parsed.steps)
  ) {
    return undefined;
  }
  const steps = parsed.steps.flatMap((step): Plan["steps"] => {
    if (
      !isObjectValue(step) || typeof step.id !== "string" ||
      typeof step.title !== "string"
    ) {
      return [];
    }
    return [{
      id: step.id,
      title: step.title,
      goal: typeof step.goal === "string" ? step.goal : undefined,
      tools: Array.isArray(step.tools)
        ? step.tools.filter((tool): tool is string => typeof tool === "string")
        : undefined,
      successCriteria: Array.isArray(step.successCriteria)
        ? step.successCriteria.filter((item): item is string =>
          typeof item === "string"
        )
        : undefined,
      agent: typeof step.agent === "string" ? step.agent : undefined,
    }];
  });
  if (steps.length !== parsed.steps.length) return undefined;
  return {
    goal: parsed.goal,
    steps,
  };
}

export function getConfirmationDialogDisplay(
  toolName?: string,
  toolArgs?: string,
): ConfirmationDialogDisplay {
  const isPlanReview = toolName === "plan_review";
  const parsedPlanReview = parsePlanReview(toolName, toolArgs);
  if (parsedPlanReview) {
    return {
      isPlanReview,
      planReview: {
        plan: parsedPlanReview,
        visibleSteps: parsedPlanReview.steps.slice(0, PLAN_REVIEW_MAX_STEPS),
        hiddenStepCount: Math.max(
          0,
          parsedPlanReview.steps.length - PLAN_REVIEW_MAX_STEPS,
        ),
      },
      visibleArgLines: [],
      hiddenArgLines: 0,
    };
  }
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

  const visibleArgLines = parsedArgs.slice(
    0,
    CONFIRMATION_DIALOG_MAX_ARG_LINES,
  );
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

  if (dialog.planReview) {
    rows += 1; // Goal label
    rows += estimateWrappedTextRows(dialog.planReview.plan.goal, contentWidth);
    rows += 1; // Steps label
    rows += dialog.planReview.visibleSteps.reduce(
      (total: number, step, index: number) =>
        total +
        estimateWrappedTextRows(
          `${index + 1}. ${step.title}`,
          Math.max(12, contentWidth - 2),
        ),
      0,
    );
    if (dialog.planReview.hiddenStepCount > 0) {
      rows += 1;
    }
    return rows + 2; // border + spacing
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

export function estimateInteractionDialogRows(
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
