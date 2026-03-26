import { assertEquals, assertExists } from "jsr:@std/assert@1";
import {
  getConfirmationDialogDisplay,
  getQuestionDialogDisplay,
  isPickerInteractionRequest,
  parsePlanReviewToolArgs,
} from "../../../src/hlvm/cli/repl-ink/components/conversation/interaction-dialog-layout.ts";

Deno.test("parsePlanReviewToolArgs extracts a valid plan review payload", () => {
  const plan = parsePlanReviewToolArgs(
    "plan_review",
    JSON.stringify({
      goal: "Implement plan mode shell parity",
      steps: [{
        id: "step-1",
        title: "Build checklist panel",
        successCriteria: ["Checklist remains visible while executing"],
      }],
    }),
  );

  assertExists(plan);
  assertEquals(plan.goal, "Implement plan mode shell parity");
  assertEquals(plan.steps.map((step) => step.title), ["Build checklist panel"]);
});

Deno.test("getConfirmationDialogDisplay summarizes plan review steps and verification lines", () => {
  const dialog = getConfirmationDialogDisplay(
    "plan_review",
    JSON.stringify({
      goal: "Ship a stronger plan mode",
      steps: [{
        id: "step-1",
        title: "Compact transcript noise",
        successCriteria: [
          "Thinking rows are hidden",
          "Thinking rows are hidden",
        ],
      }, {
        id: "step-2",
        title: "Keep checklist sticky",
        successCriteria: ["Checklist remains visible"],
      }],
    }),
  );

  assertEquals(dialog.isPlanReview, true);
  assertExists(dialog.planReview);
  assertEquals(dialog.planReview.visibleSteps.map((step) => step.title), [
    "Compact transcript noise",
    "Keep checklist sticky",
  ]);
  assertEquals(dialog.planReview.verificationLines, [
    "Thinking rows are hidden",
    "Checklist remains visible",
  ]);
});

Deno.test("getQuestionDialogDisplay distinguishes picker and free-text questions", () => {
  const freeText = getQuestionDialogDisplay("What changed?", undefined);
  assertEquals(freeText.usesPicker, false);
  assertEquals(freeText.options, []);

  const picker = getQuestionDialogDisplay("Choose a scope", [{
    label: "Implement now",
    recommended: true,
  }, {
    label: "Revise plan",
    value: "revise",
    detail: "Stay in plan mode",
  }]);
  assertEquals(picker.usesPicker, true);
  assertEquals(picker.options, [{
    label: "Implement now",
    value: "Implement now",
    detail: undefined,
    recommended: true,
  }, {
    label: "Revise plan",
    value: "revise",
    detail: "Stay in plan mode",
    recommended: false,
  }]);
});

Deno.test("isPickerInteractionRequest only treats plan review and option questions as picker-owned flows", () => {
  assertEquals(
    isPickerInteractionRequest({
      type: "interaction_request",
      mode: "permission",
      requestId: "req-1",
      toolName: "plan_review",
    }),
    true,
  );

  assertEquals(
    isPickerInteractionRequest({
      type: "interaction_request",
      mode: "question",
      requestId: "req-2",
      question: "Choose a scope",
      options: [{ label: "Now" }],
    }),
    true,
  );

  assertEquals(
    isPickerInteractionRequest({
      type: "interaction_request",
      mode: "question",
      requestId: "req-3",
      question: "Type details",
    }),
    false,
  );
});
