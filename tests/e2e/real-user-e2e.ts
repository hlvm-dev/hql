/**
 * REAL E2E Test — Simulates actual user REPL experience
 *
 * This is NOT a unit test with mocks. This calls registerApis() (the same
 * function the REPL calls on startup), then exercises ai(), ai.chat,
 * ai.models, asyncMap, concurrentMap, asyncFilter, asyncReduce, asyncFlatMap
 * against Claude Haiku 4.5 via Claude Code (Max subscription, no API key).
 *
 * Run: deno run --allow-all tests/e2e/real-user-e2e.ts
 */

import { registerApis } from "../../src/hlvm/api/index.ts";
await registerApis();

const ai = (globalThis as any).ai;
const agent = (globalThis as any).agent;

// Import async HOFs directly (same as REPL stdlib makes available)
const { asyncMap, concurrentMap, asyncFilter, asyncReduce, asyncFlatMap } =
  await import("../../src/hql/lib/stdlib/js/core.js");

const MODEL = "claude-code/claude-haiku-4-5-20251001";

let passed = 0;
let failed = 0;
const results: string[] = [];

function ok(name: string, detail?: string) {
  passed++;
  results.push(`  \u2713 ${name}${detail ? ` — ${detail}` : ""}`);
}
function fail(name: string, err: string) {
  failed++;
  results.push(`  \u2717 ${name} — ${err}`);
}

// ===== TEST 1: ai("prompt") basic =====
try {
  const r = await ai("What is 2+2? Reply with ONLY the number.", { model: MODEL });
  if (typeof r === "string" && r.includes("4"))
    ok("ai(prompt) basic", `"${r.trim().slice(0, 50)}"`);
  else
    fail("ai(prompt) basic", `expected string with "4", got: ${JSON.stringify(r).slice(0, 100)}`);
} catch (e: any) {
  fail("ai(prompt) basic", e.message);
}

// ===== TEST 2: ai(prompt, {system}) =====
try {
  const r = await ai("Say hello", {
    model: MODEL,
    system: "You are a pirate. Always say 'Arrr'.",
  });
  if (typeof r === "string" && r.length > 0)
    ok("ai(prompt, {system})", `"${r.trim().slice(0, 60)}"`);
  else fail("ai(prompt, {system})", `empty or non-string`);
} catch (e: any) {
  fail("ai(prompt, {system})", e.message);
}

// ===== TEST 3: ai(prompt, {data}) =====
try {
  const r = await ai("What is the person's name? Reply with ONLY the name.", {
    model: MODEL,
    data: { person: { name: "Seoksoon", age: 30 } },
  });
  if (typeof r === "string" && r.toLowerCase().includes("seoksoon"))
    ok("ai(prompt, {data})", `"${r.trim().slice(0, 60)}"`);
  else
    fail("ai(prompt, {data})", `expected "Seoksoon", got: ${r?.slice(0, 100)}`);
} catch (e: any) {
  fail("ai(prompt, {data})", e.message);
}

// ===== TEST 4: ai(prompt, {schema}) — structured JSON output =====
try {
  const r = await ai("Analyze sentiment of: 'I love sunny days'", {
    model: MODEL,
    schema: { sentiment: "positive|negative|neutral", confidence: "number 0-1" },
  });
  if (typeof r === "object" && r !== null && "sentiment" in r)
    ok("ai(prompt, {schema})", `${JSON.stringify(r).slice(0, 80)}`);
  else
    fail("ai(prompt, {schema})", `expected {sentiment:...}, got: ${JSON.stringify(r).slice(0, 100)}`);
} catch (e: any) {
  fail("ai(prompt, {schema})", e.message);
}

