import { assert, assertEquals, assertExists } from "jsr:@std/assert";
import {
  appendToBindings,
  compactBindings,
  removeBinding,
  getBindingsFilePath,
  getBindingNames,
  getBindingStats,
  loadBindings,
  serializeValue,
} from "../../../src/hlvm/cli/repl/bindings.ts";
import { evaluate } from "../../../src/hlvm/cli/repl/evaluator.ts";
import { ReplState } from "../../../src/hlvm/cli/repl/state.ts";
import { initializeRuntime } from "../../../src/common/runtime-initializer.ts";
import { getPlatform } from "../../../src/platform/platform.ts";

const fs = () => getPlatform().fs;
const path = () => getPlatform().path;
const getMemoryDir = () => path().dirname(getBindingsFilePath());

await initializeRuntime({ ai: false });

async function cleanMemory(): Promise<void> {
  const filePath = getBindingsFilePath();
  if (await fs().exists(filePath)) {
    await fs().remove(filePath);
  }
}

async function createMemoryFile(content: string): Promise<void> {
  await fs().mkdir(getMemoryDir(), { recursive: true });
  await fs().writeTextFile(getBindingsFilePath(), content);
}

async function readMemoryFileIfExists(): Promise<string | null> {
  if (!await fs().exists(getBindingsFilePath())) {
    return null;
  }
  return await fs().readTextFile(getBindingsFilePath());
}

async function evaluateWithState(code: string, state: ReplState): Promise<void> {
  const result = await evaluate(code, state);
  assert(result.success, result.error?.message ?? `evaluation failed: ${code}`);
}

async function loadInto(state: ReplState) {
  state.setLoadingBindings(true);
  try {
    return await loadBindings(async (code: string) => {
      const result = await evaluate(code, state);
      return { success: result.success, error: result.error };
    });
  } finally {
    state.setLoadingBindings(false);
  }
}

Deno.test("memory: serializeValue covers primitives, nesting, and rejects unsupported values", () => {
  const circular: Record<string, unknown> = { ok: true };
  circular["self"] = circular;

  assertEquals(serializeValue(42), "42");
  assertEquals(serializeValue("hello\nworld"), '"hello\\nworld"');
  assertEquals(serializeValue([1, { nested: [2, 3] }]), '[1 {"nested": [2 3]}]');
  assertEquals(serializeValue(undefined), null);
  assertEquals(serializeValue(() => {}), null);
  assertEquals(serializeValue(circular), null);
});

Deno.test("memory: appendToBindings persists defs, defns, and skips unserializable values", async () => {
  await cleanMemory();

  await appendToBindings("x", "def", 1);
  await appendToBindings("x", "def", 2);
  await appendToBindings("double", "defn", "(defn double [n] (* n 2))");
  await appendToBindings("bad", "def", () => {});

  const content = await fs().readTextFile(getBindingsFilePath());
  assertEquals((content.match(/\(def x/g) ?? []).length, 1);
  assert(content.includes("(def x 2)"));
  assert(content.includes("(defn double [n] (* n 2))"));
  assert(!content.includes("bad"));
});

Deno.test("memory: append fallback preserves malformed existing content", async () => {
  await cleanMemory();

  await createMemoryFile(`// HLVM Memory - auto-persisted definitions
// Edit freely - compacted on REPL startup

/**
 * Missing end
(defn existingFn [] 1)
`);

  await appendToBindings("newFn", "defn", "(defn newFn [] 2)");

  const content = await fs().readTextFile(getBindingsFilePath());
  assert(content.includes("(defn existingFn [] 1)"));
  assert(content.includes("(defn newFn [] 2)"));
});

Deno.test("memory: compact, forget, names, and stats share one canonical file view", async () => {
  await cleanMemory();

  await createMemoryFile(`; HLVM Memory
(def x 1)
(def keep 2)
(def x 3)
(defn square [n] (* n n))
`);

  const compacted = await compactBindings();
  assertEquals(compacted, { before: 4, after: 3 });

  const removed = await removeBinding("keep");
  assertEquals(removed, true);
  assertEquals(await removeBinding("missing"), false);

  const names = await getBindingNames();
  assertEquals(names, ["x", "square"]);

  const stats = await getBindingStats();
  assertExists(stats);
  assertEquals(stats.path, getBindingsFilePath());
  assertEquals(stats.count, 2);
  assert(stats.size > 0);
});

Deno.test("memory: loadBindings skips malformed forms and reports evaluator failures", async () => {
  await cleanMemory();

  await createMemoryFile(`; HLVM Memory
(def good 42)
(def broken
(defn ok [x] (* x 2))
(def fail 0)
`);

  const loaded: string[] = [];
  const result = await loadBindings(async (code: string) => {
    loaded.push(code);
    if (code.includes("(def fail 0)")) {
      return { success: false, error: new Error("boom") };
    }
    return { success: true };
  });

  assertEquals(loaded, ["(def good 42)", "(defn ok [x] (* x 2))", "(def fail 0)"]);
  assertEquals(result.count, 2);
  assertEquals(result.errors, ["fail: boom"]);
});

Deno.test("memory: REPL persistence stores def values and defn source only", async () => {
  await cleanMemory();

  const state = new ReplState();
  await evaluateWithState("(def persistedValue (+ 10 32))", state);
  await evaluateWithState("(defn persistedFn [n] (* n 2))", state);
  await evaluateWithState("(let localOnly 1)", state);
  await evaluateWithState("(const localConst 2)", state);
  await evaluateWithState("(fn localFn [x] x)", state);

  const content = await fs().readTextFile(getBindingsFilePath());
  assert(content.includes("(def persistedValue 42)"));
  assert(content.includes("(defn persistedFn [n] (* n 2))"));
  assert(!content.includes("(+ 10 32)"));
  assert(!content.includes("localOnly"));
  assert(!content.includes("localConst"));
  assert(!content.includes("localFn"));
});

Deno.test("memory: round-trip reload keeps persisted definitions usable and non-duplicated", async () => {
  await cleanMemory();

  const initialState = new ReplState();
  await evaluateWithState('(def greeting "こんにちは")', initialState);
  await evaluateWithState('(def nestedData {"a": [1 2 {"b": 3}]})', initialState);
  await evaluateWithState('(defn triple [n] (* n 3))', initialState);

  const before = await fs().stat(getBindingsFilePath());

  const reloadedState = new ReplState();
  const result = await loadInto(reloadedState);
  assertEquals(result.count, 3);
  assertEquals(result.errors, []);

  const greeting = await evaluate("greeting", reloadedState);
  const nested = await evaluate("nestedData", reloadedState);
  const triple = await evaluate("(triple 5)", reloadedState);
  assertEquals(greeting.value, "こんにちは");
  assertEquals(nested.value, { a: [1, 2, { b: 3 }] });
  assertEquals(triple.value, 15);

  const after = await fs().stat(getBindingsFilePath());
  assertEquals(after.size, before.size);
});

Deno.test("memory: stats return empty shape when memory file is absent", async () => {
  await cleanMemory();

  const stats = await getBindingStats();
  assertExists(stats);
  assertEquals(stats, {
    path: getBindingsFilePath(),
    count: 0,
    size: 0,
  });
  assertEquals(await readMemoryFileIfExists(), null);
});
