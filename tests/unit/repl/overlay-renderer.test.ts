import { assertEquals, assertStringIncludes } from "jsr:@std/assert@1";
import { buildOverlayFrameText } from "../../../src/hlvm/cli/repl-ink/overlay/renderer.ts";
import {
  BACKGROUND_TASKS_OVERLAY_SPEC,
  COMMAND_PALETTE_OVERLAY_SPEC,
  CONFIG_OVERLAY_SPEC,
  resolveOverlayChromeLayout,
  SHORTCUTS_OVERLAY_SPEC,
  TEAM_DASHBOARD_OVERLAY_SPEC,
} from "../../../src/hlvm/cli/repl-ink/overlay/layout.ts";

Deno.test("buildOverlayFrameText returns full-width borders", () => {
  const frame = buildOverlayFrameText(12);

  assertEquals(frame.top.length, 12);
  assertEquals(frame.bottom.length, 12);
  assertEquals(frame.top, "╭──────────╮");
  assertEquals(frame.bottom, "╰──────────╯");
});

Deno.test("buildOverlayFrameText can embed title and right text without changing width", () => {
  const frame = buildOverlayFrameText(24, {
    title: "Commands",
    rightText: "esc",
  });

  assertEquals(frame.top.length, 24);
  assertStringIncludes(frame.top, "Commands");
  assertStringIncludes(frame.top, "esc");
});

Deno.test("resolveOverlayChromeLayout reclaims one visible row when the title moves into the frame", () => {
  const cases = [
    {
      name: "command palette",
      height: COMMAND_PALETTE_OVERLAY_SPEC.height,
      spec: COMMAND_PALETTE_OVERLAY_SPEC,
    },
    {
      name: "config",
      height: CONFIG_OVERLAY_SPEC.height,
      spec: CONFIG_OVERLAY_SPEC,
    },
    {
      name: "background tasks",
      height: BACKGROUND_TASKS_OVERLAY_SPEC.height,
      spec: BACKGROUND_TASKS_OVERLAY_SPEC,
    },
    {
      name: "team dashboard",
      height: TEAM_DASHBOARD_OVERLAY_SPEC.height,
      spec: TEAM_DASHBOARD_OVERLAY_SPEC,
    },
    {
      name: "shortcuts",
      height: 16,
      spec: SHORTCUTS_OVERLAY_SPEC,
    },
  ] as const;

  for (const testCase of cases) {
    const current = resolveOverlayChromeLayout(testCase.height, testCase.spec);
    const previous = resolveOverlayChromeLayout(testCase.height, {
      ...testCase.spec,
      bodyHeaderRows: testCase.spec.bodyHeaderRows + 1,
    });

    assertEquals(
      current.visibleRows,
      previous.visibleRows + 1,
      testCase.name,
    );
    assertEquals(
      current.footerY,
      testCase.height - testCase.spec.padding.bottom -
        (testCase.spec.footerRows ?? 1),
      `${testCase.name} footer row`,
    );
  }
});
