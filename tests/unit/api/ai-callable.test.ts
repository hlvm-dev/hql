import { assertEquals, assertRejects, assertStringIncludes } from "jsr:@std/assert@1";
import { ai, __setStructuredGenerationDepsForTesting } from "../../../src/hlvm/api/ai.ts";
import { registerProvider, setDefaultProvider } from "../../../src/hlvm/providers/registry.ts";
import { setHlvmDirForTests, resetHlvmDirCacheForTests } from "../../../src/common/paths.ts";
import { getPlatform } from "../../../src/platform/platform.ts";
import type { AIProvider } from "../../../src/hlvm/providers/types.ts";

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Mock provider — controlled responses, no real LLM needed.
// Registered AFTER module init so it overrides the Ollama default.
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

let lastChatMessages: unknown[] = [];
let lastChatOptions: unknown = {};
let mockResponse = "mock response";

function createMockProvider(): AIProvider {
  return {
    name: "mock",
    displayName: "Mock",
    capabilities: [],
    async *generate() { yield mockResponse; },
    async *chat(messages, options) {
      lastChatMessages = [...messages];
      lastChatOptions = { ...options };
      yield mockResponse;
    },
    async chatStructured(messages, options) {
      lastChatMessages = [...messages];
      lastChatOptions = { ...options };
      return { content: mockResponse, toolCalls: [] };
    },
    models: {
      async list() { return [{ name: "mock-model", provider: "mock" }] as any; },
      async get(name) { return name === "mock-model" ? { name: "mock-model" } as any : null; },
    },
    async status() { return { available: true }; },
  };
}

// Register mock AFTER ai.ts import (which triggers providers/index.ts init)
registerProvider("mock", createMockProvider, { isDefault: true });
setDefaultProvider("mock");

// Isolate tests from the developer's real config by pointing HLVM_DIR to a
// temp directory with a config that routes to the mock provider.
const tmpDir = Deno.makeTempDirSync();
await getPlatform().fs.writeTextFile(
  `${tmpDir}/config.json`,
  JSON.stringify({ model: "mock/mock-model", modelConfigured: true }),
);
setHlvmDirForTests(tmpDir);

