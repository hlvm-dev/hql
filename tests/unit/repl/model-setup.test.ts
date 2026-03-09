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
import { getPlatform } from "../../../src/platform/platform.ts";
import type { ModelInfo } from "../../../src/hlvm/providers/types.ts";
import { withRuntimeHostServer } from "../../shared/light-helpers.ts";

async function withRuntimeConfig<T>(
  model: string,
  models: ModelInfo[],
  fn: () => Promise<T> | T,
  options: {
    providerAvailable?: boolean;
    providerError?: string;
  } = {},
): Promise<T> {
  const snapshot: HlvmConfig = { ...DEFAULT_CONFIG, model };
  const providerAvailable = options.providerAvailable ?? true;
  const providerError = options.providerError;
  let result!: T;
  await withRuntimeHostServer(async (req) => {
    const url = new URL(req.url);
    if (url.pathname === "/api/config") {
      return Response.json(snapshot);
    }
    if (url.pathname === "/api/models/status") {
      return Response.json({
        providers: {
          ollama: {
            available: providerAvailable,
            ...(providerError ? { error: providerError } : {}),
          },
        },
      });
    }
    if (url.pathname === "/api/models/installed") {
      return Response.json({ models });
    }
    return new Response("Not found", { status: 404 });
  }, async () => {
    result = await fn();
  });
  return result;
}

async function withAutostartEnabled<T>(
  fn: () => Promise<T> | T,
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
    withRuntimeConfig(model, models, () => checkDefaultModelInstalled())
  );
}

Deno.test("Model setup detection uses configured model", async (t) => {
  await t.step("returns false when no models are installed", async () => {
    const installed = await runCheck("ollama/llama3.2:latest", []);
    assertEquals(installed, false);
  });

  await t.step(
    "returns true when configured model is installed (case-insensitive)",
    async () => {
      const installed = await runCheck("ollama/llama3.2:latest", [
        { name: "LLAMA3.2:latest" },
      ]);
      assertEquals(installed, true);
    },
  );

  await t.step(
    "returns false when installed models do not match configured model",
    async () => {
      const installed = await runCheck("ollama/llama3.2:latest", [
        { name: "mistral:latest" },
      ]);
      assertEquals(installed, false);
    },
  );

  await t.step(
    "suppresses setup when the provider endpoint is unavailable",
    async () => {
      const installed = await withAutostartEnabled(() =>
        withRuntimeConfig(
          "ollama/llama3.2:latest",
          [],
          () => checkDefaultModelInstalled(),
          {
            providerAvailable: false,
            providerError: "connect ECONNREFUSED 127.0.0.1:11436",
          },
        )
      );
      assertEquals(installed, true);
    },
  );

  await t.step("skips setup for non-ollama providers", async () => {
    const installed = await runCheck("openai/gpt-4", []);
    assertEquals(installed, true);
  });

  await t.step(
    "getDefaultModelName returns the configured model name",
    async () => {
      const name = await withRuntimeConfig(
        "openai/gpt-4",
        [],
        () => getDefaultModelName(),
      );
      assertEquals(name, "gpt-4");
    },
  );

  await t.step(
    "getDefaultModelName preserves tags for ollama models",
    async () => {
      const name = await withRuntimeConfig(
        "ollama/llama3.2:latest",
        [],
        () => getDefaultModelName(),
      );
      assertEquals(name, "llama3.2:latest");
    },
  );
});