// ===== TEST 5: ai(prompt, {data, schema}) — combined =====
try {
  const reviews = [
    { text: "Amazing product!", rating: 5 },
    { text: "Terrible, broke on day one", rating: 1 },
  ];
  const r = await ai("Classify each review as positive or negative", {
    model: MODEL,
    data: { reviews },
    schema: { results: [{ text: "string", sentiment: "positive|negative" }] },
  });
  if (typeof r === "object" && r !== null && "results" in r && Array.isArray(r.results))
    ok("ai(prompt, {data, schema})", `${r.results.length} classified reviews`);
  else
    fail("ai(prompt, {data, schema})", `expected {results:[...]}, got: ${JSON.stringify(r).slice(0, 100)}`);
} catch (e: any) {
  fail("ai(prompt, {data, schema})", e.message);
}

// ===== TEST 6: ai.chat — streaming =====
try {
  const chunks: string[] = [];
  for await (const chunk of ai.chat(
    [{ role: "user", content: "Say hello in one word" }],
    { model: MODEL },
  )) {
    chunks.push(chunk);
  }
  const text = chunks.join("");
  if (chunks.length > 0 && text.length > 0)
    ok("ai.chat streaming", `${chunks.length} chunks, "${text.trim().slice(0, 40)}"`);
  else fail("ai.chat streaming", `no chunks received`);
} catch (e: any) {
  fail("ai.chat streaming", e.message);
}

// ===== TEST 7: ai.chatStructured =====
try {
  const r = await ai.chatStructured(
    [{ role: "user", content: "Say hello" }],
    { model: MODEL },
  );
  if (r && typeof r.content === "string" && r.content.length > 0)
    ok("ai.chatStructured", `"${r.content.trim().slice(0, 40)}"`);
  else
    fail("ai.chatStructured", `expected {content:...}, got: ${JSON.stringify(r).slice(0, 80)}`);
} catch (e: any) {
  fail("ai.chatStructured", e.message);
}

// ===== TEST 8: ai.models.list =====
try {
  const models = await ai.models.list("claude-code");
  if (Array.isArray(models) && models.length > 0)
    ok("ai.models.list", `${models.length} models`);
  else
    fail("ai.models.list", `expected non-empty array, got: ${JSON.stringify(models).slice(0, 60)}`);
} catch (e: any) {
  fail("ai.models.list", e.message);
}

// ===== TEST 9: ai.status =====
try {
  const s = await ai.status("claude-code");
  if (s && s.available === true) ok("ai.status", `available: true`);
  else fail("ai.status", `expected {available:true}, got: ${JSON.stringify(s)}`);
} catch (e: any) {
  fail("ai.status", e.message);
}

// ===== TEST 10: asyncMap + ai — sequential =====
try {
  const fruits = ["apple", "banana", "cherry"];
  const colors = await asyncMap(
    async (fruit: string) => {
      const r = await ai(
        `What color is a ${fruit}? Reply with ONLY the color name, one word.`,
        { model: MODEL },
      );
      return `${fruit}: ${r.trim().split("\n")[0]}`;
    },
    fruits,
  );
  if (Array.isArray(colors) && colors.length === 3)
    ok("asyncMap + ai", `${JSON.stringify(colors).slice(0, 80)}`);
  else fail("asyncMap + ai", `expected 3 results, got: ${colors?.length}`);
} catch (e: any) {
  fail("asyncMap + ai", e.message);
}

// ===== TEST 11: concurrentMap + ai — parallel =====
try {
  const items = ["dog", "cat", "fish"];
  const t0 = Date.now();
  const answers = await concurrentMap(
    async (animal: string) => {
      const r = await ai(
        `How many legs does a ${animal} have? Reply with ONLY the number.`,
        { model: MODEL },
      );
      return `${animal}: ${r.trim().split("\n")[0]}`;
    },
    items,
  );
  const elapsed = Date.now() - t0;
  if (Array.isArray(answers) && answers.length === 3)
    ok("concurrentMap + ai", `${elapsed}ms parallel, ${JSON.stringify(answers).slice(0, 80)}`);
  else fail("concurrentMap + ai", `expected 3 results`);
} catch (e: any) {
  fail("concurrentMap + ai", e.message);
}

