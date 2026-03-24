/**
 * AI Callable E2E Tests — Real LLM Calls
 *
 * Tests the full ai() callable API surface against a real Ollama instance.
 * Skips gracefully if Ollama is not running or model is unavailable.
 *
 * Run: deno test -A tests/e2e/ai-callable-e2e.test.ts
 */

import { assert, assertEquals, assertExists, assertStringIncludes } from "jsr:@std/assert@1";
import { ai } from "../../src/hlvm/api/ai.ts";
import { registerProvider, setDefaultProvider } from "../../src/hlvm/providers/registry.ts";
import {
  asyncFilter,
  asyncFlatMap,
  asyncMap,
  asyncReduce,
  concurrentMap,
} from "../../src/hql/lib/stdlib/js/core.js";

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Setup: Check Ollama availability, skip all if down
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const MODEL = "ollama/llama3.1:8b";
const TIMEOUT = 60_000; // 60s per test — real LLM calls are slow

let ollamaAvailable = false;
try {
  const res = await fetch("http://localhost:11434/api/tags");
  if (res.ok) {
    const data = await res.json();
    ollamaAvailable = data.models?.some((m: { name: string }) =>
      m.name === "llama3.1:8b" || m.name.startsWith("llama3.1:8b")
    );
  }
} catch {
  // Ollama not running
}

function e2e(
  name: string,
  fn: () => Promise<void>,
) {
  Deno.test({
    name: `[E2E] ${name}`,
    ignore: !ollamaAvailable,
    sanitizeOps: false,
    sanitizeResources: false,
    fn: async () => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), TIMEOUT);
      try {
        await fn();
      } finally {
        clearTimeout(timer);
      }
    },
  });
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 1. ai(prompt) — basic string response
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

