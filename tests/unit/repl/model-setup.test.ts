/**
 * Model setup detection tests
 *
 * Verifies configured model selection and empty-model handling.
 */

import { assertEquals } from "jsr:@std/assert@1";
import {
  checkDefaultModelInstalled,
  getDefaultModelName,
} from "../../../src/hlvm/cli/repl-ink/components/ModelSetupOverlay.tsx";
import {
  DEFAULT_CONFIG,
  type HlvmConfig,
} from "../../../src/common/config/types.ts";
import { config } from "../../../src/hlvm/api/config.ts";
import { getPlatform } from "../../../src/platform/platform.ts";
import type { ModelInfo } from "../../../src/hlvm/providers/types.ts";

const globalAny = globalThis as Record<string, unknown>;

async function withConfigSnapshot<T>(
  model: string,
  fn: () => Promise<T> | T
): Promise<T> {
  const descriptor = Object.getOwnPropertyDescriptor(config, "snapshot");
  const snapshot: HlvmConfig = { ...DEFAULT_CONFIG, model };

  Object.defineProperty(config, "snapshot", {
    configurable: true,
    get: () => snapshot,
  });

  try {
    return await fn();
  } finally {
    if (descriptor) {
      Object.defineProperty(config, "snapshot", descriptor);
    }
  }
}

async function withAiModels<T>(
  models: ModelInfo[],
  fn: () => Promise<T> | T
): Promise<T> {
  const previousAi = globalAny.ai;
  globalAny.ai = {
    models: {
      list: (_provider?: string) => Promise.resolve(models),
    },
  };

  try {
    return await fn();
  } finally {
    if (previousAi === undefined) {
      delete globalAny.ai;
    } else {
      globalAny.ai = previousAi;
    }
  }
}

async function withAutostartEnabled<T>(
  fn: () => Promise<T> | T
): Promise<T> {
  const platform = getPlatform();
  const originalGet = platform.env.get.bind(platform.env);

  platform.env.get = (key: string): string | undefined => {
    if (key === "HLVM_DISABLE_AI_AUTOSTART") return undefined;
    return originalGet(key);
  };

  try {
    return await fn();
  } finally {
    platform.env.get = originalGet;
  }
}

async function runCheck(model: string, models: ModelInfo[]): Promise<boolean> {
  return await withAutostartEnabled(() =>
    withConfigSnapshot(model, () =>
      withAiModels(models, () => checkDefaultModelInstalled())
    )
  );
}

Deno.test("Model setup detection uses configured model", async (t) => {
  await t.step("returns false when no models are installed", async () => {
    const installed = await runCheck("ollama/llama3.2:latest", []);
    assertEquals(installed, false);
  });

  await t.step("returns true when configured model is installed (case-insensitive)", async () => {
    const installed = await runCheck("ollama/llama3.2:latest", [
      { name: "LLAMA3.2:latest" },
    ]);
    assertEquals(installed, true);
  });

  await t.step("returns false when installed models do not match configured model", async () => {
    const installed = await runCheck("ollama/llama3.2:latest", [
      { name: "mistral:latest" },
    ]);
    assertEquals(installed, false);
  });

  await t.step("skips setup for non-ollama providers", async () => {
    const installed = await runCheck("openai/gpt-4", []);
    assertEquals(installed, true);
  });

  await t.step("getDefaultModelName returns the configured model name", async () => {
    const name = await withConfigSnapshot("openai/gpt-4", () => getDefaultModelName());
    assertEquals(name, "gpt-4");
  });

  await t.step("getDefaultModelName preserves tags for ollama models", async () => {
    const name = await withConfigSnapshot("ollama/llama3.2:latest", () => getDefaultModelName());
    assertEquals(name, "llama3.2:latest");
  });
});
