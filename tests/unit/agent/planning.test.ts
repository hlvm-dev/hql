/**
 * Planning Tests
 */

import { assertEquals, assertStringIncludes } from "jsr:@std/assert";
import {
  derivePlanExecutionAllowlist,
  extractStepDoneId,
  formatPlanForContext,
  getPlanResearchIterationBudget,
  parsePlanResponse,
  type Plan,
  restorePlanState,
  shouldPlanRequest,
  stripStepMarkers,
} from "../../../src/hlvm/agent/planning.ts";

Deno.test({
  name: "Planning: parse PLAN envelope",
  fn() {
    const response = `PLAN
{"goal":"Test goal","steps":[{"id":"step-1","title":"Search","tools":["search_code"]}]}
END_PLAN`;
    const parsed = parsePlanResponse(response);
    assertEquals(parsed.plan?.goal, "Test goal");
    assertEquals(parsed.plan?.steps.length, 1);
    assertEquals(parsed.plan?.steps[0].id, "step-1");
  },
});

Deno.test({
  name: "Planning: parse markdown PLAN envelope fallback",
  fn() {
    const response = `PLAN
Goal: Add a visible checklist header to ConversationPanel
Steps:
1. Inspect ConversationPanel and todo-state usage
2. Update the header rendering to show the checklist
3. Verify the conversation panel tests
END_PLAN`;
    const parsed = parsePlanResponse(response);
    assertEquals(
      parsed.plan?.goal,
      "Add a visible checklist header to ConversationPanel",
    );
    assertEquals(parsed.plan?.steps.map((step) => step.title), [
      "Inspect ConversationPanel and todo-state usage",
      "Update the header rendering to show the checklist",
      "Verify the conversation panel tests",
    ]);
  },
});

Deno.test({
  name: "Planning: parsePlanResponse prefers strict JSON when present",
  fn() {
    const response = `PLAN
{"goal":"Use the JSON plan","steps":[{"id":"step-1","title":"Read the file"}]}
END_PLAN`;
    const parsed = parsePlanResponse(response);
    assertEquals(parsed.plan?.goal, "Use the JSON plan");
    assertEquals(parsed.plan?.steps[0]?.id, "step-1");
  },
});

Deno.test({
  name: "Planning: normalize loose JSON plan schema from live plan-mode output",
  fn() {
    const response = `I found the target section.
PLAN
\`\`\`json
{
  "title": "Add code comment near plan checklist rendering",
  "steps": [
    {
      "description": "Insert a JSX comment above the checklist block",
      "tool": "edit_file",
      "file": "src/hlvm/cli/repl-ink/components/ConversationPanel.tsx",
      "action": "Add a one-line comment"
    },
    {
      "description": "Verify the file still reads cleanly",
      "tool": "read_file"
    }
  ]
}
\`\`\`
END_PLAN`;
    const parsed = parsePlanResponse(response);
    assertEquals(
      parsed.plan?.goal,
      "Add code comment near plan checklist rendering",
    );
    assertEquals(parsed.plan?.steps.map((step) => step.title), [
      "Insert a JSX comment above the checklist block",
      "Verify the file still reads cleanly",
    ]);
    assertEquals(parsed.plan?.steps.map((step) => step.tools), [
      ["edit_file"],
      ["read_file"],
    ]);
  },
});

Deno.test({
  name: "Planning: normalize description/detail/action schema from live plan-mode output",
  fn() {
    const response = `PLAN
{
  "description": "Add a short code comment near the plan checklist rendering in ConversationPanel.tsx",
  "steps": [
    {
      "action": "read_file",
      "detail": "Locate the checklist JSX block"
    },
    {
      "action": "edit_file",
      "detail": "Insert a concise JSX comment above the checklist block"
    },
    {
      "action": "verify",
      "detail": "Re-read the edited region to verify placement"
    }
  ]
}
END_PLAN`;
    const parsed = parsePlanResponse(response);
    assertEquals(
      parsed.plan?.goal,
      "Add a short code comment near the plan checklist rendering in ConversationPanel.tsx",
    );
    assertEquals(parsed.plan?.steps.map((step) => step.title), [
      "Locate the checklist JSX block",
      "Insert a concise JSX comment above the checklist block",
      "Re-read the edited region to verify placement",
    ]);
    assertEquals(parsed.plan?.steps.map((step) => step.tools), [
      ["read_file"],
      ["edit_file"],
      undefined,
    ]);
  },
});

