import {
  assertEquals,
  assertStringIncludes,
} from "jsr:@std/assert";
import { log } from "../../../src/hlvm/api/log.ts";
import { aiCommand } from "../../../src/hlvm/cli/commands/ai.ts";
import { withEnv, withRuntimeHostServer } from "../../shared/light-helpers.ts";

const encoder = new TextEncoder();

async function withCapturedOutput(
  fn: (output: () => string) => Promise<void>,
): Promise<void> {
  const raw = log.raw as { log: (text: string) => void };
  const originalLog = raw.log;
  let output = "";

  raw.log = (text: string) => {
    output += text + (text.endsWith("\n") ? "" : "\n");
  };

  try {
    await fn(() => output);
  } finally {
    raw.log = originalLog;
  }
}

Deno.test("ai command: pull streams through the runtime host", async () => {
  let capturedBody: { name?: string; provider?: string } | null = null;

  await withRuntimeHostServer(async (req) => {
    const url = new URL(req.url);
    if (url.pathname === "/api/models/pull") {
      capturedBody = await req.json() as { name?: string; provider?: string };
      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue(
            encoder.encode(
              JSON.stringify({ event: "progress", status: "pulling", percent: 55 }) + "\n",
            ),
          );
          controller.enqueue(
            encoder.encode(
              JSON.stringify({ event: "complete", name: "test-model:latest" }) + "\n",
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
      assertStringIncludes(output(), "Downloading model (test-model:latest)...");
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
        model: "ollama/llama3.1:8b",
        modelConfigured: true,
        endpoint: "http://localhost:11434",
        theme: "sicp",
      });
    }

    if (url.pathname === "/api/models/installed") {
      installedChecks += 1;
      const models = installedChecks >= 2
        ? [{ name: "llama3.1:8b", metadata: { provider: "ollama" } }]
        : [];
      return Response.json({ models });
    }

    if (url.pathname === "/api/models/pull") {
      pullRequests += 1;
      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue(
            encoder.encode(
              JSON.stringify({ event: "progress", status: "pulling", percent: 100 }) + "\n",
            ),
          );
          controller.enqueue(
            encoder.encode(
              JSON.stringify({ event: "complete", name: "llama3.1:8b" }) + "\n",
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
      assertStringIncludes(output(), "Downloading default model (llama3.1:8b)...");
      assertStringIncludes(output(), "Default model ready: llama3.1:8b");
    });
  });
});

Deno.test("ai command: current reports runtime-host-backed model status", async () => {
  await withRuntimeHostServer(async (req) => {
    const url = new URL(req.url);
    if (url.pathname === "/api/config") {
      return Response.json({
        model: "ollama/llama3.1:8b",
        modelConfigured: true,
        endpoint: "http://localhost:11434",
        theme: "sicp",
      });
    }

    if (url.pathname === "/api/models/installed") {
      return Response.json({
        models: [{ name: "llama3.1:8b", metadata: { provider: "ollama" } }],
      });
    }

    return new Response("Not found", { status: 404 });
  }, async () => {
    await withCapturedOutput(async (output) => {
      await aiCommand(["current"]);
      assertStringIncludes(output(), "Default: ollama/llama3.1:8b (installed)");
    });
  });
});

Deno.test("ai command: list reads discovery through the runtime host", async () => {
  await withRuntimeHostServer(async (req) => {
    const url = new URL(req.url);
    if (url.pathname === "/api/config") {
      return Response.json({
        model: "ollama/llama3.1:8b",
        modelConfigured: true,
        endpoint: "http://localhost:11434",
        theme: "sicp",
      });
    }

    if (url.pathname === "/api/models/discovery") {
      return Response.json({
        installedModels: [{
          name: "llama3.1:8b",
          metadata: { provider: "ollama", providerDisplayName: "Ollama" },
          capabilities: ["tools"],
          size: 1024,
        }],
        remoteModels: [{
          name: "llama3.1:8b",
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
      assertStringIncludes(output(), "Default: ollama/llama3.1:8b");
      assertStringIncludes(output(), "Ollama:");
      assertStringIncludes(output(), "* llama3.1:8b");
      assertStringIncludes(output(), "tools 8B");
    });
  });
});
