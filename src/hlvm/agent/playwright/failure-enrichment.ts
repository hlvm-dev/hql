import type { ToolFailureMetadata } from "../tool-results.ts";

export interface PlaywrightFailureContext {
  interaction?: string;
  selector?: string;
}

export interface PlaywrightVisualFailureMatch {
  code:
    | "pw_element_not_visible"
    | "pw_element_outside_viewport"
    | "pw_click_intercepted";
  visualReason: "not_visible" | "outside_viewport" | "click_intercepted";
}

export const PLAYWRIGHT_VISUAL_FAILURE_CODES = new Set([
  "pw_element_not_visible",
  "pw_element_outside_viewport",
  "pw_click_intercepted",
]);

export const PLAYWRIGHT_VISUAL_LAYOUT_KEYWORDS = [
  "not visible",
  "outside the viewport",
  "intercept",
  "obscur",
  "another element would receive the click",
] as const;

export function matchPlaywrightVisualFailure(
  errorText: string,
): PlaywrightVisualFailureMatch | null {
  const lowerError = errorText.toLowerCase();

  if (
    lowerError.includes("another element would receive the click") ||
    lowerError.includes("intercepts pointer events") ||
    lowerError.includes("intercept") ||
    lowerError.includes("obscur")
  ) {
    return {
      code: "pw_click_intercepted",
      visualReason: "click_intercepted",
    };
  }

  if (
    lowerError.includes("outside the viewport") ||
    lowerError.includes("outside of the viewport")
  ) {
    return {
      code: "pw_element_outside_viewport",
      visualReason: "outside_viewport",
    };
  }

  if (
    lowerError.includes("not visible") ||
    lowerError.includes("element is hidden") ||
    lowerError.includes("element is not visible")
  ) {
    return {
      code: "pw_element_not_visible",
      visualReason: "not_visible",
    };
  }

  return null;
}

export function hasStructuredPlaywrightVisualFailure(
  failure?: ToolFailureMetadata,
): boolean {
  if (!failure) return false;
  if (failure.facts?.visualBlocker === true) return true;
  return typeof failure.code === "string" &&
    PLAYWRIGHT_VISUAL_FAILURE_CODES.has(failure.code);
}

export function enrichPlaywrightFailureMetadata(
  failure: ToolFailureMetadata,
  errorText: string,
  context: PlaywrightFailureContext = {},
): ToolFailureMetadata {
  const existingFacts = failure.facts ?? {};
  const detected = hasStructuredPlaywrightVisualFailure(failure)
    ? {
      code: typeof failure.code === "string" &&
          PLAYWRIGHT_VISUAL_FAILURE_CODES.has(failure.code)
        ? failure.code as PlaywrightVisualFailureMatch["code"]
        : undefined,
      visualReason: typeof existingFacts.visualReason === "string"
        ? existingFacts.visualReason
        : undefined,
    }
    : matchPlaywrightVisualFailure(errorText);

  if (!detected) return failure;

  const facts: Record<string, unknown> = {
    ...existingFacts,
    visualBlocker: true,
    visualReason: detected.visualReason ?? existingFacts.visualReason,
  };
  if (context.selector) facts.selector = context.selector;
  if (context.interaction) facts.interaction = context.interaction;

  return {
    ...failure,
    retryable: true,
    ...(detected.code ? { code: detected.code } : {}),
    facts,
  };
}
