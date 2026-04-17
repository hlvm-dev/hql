import { assertEquals } from "jsr:@std/assert";
import type { PullProgress } from "../../../src/hlvm/providers/types.ts";
import {
  ensureModelAvailability,
  getModelAvailability,
  resolveEffectiveModelAvailabilityTarget,
  resolveModelAvailabilityTarget,
} from "../../../src/common/model-availability.ts";

function progressStream(
  events: PullProgress[],
): AsyncIterable<PullProgress> {
  return {
    async *[Symbol.asyncIterator]() {
      for (const event of events) {
        yield event;
      }
    },
  };
}

Deno.test("model availability: resolves canonical target metadata", () => {
  assertEquals(
    resolveModelAvailabilityTarget("ollama/llama3.2:latest"),
    {
      modelId: "ollama/llama3.2:latest",
      providerName: "ollama",
      modelName: "llama3.2:latest",
      supportsLocalInstall: true,
    },
  );
  assertEquals(
    resolveModelAvailabilityTarget("openai/gpt-4o").supportsLocalInstall,
    false,
  );
  assertEquals(
    resolveModelAvailabilityTarget("ollama/deepseek-v3.1:671b-cloud")
      .supportsLocalInstall,
    false,
  );
});

Deno.test("model availability: external providers and Ollama cloud models are treated as available while local misses are not", async () => {
  const external = await getModelAvailability("openai/gpt-4o", {
    listModels: async () => [],
  });
  assertEquals(external.available, true);
  assertEquals(external.requiresLocalInstall, false);

  const missingLocal = await getModelAvailability("ollama/llama3.2:latest", {
    listModels: async () => [],
  });
  assertEquals(missingLocal.available, false);
  assertEquals(missingLocal.requiresLocalInstall, true);

  const cloud = await getModelAvailability("ollama/deepseek-v3.1:671b-cloud", {
    listModels: async () => [],
  });
  assertEquals(cloud.available, true);
  assertEquals(cloud.requiresLocalInstall, false);
});

Deno.test("model availability: auto resolves to an installed legacy local fallback", async () => {
  const listModels = async () => [{ name: "gemma4:e4b" }];

  const target = await resolveEffectiveModelAvailabilityTarget("auto", {
    listModels,
  });
  assertEquals(target.modelId, "ollama/gemma4:e4b");

  const availability = await getModelAvailability("auto", {
    listModels,
  });
  assertEquals(availability.modelId, "ollama/gemma4:e4b");
  assertEquals(availability.modelName, "gemma4:e4b");
  assertEquals(availability.available, true);
  assertEquals(availability.requiresLocalInstall, false);
});

Deno.test("model availability: ensure pulls a missing local model once", async () => {
  let installed = false;
  const messages: string[] = [];

  const result = await ensureModelAvailability(
    "ollama/llama3.2:latest",
    {
      listModels: async () => installed ? [{ name: "llama3.2:latest" }] : [],
      pullModel: () =>
        progressStream([{
          status: "pulling",
          percent: 100,
        }]),
    },
    {
      pull: true,
      log: (message) => {
        messages.push(message);
        installed = true;
      },
    },
  );

  assertEquals(result.ok, true);
  assertEquals(result.status, "pulled");
  assertEquals(messages.length > 0, true);
});

Deno.test("model availability: external Ollama cloud models can still require access verification", async () => {
  let accessChecks = 0;
  const result = await ensureModelAvailability(
    "ollama/deepseek-v3.1:671b-cloud",
    {
      listModels: async () => [],
      pullModel: () =>
        progressStream([{
          status: "unused",
          percent: 100,
        }]),
      ensureAccess: async () => {
        accessChecks += 1;
        return { ok: true, status: "ready" };
      },
    },
    { pull: true },
  );

  assertEquals(result.ok, true);
  assertEquals(result.status, "external");
  assertEquals(accessChecks, 1);
});
