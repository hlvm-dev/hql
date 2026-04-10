import { assertEquals, assertStringIncludes } from "jsr:@std/assert";
import {
  DEFAULT_MODEL_ID,
  DEFAULT_MODEL_NAME,
  DEFAULT_OLLAMA_ENDPOINT,
} from "../../../src/common/config/types.ts";
import { aiCommand } from "../../../src/hlvm/cli/commands/ai.ts";
import {
  withCapturedOutput,
  withEnv,
  withRuntimeHostServer,
} from "../../shared/light-helpers.ts";

const encoder = new TextEncoder();

Deno.test("ai command: pull streams through the runtime host", async () => {
  let capturedBody: { name?: string; provider?: string } | null = null;
  let installedChecks = 0;

  await withRuntimeHostServer(async (req) => {
    const url = new URL(req.url);
    if (url.pathname === "/api/models/installed") {
      installedChecks += 1;
      return Response.json({
        models: installedChecks >= 2
          ? [{ name: "test-model:latest", metadata: { provider: "ollama" } }]
          : [],
      });
    }
    if (url.pathname === "/api/models/pull") {
      capturedBody = await req.json() as { name?: string; provider?: string };
      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue(
            encoder.encode(
              JSON.stringify({
                event: "progress",
                status: "pulling",
                percent: 55,
              }) + "\n",
            ),
          );
          controller.enqueue(
            encoder.encode(
              JSON.stringify({ event: "complete", name: "test-model:latest" }) +
                "\n",
            ),
          );
          controller.close();
        },
      });
      return new Response(stream, {
        headers: { "Content-Type": "application/x-ndjson" },
      });
    }

    return new Response("Not found", { status: 404 });
  }, async () => {
    await withCapturedOutput(async (output) => {
      await aiCommand(["pull", "ollama/test-model:latest"]);

      assertEquals(capturedBody, {
        name: "test-model:latest",
        provider: "ollama",
      });
      assertEquals(installedChecks, 2);
      assertStringIncludes(
        output(),
        "Downloading model (test-model:latest)...",
      );
      assertStringIncludes(output(), "pulling 55%");
      assertStringIncludes(output(), "Model ready: test-model:latest");
    });
  });
});

Deno.test("ai command: setup uses runtime host config and model pull flow", async () => {
  let installedChecks = 0;
  let pullRequests = 0;

  await withRuntimeHostServer(async (req) => {
    const url = new URL(req.url);
    if (url.pathname === "/api/config") {
      return Response.json({
        model: DEFAULT_MODEL_ID,
        modelConfigured: true,
        endpoint: DEFAULT_OLLAMA_ENDPOINT,
        theme: "sicp",
      });
    }

    if (url.pathname === "/api/models/installed") {
      installedChecks += 1;
      const models = installedChecks >= 2
        ? [{ name: DEFAULT_MODEL_NAME, metadata: { provider: "ollama" } }]
        : [];
      return Response.json({ models });
    }

    if (url.pathname === "/api/models/pull") {
      pullRequests += 1;
      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue(
            encoder.encode(
              JSON.stringify({
                event: "progress",
                status: "pulling",
                percent: 100,
              }) + "\n",
            ),
          );
          controller.enqueue(
            encoder.encode(
              JSON.stringify({ event: "complete", name: DEFAULT_MODEL_NAME }) +
                "\n",
            ),
          );
          controller.close();
        },
      });
      return new Response(stream, {
        headers: { "Content-Type": "application/x-ndjson" },
      });
    }

    return new Response("Not found", { status: 404 });
  }, async () => {
    await withCapturedOutput(async (output) => {
      await withEnv("HLVM_DISABLE_AI_AUTOSTART", "", async () => {
        await aiCommand(["setup"]);
      });

      assertEquals(pullRequests, 1);
      assertEquals(installedChecks, 2);
      assertStringIncludes(
        output(),
        `Downloading default model (${DEFAULT_MODEL_NAME})...`,
      );
      assertStringIncludes(
        output(),
        `Default model ready: ${DEFAULT_MODEL_NAME}`,
      );
    });
  });
});

Deno.test("ai command: current reports runtime-host-backed model status", async () => {
  await withRuntimeHostServer(async (req) => {
    const url = new URL(req.url);
    if (url.pathname === "/api/config") {
      return Response.json({
        model: DEFAULT_MODEL_ID,
        modelConfigured: true,
        endpoint: DEFAULT_OLLAMA_ENDPOINT,
        theme: "sicp",
      });
    }

    if (url.pathname === "/api/models/installed") {
      return Response.json({
        models: [{
          name: DEFAULT_MODEL_NAME,
          metadata: { provider: "ollama" },
        }],
      });
    }

    return new Response("Not found", { status: 404 });
  }, async () => {
    await withCapturedOutput(async (output) => {
      await aiCommand(["current"]);
      assertStringIncludes(
        output(),
        `Default: ${DEFAULT_MODEL_ID} (installed)`,
      );
    });
  });
});

Deno.test("ai command: list reads discovery through the runtime host", async () => {
  await withRuntimeHostServer(async (req) => {
    const url = new URL(req.url);
    if (url.pathname === "/api/config") {
      return Response.json({
        model: DEFAULT_MODEL_ID,
        modelConfigured: true,
        endpoint: DEFAULT_OLLAMA_ENDPOINT,
        theme: "sicp",
      });
    }

    if (url.pathname === "/api/models/discovery") {
      return Response.json({
        installedModels: [{
          name: DEFAULT_MODEL_NAME,
          metadata: { provider: "ollama", providerDisplayName: "Ollama" },
          capabilities: ["tools"],
          size: 1024,
        }],
        remoteModels: [{
          name: DEFAULT_MODEL_NAME,
          parameterSize: "8B",
          metadata: { provider: "ollama", providerDisplayName: "Ollama" },
        }],
        cloudModels: [],
        failed: false,
      });
    }

    return new Response("Not found", { status: 404 });
  }, async () => {
    await withCapturedOutput(async (output) => {
      await aiCommand(["list"]);
      assertStringIncludes(output(), `Default: ${DEFAULT_MODEL_ID}`);
      assertStringIncludes(output(), "Ollama:");
      assertStringIncludes(output(), `* ${DEFAULT_MODEL_NAME}`);
      assertStringIncludes(output(), "tools 8B");
    });
  });
});
