import type {
  PlaywrightActionabilityCode,
  PlaywrightActionabilityResult,
} from "./actionability.ts";
import {
  isPlaywrightVisualActionabilityCode,
  PLAYWRIGHT_VISUAL_ACTIONABILITY_CODES,
} from "./actionability.ts";
import type {
  ToolFailureKind,
  ToolFailureMetadata,
} from "../tool-results.ts";

export const PLAYWRIGHT_VISUAL_FAILURE_CODES = PLAYWRIGHT_VISUAL_ACTIONABILITY_CODES;

export function hasStructuredPlaywrightVisualFailure(
  failure?: ToolFailureMetadata,
): boolean {
  if (!failure) return false;
  if (failure.facts?.visualBlocker === true) return true;
  return isPlaywrightVisualActionabilityCode(failure.code);
}

function actionabilityCodeToFailureKind(
  code?: PlaywrightActionabilityCode,
): ToolFailureKind | undefined {
  switch (code) {
    case "pw_element_not_found":
      return "not_found";
    case "pw_element_disabled":
      return "invalid_state";
    case "pw_element_not_visible":
    case "pw_element_outside_viewport":
    case "pw_click_intercepted":
      return "timeout";
    default:
      return undefined;
  }
}

export function enrichPlaywrightFailureMetadata(
  failure: ToolFailureMetadata,
  actionability?: PlaywrightActionabilityResult | null,
): ToolFailureMetadata {
  if (!actionability) return failure;

  return {
    ...failure,
    kind: actionabilityCodeToFailureKind(actionability.code) ?? failure.kind,
    retryable: true,
    ...(actionability.code ? { code: actionability.code } : {}),
    facts: {
      ...(failure.facts ?? {}),
      ...actionability.facts,
    },
  };
}
