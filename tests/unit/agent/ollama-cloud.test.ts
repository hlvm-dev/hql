/**
 * Tests for Ollama Cloud SSOT detector.
 */

import { assertEquals } from "jsr:@std/assert";
import { isOllamaCloudModel } from "../../../src/hlvm/providers/ollama/cloud.ts";

Deno.test("isOllamaCloudModel", async (t) => {
  await t.step("detects :size-cloud pattern", () => {
    assertEquals(isOllamaCloudModel("deepseek-v3.1:671b-cloud"), true);
    assertEquals(isOllamaCloudModel("gemma3:27b-cloud"), true);
    assertEquals(isOllamaCloudModel("gpt-oss:120b-cloud"), true);
    assertEquals(isOllamaCloudModel("llama3.1:405b-cloud"), true);
  });

  await t.step("detects :cloud tag (no size prefix)", () => {
    assertEquals(isOllamaCloudModel("glm-4.6:cloud"), true);
  });

  await t.step("returns false for non-cloud models", () => {
    assertEquals(isOllamaCloudModel("llama3.2:7b"), false);
    assertEquals(isOllamaCloudModel("gemma3:2b"), false);
    assertEquals(isOllamaCloudModel("deepseek-v3.1:671b"), false);
  });

  await t.step("returns false for models without tag", () => {
    assertEquals(isOllamaCloudModel("llama3.2"), false);
    assertEquals(isOllamaCloudModel("qwen2"), false);
  });

  await t.step("returns false for empty string", () => {
    assertEquals(isOllamaCloudModel(""), false);
  });

  await t.step("does not false-positive on 'cloud' in base name", () => {
    // A hypothetical model named "cloudbert" should not match
    assertEquals(isOllamaCloudModel("cloudbert"), false);
    assertEquals(isOllamaCloudModel("cloudbert:7b"), false);
  });
});