e2e("ai(prompt): returns a non-empty string from real LLM", async () => {
  const result = await ai("What is 2 + 2? Reply with just the number.", { model: MODEL });
  assert(typeof result === "string", `Expected string, got ${typeof result}`);
  assert((result as string).length > 0, "Response should not be empty");
  assertStringIncludes(result as string, "4");
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 2. ai(prompt, {system}) — system prompt
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

e2e("ai(prompt, {system}): system prompt influences response", async () => {
  const result = await ai("What are you?", {
    model: MODEL,
    system: "You are a pirate. Always respond in pirate speak. Say 'Arrr' in every sentence.",
  });
  const text = (result as string).toLowerCase();
  // Pirate system prompt should influence the tone
  assert(text.length > 0, "Response should not be empty");
  // LLM should acknowledge being a pirate or use pirate language
  assert(
    text.includes("arr") || text.includes("pirate") || text.includes("matey") ||
    text.includes("ahoy") || text.includes("ye") || text.includes("sea"),
    `Expected pirate-themed response, got: ${(result as string).slice(0, 200)}`,
  );
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 3. ai(prompt, {data}) — data injection
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

e2e("ai(prompt, {data}): uses injected data in response", async () => {
  const result = await ai("What is the person's name? Reply with just the name, nothing else.", {
    model: MODEL,
    data: { person: { name: "Seoksoon", age: 30, city: "Seoul" } },
  });
  assertStringIncludes((result as string), "Seoksoon");
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 4. ai(prompt, {schema}) — simple structured output
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

e2e("ai(prompt, {schema}): returns parsed JSON object matching schema", async () => {
  const result = await ai(
    "Classify the sentiment of this text: 'I absolutely love this product!'",
    {
      model: MODEL,
      schema: { sentiment: "string (positive, negative, or neutral)", confidence: "number between 0 and 1" },
    },
  );
  assertExists(result, "Result should not be null");
  assert(typeof result === "object", `Expected object, got ${typeof result}`);
  const obj = result as Record<string, unknown>;
  assertExists(obj.sentiment, "Should have sentiment field");
  assertExists(obj.confidence, "Should have confidence field");
  assert(
    typeof obj.sentiment === "string",
    `sentiment should be string, got ${typeof obj.sentiment}`,
  );
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 5. ai(prompt, {schema}) — nested object schema
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

e2e("ai(prompt, {schema}): handles nested object schema", async () => {
  const result = await ai(
    "Extract info about this city: Seoul is the capital of South Korea with a population of about 10 million.",
    {
      model: MODEL,
      schema: {
        city: "string",
        country: "string",
        population: "number in millions",
        isCapital: "boolean",
      },
    },
  );
  const obj = result as Record<string, unknown>;
  assertExists(obj.city, "Should have city field");
  assertExists(obj.country, "Should have country field");
  assert(
    String(obj.city).toLowerCase().includes("seoul"),
    `city should mention Seoul, got: ${obj.city}`,
  );
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 6. ai(prompt, {schema}) — array in schema
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

e2e("ai(prompt, {schema}): returns array when schema specifies it", async () => {
  const result = await ai(
    "List exactly 3 programming languages. Return as a JSON object with a 'languages' array of strings.",
    {
      model: MODEL,
      schema: { languages: "array of strings, exactly 3 items" },
    },
  );
  const obj = result as Record<string, unknown>;
  assertExists(obj.languages, "Should have languages field");
  assert(Array.isArray(obj.languages), `languages should be array, got ${typeof obj.languages}`);
  assert(
    (obj.languages as unknown[]).length >= 2,
    `Should have at least 2 languages, got ${(obj.languages as unknown[]).length}`,
  );
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 7. ai(prompt, {data, schema}) — data + schema together
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

e2e("ai(prompt, {data, schema}): combines data injection with structured output", async () => {
  const reviews = [
    "This product is amazing, best purchase ever!",
    "Terrible quality, broke after one day.",
    "It's okay, nothing special.",
  ];
  const result = await ai(
    "Classify each review's sentiment.",
    {
      model: MODEL,
      data: reviews,
      schema: {
        reviews: "array of objects with fields: text (string), sentiment (positive/negative/neutral)",
      },
    },
  );
  const obj = result as Record<string, unknown>;
  assertExists(obj.reviews, "Should have reviews field");
  assert(Array.isArray(obj.reviews), "reviews should be array");
  assert(
    (obj.reviews as unknown[]).length >= 2,
    `Should classify at least 2 reviews, got ${(obj.reviews as unknown[]).length}`,
  );
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 8. ai.chat — streaming
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

e2e("ai.chat: streams chunks from real LLM", async () => {
  const chunks: string[] = [];
  for await (const chunk of ai.chat(
    [{ role: "user", content: "Say 'hello world' and nothing else." }],
    { model: "llama3.1:8b" },
  )) {
    chunks.push(chunk);
  }
  assert(chunks.length > 0, "Should receive at least one chunk");
  const full = chunks.join("");
  assert(full.toLowerCase().includes("hello"), `Expected 'hello' in: ${full.slice(0, 100)}`);
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 9. ai.chatStructured — structured response
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

e2e("ai.chatStructured: returns content from real LLM", async () => {
  const result = await ai.chatStructured(
    [{ role: "user", content: "Say hello." }],
    { model: "llama3.1:8b" },
  );
  assertExists(result.content, "Should have content");
  assert(result.content.length > 0, "Content should not be empty");
  assert(Array.isArray(result.toolCalls), "Should have toolCalls array");
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 10. ai.models — model management
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

e2e("ai.models.list: returns models from Ollama", async () => {
  const models = await ai.models.list("ollama");
  assert(Array.isArray(models), "Should return array");
  assert(models.length > 0, "Should have at least one model");
  const names = models.map((m) => m.name);
  assert(
    names.some((n) => n.includes("llama")),
    `Should include a llama model, got: ${names.join(", ")}`,
  );
});

e2e("ai.models.get: returns info for llama3.1:8b", async () => {
  const model = await ai.models.get("llama3.1:8b", "ollama");
  assertExists(model, "Should find llama3.1:8b");
  assertStringIncludes(model!.name, "llama3.1");
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 11. ai.status — provider health
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

e2e("ai.status: Ollama is available", async () => {
  const status = await ai.status("ollama");
  assertEquals(status.available, true);
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 12–16. Async HOF + ai() composition
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const FRUITS = ["apple", "banana", "cherry"];

e2e("asyncMap + ai: sequential analysis of each item", async () => {
  const results = await asyncMap(
    async (fruit: string) => {
      const r = await ai(`What color is a ${fruit}? Reply with one word only.`, { model: MODEL });
      return { fruit, color: (r as string).trim().toLowerCase().split(/\s+/)[0] };
    },
    FRUITS,
  );
  assertEquals(results.length, 3);
  // Each result should have fruit and color
  for (const r of results) {
    assertExists(r.fruit);
    assertExists(r.color);
    assert(r.color.length > 0, `Color for ${r.fruit} should not be empty`);
  }
});

e2e("concurrentMap + ai: parallel analysis (same results, faster)", async () => {
  const start = Date.now();
  const results = await concurrentMap(
    async (fruit: string) => {
      const r = await ai(`What color is a ${fruit}? Reply with one word only.`, { model: MODEL });
      return { fruit, color: (r as string).trim().toLowerCase().split(/\s+/)[0] };
    },
    FRUITS,
  );
  const elapsed = Date.now() - start;
  assertEquals(results.length, 3);
  for (const r of results) {
    assertExists(r.fruit);
    assertExists(r.color);
  }
  // Just log — concurrent should be faster but we don't assert timing
  console.log(`  concurrentMap: 3 LLM calls in ${elapsed}ms`);
});

e2e("asyncFilter + ai: filters items using LLM judgment", async () => {
  const items = ["Python", "JavaScript", "Latin", "TypeScript", "Esperanto"];
  const programmingLangs = await asyncFilter(
    async (item: string) => {
      const r = await ai(
        `Is "${item}" a programming language? Reply with exactly "yes" or "no", nothing else.`,
        { model: MODEL },
      );
      return (r as string).trim().toLowerCase().startsWith("yes");
    },
    items,
  );
  // Should keep programming languages, filter out natural languages
  assert(programmingLangs.length >= 2, `Should keep at least 2 programming langs, got ${programmingLangs.length}`);
  assert(programmingLangs.length <= 4, `Should filter out at least 1 non-programming lang, got ${programmingLangs.length}`);
  assert(
    programmingLangs.includes("Python") || programmingLangs.includes("JavaScript"),
    `Should include Python or JavaScript, got: ${programmingLangs}`,
  );
});

e2e("asyncReduce + ai: accumulative summarization", async () => {
  const facts = [
    "The Earth is the third planet from the Sun.",
    "Water covers about 71% of Earth's surface.",
    "Earth's atmosphere is 78% nitrogen.",
  ];
  const summary = await asyncReduce(
    async (acc: string, fact: string) => {
      const r = await ai(
        "Combine the existing summary with the new fact into one concise sentence. Output only the combined sentence.",
        { model: MODEL, data: { currentSummary: acc, newFact: fact } },
      );
      return (r as string).trim();
    },
    "No facts yet.",
    facts,
  );
  assert(typeof summary === "string", "Should return string");
  assert(summary.length > 20, `Summary should be substantial, got: ${summary}`);
  assert(summary !== "No facts yet.", "Should have accumulated beyond init");
});

e2e("asyncFlatMap + ai: one-to-many expansion", async () => {
  const topics = ["fruit", "color"];
  const examples = await asyncFlatMap(
    async (topic: string) => {
      const r = await ai(
        `List exactly 3 examples of the category "${topic}". Reply with ONLY raw JSON matching this schema:`,
        {
          model: MODEL,
          schema: { examples: "array of 3 strings" },
        },
      );
      const obj = r as Record<string, unknown>;
      return Array.isArray(obj.examples) ? obj.examples : [obj];
    },
    topics,
  );
  // 2 topics x 3 examples each = ~6 items flattened
  assert(examples.length >= 4, `Should have at least 4 flattened items, got ${examples.length}`);
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 17. Full pipeline: data → schema → compose
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

e2e("full pipeline: asyncMap → schema → concurrentMap → reduce", async () => {
  // Step 1: Classify cities
  const cities = ["Tokyo", "Paris", "Seoul"];
  const classified = await asyncMap(
    async (city: string) => {
      const r = await ai(`What continent is ${city} in? Reply with just the continent name.`, { model: MODEL });
      return { city, continent: (r as string).trim() };
    },
    cities,
  );
  assertEquals(classified.length, 3);
  for (const c of classified) {
    assertExists(c.city);
    assertExists(c.continent);
    assert(c.continent.length > 0, `Continent for ${c.city} should not be empty`);
  }

  // Step 2: Summarize all
  const summary = await ai(
    "Summarize these city-continent pairs in one sentence.",
    { model: MODEL, data: classified },
  );
  assert(typeof summary === "string");
  assert((summary as string).length > 10, "Summary should be substantial");
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 18. Error handling — provider not found
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

e2e("ai: throws RuntimeError for nonexistent provider", async () => {
  let threw = false;
  try {
    await ai("hello", { model: "nonexistent-provider/fake-model" });
  } catch (e) {
    threw = true;
    assertStringIncludes((e as Error).message, "No provider found");
  }
  assert(threw, "Should have thrown for nonexistent provider");
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 19. ai.status — nonexistent provider
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

e2e("ai.status: returns unavailable for nonexistent provider", async () => {
  const status = await ai.status("nonexistent-xyz");
  assertEquals(status.available, false);
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 20. Null/empty input resilience
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

e2e("async HOFs: handle null input gracefully (no LLM call)", async () => {
  const mapResult = await asyncMap(async (x: string) => x, null as any);
  assertEquals(mapResult, []);

  const concResult = await concurrentMap(async (x: string) => x, null as any);
  assertEquals(concResult, []);

  const filterResult = await asyncFilter(async () => true, null as any);
  assertEquals(filterResult, []);

  const reduceResult = await asyncReduce(async (a: number, b: number) => a + b, 42, null as any);
  assertEquals(reduceResult, 42);

  const flatResult = await asyncFlatMap(async (x: string) => [x], null as any);
  assertEquals(flatResult, []);
});