// ===== TEST 12: asyncFilter + ai — LLM-based filtering =====
try {
  const langs = ["Python", "English", "Rust", "French"];
  const programming = await asyncFilter(
    async (lang: string) => {
      const r = await ai(
        `Is "${lang}" a programming language? Reply with ONLY "yes" or "no".`,
        { model: MODEL },
      );
      return r.trim().toLowerCase().startsWith("yes");
    },
    langs,
  );
  if (Array.isArray(programming) && programming.length >= 1)
    ok("asyncFilter + ai", `kept: ${JSON.stringify(programming)}`);
  else fail("asyncFilter + ai", `expected >= 1, got: ${programming?.length}`);
} catch (e: any) {
  fail("asyncFilter + ai", e.message);
}

// ===== TEST 13: asyncReduce + ai — accumulative summary =====
try {
  const facts = [
    "The Earth orbits the Sun",
    "Water boils at 100 degrees Celsius",
    "Light travels at 300000 km/s",
  ];
  const summary = await asyncReduce(
    async (acc: string, fact: string) => {
      const r = await ai(
        `Current summary: "${acc || "none yet"}". Add this fact: "${fact}". Write a combined 1-sentence summary.`,
        { model: MODEL },
      );
      return r.trim();
    },
    "",
    facts,
  );
  if (typeof summary === "string" && summary.length > 10)
    ok("asyncReduce + ai", `"${summary.slice(0, 80)}"`);
  else
    fail("asyncReduce + ai", `expected non-trivial string, got: ${summary?.slice(0, 60)}`);
} catch (e: any) {
  fail("asyncReduce + ai", e.message);
}

// ===== TEST 14: asyncFlatMap + ai — one-to-many expansion =====
try {
  const topics = ["fruits", "planets"];
  const expanded = await asyncFlatMap(
    async (topic: string) => {
      const r = await ai(
        `List exactly 3 ${topic}. Reply with ONLY the names, comma-separated, nothing else.`,
        { model: MODEL },
      );
      return r.trim().split(",").map((s: string) => s.trim()).filter((s: string) => s.length > 0);
    },
    topics,
  );
  if (Array.isArray(expanded) && expanded.length >= 4)
    ok("asyncFlatMap + ai", `${expanded.length} items: ${JSON.stringify(expanded).slice(0, 80)}`);
  else
    fail("asyncFlatMap + ai", `expected >=4 items, got: ${expanded?.length}`);
} catch (e: any) {
  fail("asyncFlatMap + ai", e.message);
}

// ===== TEST 15: null input resilience for all HOFs =====
try {
  const r1 = await asyncMap((_x: any) => _x, null);
  const r2 = await concurrentMap((_x: any) => _x, null);
  const r3 = await asyncFilter((_x: any) => true, null);
  const r4 = await asyncReduce((_a: any, _x: any) => _a, "init", null);
  const r5 = await asyncFlatMap((_x: any) => [_x], null);
  const allOk =
    JSON.stringify(r1) === "[]" &&
    JSON.stringify(r2) === "[]" &&
    JSON.stringify(r3) === "[]" &&
    r4 === "init" &&
    JSON.stringify(r5) === "[]";
  if (allOk) ok("null input resilience (all 5 HOFs)", "all return correct defaults");
  else fail("null input resilience", `unexpected values`);
} catch (e: any) {
  fail("null input resilience", e.message);
}

// ===== TEST 16: globalThis.agent exists and is same as ai.agent =====
try {
  if (typeof agent === "function" && agent === ai.agent)
    ok("agent === ai.agent on globalThis", "same reference");
  else fail("agent alias", `agent is ${typeof agent}, ai.agent is ${typeof ai.agent}`);
} catch (e: any) {
  fail("agent alias", e.message);
}

// ===== REPORT =====
console.log("\n" + "\u2550".repeat(60));
console.log(`  REAL E2E — User Scenarios (${MODEL})`);
console.log("\u2550".repeat(60));
for (const line of results) console.log(line);
console.log("\u2550".repeat(60));
console.log(`  ${passed} passed | ${failed} failed`);
console.log("\u2550".repeat(60) + "\n");

if (failed > 0) Deno.exit(1);
