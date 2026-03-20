import { assertEquals } from "jsr:@std/assert";
import {
  __testOnlyResetTokenEstimatorState,
  estimateTokensFromText,
  observeTokenUsage,
} from "../../../src/common/token-utils.ts";

Deno.test("token utils: estimator cache stays bounded and evicts old model-specific entries", () => {
  __testOnlyResetTokenEstimatorState();

  observeTokenUsage(8, 4, "model-a");
  const calibrated = estimateTokensFromText("x".repeat(100), "model-a");
  assertEquals(calibrated, 50);

  for (let index = 0; index < 200; index++) {
    observeTokenUsage(4, 1, `model-${index}`);
  }

  const afterEviction = estimateTokensFromText("x".repeat(100), "model-a");
  assertEquals(afterEviction < calibrated, true);
  assertEquals(afterEviction <= 30, true);
});