function resetMock(response = "mock response") {
  mockResponse = response;
  lastChatMessages = [];
  lastChatOptions = {};
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// ai(prompt) — basic call
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Deno.test("ai(prompt): sends user message and returns collected string", async () => {
  resetMock("Hello world");
  const result = await ai("say hello");
  assertEquals(result, "Hello world");
  assertEquals((lastChatMessages as any[]).length, 1);
  assertEquals((lastChatMessages as any[])[0].role, "user");
  assertEquals((lastChatMessages as any[])[0].content, "say hello");
});

Deno.test("ai(prompt, {system}): prepends system message", async () => {
  resetMock("ok");
  await ai("query", { system: "you are helpful" });
  assertEquals((lastChatMessages as any[]).length, 2);
  assertEquals((lastChatMessages as any[])[0].role, "system");
  assertEquals((lastChatMessages as any[])[0].content, "you are helpful");
  assertEquals((lastChatMessages as any[])[1].role, "user");
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// ai(prompt, {data}) — data injection
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Deno.test("ai(prompt, {data}): appends JSON data to user message", async () => {
  resetMock("42");
  await ai("analyze this", { data: { value: 42 } });
  const content = (lastChatMessages as any[])[0].content as string;
  assertStringIncludes(content, "analyze this");
  assertStringIncludes(content, "Data:");
  assertStringIncludes(content, '"value": 42');
});

Deno.test("ai(prompt, {data: null}): does not append Data section", async () => {
  resetMock("ok");
  await ai("just a prompt", { data: null });
  const content = (lastChatMessages as any[])[0].content as string;
  assertEquals(content, "just a prompt");
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// ai(prompt, {schema}) — structured output (via AI SDK native path)
// NOTE: Schema path now uses generateStructuredWithSdk (AI SDK native
// constrained decoding), which bypasses the mock provider entirely.
// Full schema E2E tests live in tests/e2e/ai-callable-e2e.test.ts.
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Deno.test({
  name: "ai(prompt, {schema}): schema path does NOT go through provider.chat",
  sanitizeResources: false,
  async fn() {
    resetMock("should not be called");
    // Schema path uses the SDK, which will try to resolve a real provider.
    // With the mock provider (no SDK backend), this will throw a provider error.
    // The point is: it does NOT call provider.chat() (lastChatMessages stays empty).
    try {
      await ai("classify", { schema: { sentiment: "string" }, model: "mock/test" });
    } catch {
      // Expected: mock provider is not an SDK provider
    }
    assertEquals(lastChatMessages.length, 0);
  },
});

Deno.test({
  name: "ai(prompt, {schema}): falls back to prompt-based structured extraction when native generation fails",
  sanitizeResources: false,
  async fn() {
    resetMock("should not be called");
    let sdkCalls = 0;
    let fallbackCalls = 0;
    let fallbackMessages: unknown[] = [];

    __setStructuredGenerationDepsForTesting({
      generateStructuredWithSdk: async () => {
        sdkCalls++;
        throw new Error("native structured generation failed");
      },
      generateStructuredWithPromptFallback: async (_spec, messages) => {
        fallbackCalls++;
        fallbackMessages = [...messages];
        return { sentiment: "positive", confidence: 0.99 };
      },
    });

    try {
      const result = await ai("classify this sentiment", {
        model: "ollama/llama3.1:8b",
        system: "Return JSON.",
        data: { text: "I love HLVM" },
        schema: { sentiment: "string", confidence: "number" },
      });

      assertEquals(result, { sentiment: "positive", confidence: 0.99 });
      assertEquals(sdkCalls, 1);
      assertEquals(fallbackCalls, 1);
      assertEquals(lastChatMessages.length, 0);
      assertEquals((fallbackMessages as any[]).length, 2);
      assertEquals((fallbackMessages as any[])[0].role, "system");
      assertStringIncludes((fallbackMessages as any[])[1].content, "classify this sentiment");
      assertStringIncludes((fallbackMessages as any[])[1].content, '"text": "I love HLVM"');
    } finally {
      __setStructuredGenerationDepsForTesting(null);
    }
  },
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// ai(prompt, {temperature}) — passthrough options
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Deno.test("ai(prompt, {temperature}): passes temperature via raw options", async () => {
  resetMock("warm");
  await ai("creative prompt", { temperature: 0.9 });
  assertEquals((lastChatOptions as any).raw?.temperature, 0.9);
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// ai.chat — streaming
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Deno.test("ai.chat: yields streaming chunks from provider", async () => {
  resetMock("streamed chunk");
  const chunks: string[] = [];
  for await (const c of ai.chat([{ role: "user", content: "hi" }])) {
    chunks.push(c);
  }
  assertEquals(chunks, ["streamed chunk"]);
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// ai.chatStructured — tool calling
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Deno.test("ai.chatStructured: returns structured response", async () => {
  resetMock("structured");
  const result = await ai.chatStructured([{ role: "user", content: "call tool" }]);
  assertEquals(result.content, "structured");
  assertEquals(result.toolCalls, []);
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// ai.models — model management
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Deno.test("ai.models.list: returns models from mock provider", async () => {
  const models = await ai.models.list("mock");
  assertEquals(models.length, 1);
  assertEquals(models[0].name, "mock-model");
});

Deno.test("ai.models.get: returns model info for known model", async () => {
  const model = await ai.models.get("mock-model", "mock");
  assertEquals(model?.name, "mock-model");
});

Deno.test("ai.models.get: returns null for unknown model", async () => {
  const model = await ai.models.get("no-such-model", "mock");
  assertEquals(model, null);
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// ai.status
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Deno.test("ai.status: returns available for mock provider", async () => {
  const status = await ai.status("mock");
  assertEquals(status.available, true);
});

Deno.test("ai.status: returns unavailable for non-existent provider", async () => {
  const status = await ai.status("no-such-provider-xyz");
  assertEquals(status.available, false);
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Error handling
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Deno.test("ai: throws for non-existent provider/model", async () => {
  await assertRejects(
    () => ai("hello", { model: "nonexistent-provider/no-model" }),
    Error,
  );
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// agent alias + globalThis registration
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Deno.test({
  name: "agent: is same reference as ai.agent",
  sanitizeResources: false,
  async fn() {
    const { agent } = await import("../../../src/hlvm/api/index.ts");
    assertEquals(agent, ai.agent);
  },
});

Deno.test({
  name: "registerApis: wires ai and agent on globalThis",
  sanitizeResources: false,
  async fn() {
    const { registerApis } = await import("../../../src/hlvm/api/index.ts");
    registerApis();
    const g = globalThis as Record<string, unknown>;
    assertEquals(g.ai, ai);
    assertEquals(g.agent, ai.agent);
  },
});
