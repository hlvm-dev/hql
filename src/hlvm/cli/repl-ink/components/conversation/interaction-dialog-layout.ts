import type { InteractionRequestEvent } from "../../../../agent/registry.ts";
import type { Plan } from "../../../../agent/planning.ts";
import { isObjectValue } from "../../../../../common/utils.ts";

const CONFIRMATION_DIALOG_MAX_ARG_LINES = 10;
const PLAN_REVIEW_MAX_STEPS = 6;
export const QUESTION_DIALOG_HINT = "Type reply · Enter";
export const QUESTION_PICKER_HINT = "Esc · Tab amend";
export const PLAN_REVIEW_PICKER_HINT = "Esc · Tab amend";

interface PlanReviewDialogDisplay {
  plan: Plan;
  visibleSteps: Plan["steps"];
  hiddenStepCount: number;
  verificationLines: string[];
}

interface QuestionDialogDisplay {
  question?: string;
  options: {
    label: string;
    value: string;
    detail?: string;
    recommended?: boolean;
  }[];
  usesPicker: boolean;
}

interface ConfirmationDialogDisplay {
  isPlanReview: boolean;
  planReview?: PlanReviewDialogDisplay;
  requestKind: "generic" | "shell" | "url";
  focusText?: string;
  supportText?: string;
  warningText?: string;
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

export function parsePlanReviewToolArgs(
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

function normalizeQuestionOptions(
  options: InteractionRequestEvent["options"],
): QuestionDialogDisplay["options"] {
  return (options ?? []).flatMap((option) => {
    if (!option || typeof option.label !== "string") return [];
    const label = option.label.trim();
    if (!label) return [];
    return [{
      label,
      value: typeof option.value === "string" && option.value.trim().length > 0
        ? option.value.trim()
        : label,
      detail: typeof option.detail === "string" && option.detail.trim().length > 0
        ? option.detail.trim()
        : undefined,
      recommended: option.recommended === true,
    }];
  });
}

export function getQuestionDialogDisplay(
  question?: string,
  options?: InteractionRequestEvent["options"],
): QuestionDialogDisplay {
  const normalizedOptions = normalizeQuestionOptions(options);
  return {
    question,
    options: normalizedOptions,
    usesPicker: normalizedOptions.length > 0,
  };
}

export function isPickerInteractionRequest(
  request: InteractionRequestEvent | undefined,
): boolean {
  if (!request) return false;
  if (request.mode === "permission") {
    return true;
  }
  return getQuestionDialogDisplay(request.question, request.options).usesPicker;
}

function toRecord(value: unknown): Record<string, unknown> | undefined {
  return isObjectValue(value) ? value : undefined;
}

function normalizeDisplayString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function extractStructuredToolArgs(toolArgs?: string): unknown {
  if (!toolArgs) return undefined;
  const jsonStart = toolArgs.search(/[{\[]/);
  if (jsonStart < 0) return undefined;
  try {
    return JSON.parse(toolArgs.slice(jsonStart));
  } catch {
    return undefined;
  }
}

function resolveConfirmationArgsRecord(
  toolInput: unknown,
  toolArgs?: string,
): Record<string, unknown> | undefined {
  return toRecord(toolInput) ?? toRecord(extractStructuredToolArgs(toolArgs));
}

function extractPermissionWarning(toolArgs?: string): string | undefined {
  if (!toolArgs) return undefined;
  const jsonStart = toolArgs.search(/[{\[]/);
  if (jsonStart <= 0) return undefined;
  const warningText = toolArgs.slice(0, jsonStart).trim();
  return warningText.length > 0 ? warningText : undefined;
}

function extractFirstUrlFromArgs(toolArgs?: string): string | undefined {
  if (!toolArgs) return undefined;
  const match = toolArgs.match(/https?:\/\/[^\s"'}\]]+/);
  if (!match?.[0]) return undefined;
  try {
    return new URL(match[0]).toString();
  } catch {
    return undefined;
  }
}

function isWebFetchPermissionTool(normalizedToolName?: string): boolean {
  return normalizedToolName === "web_fetch" || normalizedToolName === "fetch_url" ||
    normalizedToolName === "fetch";
}

function isBrowserPermissionTool(normalizedToolName?: string): boolean {
  return normalizedToolName?.startsWith("pw_") === true ||
    normalizedToolName?.includes("browser") === true;
}

function buildUrlPermissionSupportText(
  normalizedToolName: string | undefined,
  permissionUrl: string,
): string | undefined {
  let hostname: string | undefined;
  try {
    hostname = new URL(permissionUrl).hostname;
  } catch {
    hostname = undefined;
  }

  if (isWebFetchPermissionTool(normalizedToolName)) {
    return hostname
      ? `HLVM wants to fetch content from ${hostname}.`
      : "HLVM wants to fetch this content.";
  }
  if (isBrowserPermissionTool(normalizedToolName)) {
    return hostname
      ? `HLVM wants to open ${hostname} in the browser.`
      : "HLVM wants to open this page in the browser.";
  }
  return undefined;
}

function buildPrettyArgLines(toolArgs: unknown): string[] {
  if (toolArgs == null) return [];
  if (typeof toolArgs === "string") {
    return toolArgs.split("\n");
  }
  try {
    return JSON.stringify(toolArgs, null, 2).split("\n");
  } catch {
    return [String(toolArgs)];
  }
}

export function getConfirmationDialogDisplay(
  toolName?: string,
  toolArgs?: string,
  toolInput?: unknown,
): ConfirmationDialogDisplay {
  const isPlanReview = toolName === "plan_review";
  const parsedPlanReview = parsePlanReviewToolArgs(toolName, toolArgs);
  if (parsedPlanReview) {
    const verificationLines = [
      ...new Set(
        parsedPlanReview.steps.flatMap((step) => step.successCriteria ?? []),
      ),
    ].slice(0, 4);
    return {
      isPlanReview,
      requestKind: "generic",
      planReview: {
        plan: parsedPlanReview,
        visibleSteps: parsedPlanReview.steps.slice(0, PLAN_REVIEW_MAX_STEPS),
        hiddenStepCount: Math.max(
          0,
          parsedPlanReview.steps.length - PLAN_REVIEW_MAX_STEPS,
        ),
        verificationLines,
      },
      visibleArgLines: [],
      hiddenArgLines: 0,
    };
  }
  const normalizedToolName = toolName?.trim().toLowerCase();
  const argsRecord = resolveConfirmationArgsRecord(toolInput, toolArgs);
  const warningText = extractPermissionWarning(toolArgs);

  const shellCommand = normalizeDisplayString(
    argsRecord?.command ?? argsRecord?.script ?? argsRecord?.code,
  );
  if (
    shellCommand &&
    (
      normalizedToolName?.includes("shell") ||
      normalizedToolName?.includes("bash") ||
      normalizedToolName?.includes("command")
    )
  ) {
    const shellLines = [
      normalizeDisplayString(argsRecord?.cwd)
        ? `cwd: ${normalizeDisplayString(argsRecord?.cwd)}`
        : undefined,
      typeof argsRecord?.detach === "boolean"
        ? `detach: ${argsRecord.detach ? "true" : "false"}`
        : undefined,
      normalizeDisplayString(argsRecord?.interpreter)
        ? `interpreter: ${normalizeDisplayString(argsRecord?.interpreter)}`
        : undefined,
      normalizeDisplayString(argsRecord?.language)
        ? `language: ${normalizeDisplayString(argsRecord?.language)}`
        : undefined,
    ].filter((line): line is string => Boolean(line));
    return {
      isPlanReview,
      requestKind: "shell",
      focusText: shellCommand,
      warningText,
      visibleArgLines: shellLines.slice(0, CONFIRMATION_DIALOG_MAX_ARG_LINES),
      hiddenArgLines: Math.max(
        0,
        shellLines.length - CONFIRMATION_DIALOG_MAX_ARG_LINES,
      ),
    };
  }

  const permissionUrl = normalizeDisplayString(argsRecord?.url) ??
    extractFirstUrlFromArgs(toolArgs);
  if (
    permissionUrl &&
    (
      isWebFetchPermissionTool(normalizedToolName) ||
      isBrowserPermissionTool(normalizedToolName)
    )
  ) {
    return {
      isPlanReview,
      requestKind: "url",
      focusText: permissionUrl,
      supportText: buildUrlPermissionSupportText(
        normalizedToolName,
        permissionUrl,
      ),
      warningText,
      visibleArgLines: [],
      hiddenArgLines: 0,
    };
  }

  const parsedArgs = buildPrettyArgLines(
    argsRecord ?? toolArgs,
  );
  const visibleArgLines = parsedArgs.slice(
    0,
    CONFIRMATION_DIALOG_MAX_ARG_LINES,
  );
  return {
    isPlanReview,
    requestKind: "generic",
    warningText,
    visibleArgLines,
    hiddenArgLines: Math.max(0, parsedArgs.length - visibleArgLines.length),
  };
}

function estimateConfirmationDialogRows(
  toolName: string | undefined,
  toolArgs: string | undefined,
  toolInput: unknown,
  width: number,
): number {
  const contentWidth = Math.max(18, width - 6);
  const dialog = getConfirmationDialogDisplay(toolName, toolArgs, toolInput);
  let rows = 2; // header + bottom actions

  if (toolName && dialog.requestKind === "generic") {
    rows += 1;
  }

  if (dialog.planReview) {
    rows += estimateWrappedTextRows(dialog.planReview.plan.goal, contentWidth);
    rows += 1; // Steps label
    rows += dialog.planReview.visibleSteps.reduce(
      (total: number, step) =>
        total +
        estimateWrappedTextRows(
          `[ ] ${step.title}`,
          Math.max(12, contentWidth - 2),
        ),
      0,
    );
    if (dialog.planReview.hiddenStepCount > 0) {
      rows += 1;
    }
    if (dialog.planReview.verificationLines.length > 0) {
      rows += 1;
      rows += dialog.planReview.verificationLines.reduce(
        (total: number, line: string) =>
          total +
          estimateWrappedTextRows(line, Math.max(12, contentWidth - 2)),
        0,
      );
    }
    return rows + 2; // border + spacing
  }

  if (dialog.warningText) {
    rows += estimateWrappedTextRows(dialog.warningText, contentWidth);
  }

  if (dialog.focusText) {
    rows += 1;
    rows += estimateWrappedTextRows(dialog.focusText, contentWidth);
  }

  if (dialog.supportText) {
    rows += estimateWrappedTextRows(dialog.supportText, contentWidth);
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

function estimatePickerOptionRows(
  option: QuestionDialogDisplay["options"][number],
  width: number,
): number {
  const line = `${option.label}${option.recommended ? " (Recommended)" : ""}`;
  let rows = estimateWrappedTextRows(line, width);
  if (option.detail) {
    rows += estimateWrappedTextRows(option.detail, width);
  }
  return rows;
}

function estimateQuestionDialogRows(
  question: string | undefined,
  options: InteractionRequestEvent["options"],
  width: number,
): number {
  const contentWidth = Math.max(18, width - 6);
  const display = getQuestionDialogDisplay(question, options);
  let rows = 2; // header + hint

  if (question) {
    rows += estimateWrappedTextRows(question, contentWidth);
  }

  if (display.usesPicker) {
    rows += display.options.reduce(
      (total: number, option) =>
        total + estimatePickerOptionRows(option, Math.max(12, contentWidth - 4)),
      0,
    );
    rows += estimateWrappedTextRows(QUESTION_PICKER_HINT, contentWidth);
  } else {
    rows += estimateWrappedTextRows(QUESTION_DIALOG_HINT, contentWidth);
  }
  return rows + 2; // border + spacing
}

export function estimateInteractionDialogRows(
  request: InteractionRequestEvent | undefined,
  width: number,
): number {
  if (!request) return 0;
  if (request.mode === "question") {
    return estimateQuestionDialogRows(request.question, request.options, width);
  }
  const confirmationRows = estimateConfirmationDialogRows(
    request.toolName,
    request.toolArgs,
    request.toolInput,
    width,
  );
  return confirmationRows + 6;
}
