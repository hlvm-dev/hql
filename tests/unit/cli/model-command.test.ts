import {
  assertEquals,
  assertRejects,
  assertStringIncludes,
} from "jsr:@std/assert";
import { modelCommand } from "../../../src/hlvm/cli/commands/model.ts";
import {
  withCapturedOutput,
  withEnv,
  withRuntimeHostServer,
} from "../../shared/light-helpers.ts";
import { ValidationError } from "../../../src/common/error.ts";
import { buildCatalogIndex, findCatalogEntry, pad } from "../../../src/hlvm/cli/commands/model.ts";

// ── Shared helper unit tests ────────────────────────────────────────

Deno.test("buildCatalogIndex indexes models by lowercase name", () => {
  const index = buildCatalogIndex([
    { name: "Llama3:latest" } as Parameters<typeof buildCatalogIndex>[0][0],
    { name: "Phi3" } as Parameters<typeof buildCatalogIndex>[0][0],
  ]);
  assertEquals(index.size, 2);
  assertEquals(index.get("llama3:latest")?.name, "Llama3:latest");
  assertEquals(index.get("phi3")?.name, "Phi3");
});

Deno.test("findCatalogEntry matches exact, :latest, and prefix", () => {
  const index = buildCatalogIndex([
    { name: "llama3:latest" } as Parameters<typeof buildCatalogIndex>[0][0],
    { name: "phi3:medium" } as Parameters<typeof buildCatalogIndex>[0][0],
  ]);
  assertEquals(findCatalogEntry(index, "llama3:latest")?.name, "llama3:latest");
  assertEquals(findCatalogEntry(index, "llama3")?.name, "llama3:latest");
  assertEquals(findCatalogEntry(index, "phi3")?.name, "phi3:medium");
  assertEquals(findCatalogEntry(index, "nonexistent"), null);
});

Deno.test("pad truncates long text and pads short text", () => {
  assertEquals(pad("hello", 10), "hello     ");
  assertEquals(pad("hello", 5), "hello");
  // Truncation: text longer than width gets ellipsis
  const result = pad("a-very-long-model-name", 10);
  assertEquals(result.length, 10);
});

// ── Command dispatch tests ──────────────────────────────────────────

Deno.test("model command: (no args) shows current default", async () => {
  await withRuntimeHostServer(async (req) => {
    const url = new URL(req.url);
    if (url.pathname === "/api/config") {
      return Response.json({ model: "ollama/llama3.1:8b", modelConfigured: true });
    }
    if (url.pathname === "/api/models/installed") {
      return Response.json({
        models: [{ name: "llama3.1:8b", metadata: { provider: "ollama" } }],
      });
    }
    return new Response("Not found", { status: 404 });
  }, async () => {
    await withCapturedOutput(async (output) => {
      await modelCommand([]);
      assertStringIncludes(output(), "ollama/llama3.1:8b");
      assertStringIncludes(output(), "available");
    });
  });
});

Deno.test("model command: set requires a model name", async () => {
  await assertRejects(
    () => modelCommand(["set"]),
    ValidationError,
    "Missing model name",
  );
});

Deno.test("model command: rm requires a model name", async () => {
  await assertRejects(
    () => modelCommand(["rm"]),
    ValidationError,
    "Missing model name",
  );
});

Deno.test("model command: show requires a model name", async () => {
  await assertRejects(
    () => modelCommand(["show"]),
    ValidationError,
    "Missing model name",
  );
});

Deno.test("model command: unknown subcommand throws", async () => {
  await assertRejects(
    () => modelCommand(["foobar"]),
    ValidationError,
    "Unknown model command",
  );
});

Deno.test("model command: --help shows help text", async () => {
  await withCapturedOutput(async (output) => {
    await modelCommand(["--help"]);
    assertStringIncludes(output(), "HLVM Model");
    assertStringIncludes(output(), "hlvm model set");
  });
});
