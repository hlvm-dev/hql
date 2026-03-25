import { assertEquals } from "jsr:@std/assert@1";
import {
  computeSegmentedProgressCells,
} from "../../../src/hlvm/cli/repl-ink/components/conversation/ProgressBar.tsx";
import type { ProgressBarSegments } from "../../../src/hlvm/cli/repl-ink/components/conversation/ProgressBar.tsx";

Deno.test("computeSegmentedProgressCells preserves exact widths for clean ratios", () => {
  const segments: ProgressBarSegments = {
    success: 2,
    error: 1,
    running: 1,
    pending: 2,
  };

  assertEquals(
    computeSegmentedProgressCells(segments, 6, 12),
    {
      success: 4,
      error: 2,
      running: 2,
      pending: 4,
    },
  );
});

Deno.test("computeSegmentedProgressCells always fills the requested width", () => {
  const segments: ProgressBarSegments = {
    success: 3,
    error: 2,
    running: 1,
    pending: 1,
  };
  const cells = computeSegmentedProgressCells(segments, 7, 18);

  assertEquals(
    cells.success + cells.error + cells.running + cells.pending,
    18,
  );
});