Deno.test({
  name: "Planning: duplicate step ids are made unique",
  fn() {
    const response = `PLAN
{"goal":"Ship it","steps":[{"id":"step-4","title":"Inspect"},{"id":"step-4","title":"Edit"}]}
END_PLAN`;
    const parsed = parsePlanResponse(response);
    assertEquals(parsed.plan?.steps.map((step) => step.id), [
      "step-4",
      "step-4-2",
    ]);
  },
});

Deno.test({
  name: "Planning: strip STEP_DONE marker",
  fn() {
    const response = "Done.\nSTEP_DONE step-2";
    assertEquals(stripStepMarkers(response), "Done.");
    assertEquals(extractStepDoneId(response), "step-2");
  },
});

Deno.test({
  name: "Planning: formatPlanForContext includes steps",
  fn() {
    const plan: Plan = {
      goal: "Summarize file",
      steps: [
        { id: "step-1", title: "Search", tools: ["search_code"] },
        { id: "step-2", title: "Read", tools: ["read_file"] },
      ],
    };
    const formatted = formatPlanForContext(plan, { requireStepMarkers: true });
    assertStringIncludes(formatted, "Plan:");
    assertStringIncludes(formatted, "step-1");
    assertStringIncludes(formatted, "STEP_DONE");
  },
});

Deno.test({
  name: "Planning: derivePlanExecutionAllowlist keeps execution focused on approved step tools",
  fn() {
    const plan: Plan = {
      goal: "Add a small UI fix",
      steps: [
        {
          id: "step-1",
          title: "Inspect the component",
          tools: ["search_code", "read_file"],
        },
        {
          id: "step-2",
          title: "Patch the file",
          tools: ["edit_file"],
        },
      ],
    };

    assertEquals(
      derivePlanExecutionAllowlist(plan),
      [
        "ask_user",
        "complete_task",
        "edit_file",
        "list_files",
        "read_file",
        "search_code",
        "todo_read",
        "todo_write",
        "undo_edit",
        "write_file",
      ],
    );
  },
});

Deno.test({
  name: "Planning: derivePlanExecutionAllowlist intersects with an existing execution allowlist",
  fn() {
    const plan: Plan = {
      goal: "Run a targeted test",
      steps: [{
        id: "step-1",
        title: "Run the test command",
        tools: ["shell_exec"],
      }],
    };

    assertEquals(
      derivePlanExecutionAllowlist(plan, [
        "read_file",
        "shell_exec",
        "todo_write",
      ]),
      ["read_file", "todo_write", "shell_exec"],
    );
  },
});

Deno.test({
  name: "Planning: shouldPlanRequest auto heuristic",
  fn() {
    assertEquals(shouldPlanRequest("First do A, then B", "auto"), true);
    assertEquals(shouldPlanRequest("short task", "auto"), false);
    assertEquals(shouldPlanRequest("short task", "always"), true);
  },
});

Deno.test({
  name: "Planning: getPlanResearchIterationBudget drafts quickly for plan mode",
  fn() {
    assertEquals(getPlanResearchIterationBudget(20), 3);
    assertEquals(getPlanResearchIterationBudget(4), 3);
    assertEquals(getPlanResearchIterationBudget(2), 1);
  },
});

Deno.test({
  name: "Planning: restorePlanState resumes at the first incomplete step",
  fn() {
    const plan: Plan = {
      goal: "Ship fix",
      steps: [
        { id: "step-1", title: "Inspect" },
        { id: "step-2", title: "Edit" },
        { id: "step-3", title: "Verify" },
      ],
    };

    const restored = restorePlanState(plan, ["step-1", "step-2"]);

    assertEquals(restored.currentIndex, 2);
    assertEquals(restored.completedIds.has("step-1"), true);
    assertEquals(restored.completedIds.has("step-2"), true);
    assertEquals(restored.plan.steps[restored.currentIndex]?.id, "step-3");
  },
});
