import { assertEquals } from "jsr:@std/assert";
import {
  selectBootstrapModelForMemory,
  type BootstrapModelTierConfig,
} from "../../../src/hlvm/runtime/bootstrap-model-selection.ts";

const TEST_MODEL_TIERS: BootstrapModelTierConfig = {
  defaultModelId: "qwen3:8b",
  tiers: [
    { minMemoryGiB: 64, modelId: "qwen3:30b" },
    { minMemoryGiB: 0, modelId: "qwen3:8b" },
  ],
};

Deno.test("bootstrap model selection keeps 32 GiB hosts on qwen3:8b", () => {
  const selected = selectBootstrapModelForMemory(
    TEST_MODEL_TIERS,
    32 * 1024 ** 3,
  );

  assertEquals(selected.modelId, "qwen3:8b");
  assertEquals(selected.tier.minMemoryGiB, 0);
});

Deno.test("bootstrap model selection upgrades 64 GiB hosts to qwen3:30b", () => {
  const selected = selectBootstrapModelForMemory(
    TEST_MODEL_TIERS,
    64 * 1024 ** 3,
  );

  assertEquals(selected.modelId, "qwen3:30b");
  assertEquals(selected.tier.minMemoryGiB, 64);
});

Deno.test("bootstrap model selection falls back to the pinned default when memory is unknown", () => {
  const selected = selectBootstrapModelForMemory(TEST_MODEL_TIERS, null);

  assertEquals(selected.modelId, "qwen3:8b");
  assertEquals(selected.detectedMemoryBytes, null);
});
