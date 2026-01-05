/**
 * Unit tests for HQL REPL Memory Persistence
 * Tests: def/defn persistence, loading, compaction, serialization
 */

import { assertEquals, assertExists, assert } from "jsr:@std/assert";
import {
  serializeValue,
  getMemoryFilePath,
  appendToMemory,
  loadMemory,
  compactMemory,
  forgetFromMemory,
  getMemoryStats,
  getMemoryNames,
} from "../../../src/cli/repl/memory.ts";
import { evaluate } from "../../../src/cli/repl/evaluator.ts";
import { ReplState } from "../../../src/cli/repl/state.ts";
import { initializeRuntime } from "../../../src/common/runtime-initializer.ts";

// Helper to clean memory file before tests
async function cleanMemory(): Promise<void> {
  try {
    await Deno.remove(getMemoryFilePath());
  } catch {
    // Ignore if doesn't exist
  }
}

// Helper to create memory file with content
async function createMemoryFile(content: string): Promise<void> {
  const dir = getMemoryFilePath().replace("/memory.hql", "");
  await Deno.mkdir(dir, { recursive: true });
  await Deno.writeTextFile(getMemoryFilePath(), content);
}

// Initialize runtime once
await initializeRuntime();

// ============================================================
// serializeValue() tests
// ============================================================

Deno.test("serializeValue: numbers", () => {
  assertEquals(serializeValue(42), "42");
  assertEquals(serializeValue(3.14), "3.14");
  assertEquals(serializeValue(-10), "-10");
  assertEquals(serializeValue(0), "0");
});

Deno.test("serializeValue: strings", () => {
  assertEquals(serializeValue("hello"), '"hello"');
  assertEquals(serializeValue(""), '""');
  assertEquals(serializeValue('with "quotes"'), '"with \\"quotes\\""');
  assertEquals(serializeValue("with\nnewline"), '"with\\nnewline"');
  assertEquals(serializeValue("with\ttab"), '"with\\ttab"');
});

Deno.test("serializeValue: booleans", () => {
  assertEquals(serializeValue(true), "true");
  assertEquals(serializeValue(false), "false");
});

Deno.test("serializeValue: null and undefined", () => {
  assertEquals(serializeValue(null), "null");
  assertEquals(serializeValue(undefined), null); // undefined can't be serialized
});

Deno.test("serializeValue: arrays", () => {
  assertEquals(serializeValue([1, 2, 3]), "[1 2 3]");
  assertEquals(serializeValue([]), "[]");
  assertEquals(serializeValue(["a", "b"]), '["a" "b"]');
  assertEquals(serializeValue([1, [2, 3]]), "[1 [2 3]]");
});

Deno.test("serializeValue: objects", () => {
  assertEquals(serializeValue({ a: 1 }), '{"a": 1}');
  assertEquals(serializeValue({}), "{}");
  assertEquals(serializeValue({ x: 1, y: 2 }), '{"x": 1, "y": 2}');
  assertEquals(serializeValue({ nested: { a: 1 } }), '{"nested": {"a": 1}}');
});

Deno.test("serializeValue: functions return null", () => {
  assertEquals(serializeValue(() => {}), null);
  assertEquals(serializeValue(function foo() {}), null);
});

Deno.test("serializeValue: circular reference returns null", () => {
  const obj: Record<string, unknown> = { a: 1 };
  obj.self = obj;
  assertEquals(serializeValue(obj), null);
});

// ============================================================
// Memory file operations
// ============================================================

Deno.test("getMemoryFilePath: returns correct path", () => {
  const path = getMemoryFilePath();
  assert(path.endsWith("/.hql/memory.hql"));
});

Deno.test("appendToMemory: creates file and appends def", async () => {
  await cleanMemory();

  await appendToMemory("testVar", "def", 42);

  const content = await Deno.readTextFile(getMemoryFilePath());
  assert(content.includes("(def testVar 42)"));
});

Deno.test("appendToMemory: appends defn with source code", async () => {
  await cleanMemory();

  await appendToMemory("testFn", "defn", "(defn testFn [x] (* x 2))");

  const content = await Deno.readTextFile(getMemoryFilePath());
  assert(content.includes("(defn testFn [x] (* x 2))"));
});

Deno.test("appendToMemory: skips unserializable values", async () => {
  await cleanMemory();

  // Functions can't be serialized for def
  await appendToMemory("myFn", "def", () => {});

  try {
    const content = await Deno.readTextFile(getMemoryFilePath());
    assert(!content.includes("myFn"));
  } catch {
    // File might not exist if nothing was written - that's fine
  }
});

// ============================================================
// Compaction tests
// ============================================================

Deno.test("compactMemory: removes duplicates", async () => {
  await cleanMemory();

  // Write duplicates manually
  await createMemoryFile(`; HQL Memory
(def x 1)
(def y 2)
(def x 10)
`);

  const result = await compactMemory();

  assertEquals(result.before, 3);
  assertEquals(result.after, 2);

  const newContent = await Deno.readTextFile(getMemoryFilePath());
  const xMatches = newContent.match(/\(def x/g) || [];
  assertEquals(xMatches.length, 1);
  assert(newContent.includes("(def x 10)")); // Latest value kept
});

Deno.test("compactMemory: handles empty file", async () => {
  await cleanMemory();

  const result = await compactMemory();

  assertEquals(result.before, 0);
  assertEquals(result.after, 0);
});

// ============================================================
// Loading tests
// ============================================================

Deno.test("loadMemory: loads definitions", async () => {
  await cleanMemory();

  // Create memory file with definitions
  const content = `; HQL Memory
(def loadTestX 42)
(defn loadTestDouble [n] (* n 2))
`;
  await Deno.mkdir(getMemoryFilePath().replace("/memory.hql", ""), { recursive: true });
  await Deno.writeTextFile(getMemoryFilePath(), content);

  const state = new ReplState();
  state.setLoadingMemory(true);

  const result = await loadMemory(async (code: string) => {
    const r = await evaluate(code, state);
    return { success: r.success, error: r.error };
  });

  state.setLoadingMemory(false);

  assertEquals(result.count, 2);
  assertEquals(result.errors.length, 0);
});

Deno.test("loadMemory: handles malformed code gracefully", async () => {
  await cleanMemory();

  // Create memory file with some bad syntax
  const content = `; HQL Memory
(def goodVar 42)
(def badVar
(defn goodFn [x] x)
`;
  await Deno.mkdir(getMemoryFilePath().replace("/memory.hql", ""), { recursive: true });
  await Deno.writeTextFile(getMemoryFilePath(), content);

  const state = new ReplState();
  state.setLoadingMemory(true);

  const result = await loadMemory(async (code: string) => {
    const r = await evaluate(code, state);
    return { success: r.success, error: r.error };
  });

  state.setLoadingMemory(false);

  // Should load what it can, skip what it can't
  assert(result.count >= 1);
});

// ============================================================
// Forget tests
// ============================================================

Deno.test("forgetFromMemory: removes specific definition", async () => {
  await cleanMemory();

  const content = `; HQL Memory
(def keepMe 1)
(def forgetMe 2)
(def alsoKeep 3)
`;
  await Deno.mkdir(getMemoryFilePath().replace("/memory.hql", ""), { recursive: true });
  await Deno.writeTextFile(getMemoryFilePath(), content);

  const removed = await forgetFromMemory("forgetMe");

  assertEquals(removed, true);

  const newContent = await Deno.readTextFile(getMemoryFilePath());
  assert(!newContent.includes("forgetMe"));
  assert(newContent.includes("keepMe"));
  assert(newContent.includes("alsoKeep"));
});

Deno.test("forgetFromMemory: returns false for non-existent name", async () => {
  await cleanMemory();

  const content = `; HQL Memory
(def x 1)
`;
  await Deno.mkdir(getMemoryFilePath().replace("/memory.hql", ""), { recursive: true });
  await Deno.writeTextFile(getMemoryFilePath(), content);

  const removed = await forgetFromMemory("nonExistent");

  assertEquals(removed, false);
});

// ============================================================
// Stats tests
// ============================================================

Deno.test("getMemoryStats: returns correct stats", async () => {
  await cleanMemory();

  const content = `; HQL Memory
(def a 1)
(def b 2)
(defn c [x] x)
`;
  await Deno.mkdir(getMemoryFilePath().replace("/memory.hql", ""), { recursive: true });
  await Deno.writeTextFile(getMemoryFilePath(), content);

  const stats = await getMemoryStats();

  assertExists(stats);
  assertEquals(stats!.count, 3);
  assert(stats!.size > 0);
  assert(stats!.path.endsWith("memory.hql"));
});

Deno.test("getMemoryNames: returns all names", async () => {
  await cleanMemory();

  const content = `; HQL Memory
(def alpha 1)
(defn beta [x] x)
(def gamma 3)
`;
  await Deno.mkdir(getMemoryFilePath().replace("/memory.hql", ""), { recursive: true });
  await Deno.writeTextFile(getMemoryFilePath(), content);

  const names = await getMemoryNames();

  assertEquals(names.length, 3);
  assert(names.includes("alpha"));
  assert(names.includes("beta"));
  assert(names.includes("gamma"));
});

// ============================================================
// Integration: def/defn persist correctly via evaluator
// ============================================================

Deno.test("integration: def persists evaluated value", async () => {
  await cleanMemory();

  const state = new ReplState();

  // Evaluate (def x (+ 1 2)) - should persist VALUE 3, not expression
  await evaluate("(def intTestX (+ 10 32))", state);

  const content = await Deno.readTextFile(getMemoryFilePath());
  assert(content.includes("(def intTestX 42)"));
  assert(!content.includes("(+ 10 32)")); // Should NOT contain expression
});

Deno.test("integration: defn persists source code", async () => {
  await cleanMemory();

  const state = new ReplState();

  await evaluate("(defn intTestFn [n] (* n 2))", state);

  const content = await Deno.readTextFile(getMemoryFilePath());
  assert(content.includes("(defn intTestFn [n] (* n 2))"));
});

Deno.test("integration: let does NOT persist", async () => {
  await cleanMemory();

  const state = new ReplState();

  await evaluate("(let noPersistLet 999)", state);

  // Check if file exists and if so, verify it doesn't contain the let binding
  try {
    const content = await Deno.readTextFile(getMemoryFilePath());
    assert(!content.includes("noPersistLet"), "let should NOT persist to memory");
  } catch (e) {
    // File not existing is correct behavior - but only for NotFound errors
    if (!(e instanceof Deno.errors.NotFound)) {
      throw e; // Re-throw assertion errors and other real errors
    }
  }
});

Deno.test("integration: const does NOT persist", async () => {
  await cleanMemory();

  const state = new ReplState();

  await evaluate("(const noPersistConst 888)", state);

  try {
    const content = await Deno.readTextFile(getMemoryFilePath());
    assert(!content.includes("noPersistConst"), "const should NOT persist to memory");
  } catch (e) {
    if (!(e instanceof Deno.errors.NotFound)) {
      throw e;
    }
  }
});

Deno.test("integration: fn does NOT persist", async () => {
  await cleanMemory();

  const state = new ReplState();

  await evaluate("(fn noPersistFn [x] x)", state);

  try {
    const content = await Deno.readTextFile(getMemoryFilePath());
    assert(!content.includes("noPersistFn"), "fn should NOT persist to memory (only defn should)");
  } catch (e) {
    if (!(e instanceof Deno.errors.NotFound)) {
      throw e;
    }
  }
});

Deno.test("integration: loading does not re-persist", async () => {
  await cleanMemory();

  // Create initial memory
  const content = `; HQL Memory
(def reloadTest 42)
`;
  await Deno.mkdir(getMemoryFilePath().replace("/memory.hql", ""), { recursive: true });
  await Deno.writeTextFile(getMemoryFilePath(), content);

  const beforeSize = (await Deno.stat(getMemoryFilePath())).size;

  // Load memory (simulating REPL restart)
  const state = new ReplState();
  state.setLoadingMemory(true);
  await loadMemory(async (code: string) => {
    const r = await evaluate(code, state);
    return { success: r.success, error: r.error };
  });
  state.setLoadingMemory(false);

  const afterSize = (await Deno.stat(getMemoryFilePath())).size;

  // File should not have grown
  assertEquals(afterSize, beforeSize);
});

// ============================================================
// Edge cases
// ============================================================

Deno.test("edge: unicode in values", async () => {
  await cleanMemory();

  const state = new ReplState();
  await evaluate('(def unicodeTest "こんにちは")', state);

  const content = await Deno.readTextFile(getMemoryFilePath());
  assert(content.includes("こんにちは"));
});

Deno.test("edge: special characters in strings", async () => {
  await cleanMemory();

  const state = new ReplState();
  await evaluate('(def specialChars "a\\nb\\tc")', state);

  const content = await Deno.readTextFile(getMemoryFilePath());
  assert(content.includes("specialChars"));
});

Deno.test("edge: nested data structures", async () => {
  await cleanMemory();

  const state = new ReplState();
  await evaluate('(def nestedData {"a": [1, 2, {"b": 3}]})', state);

  const content = await Deno.readTextFile(getMemoryFilePath());
  assert(content.includes("nestedData"));
});

Deno.test("edge: corrupted file with unclosed paren skips malformed, loads rest", async () => {
  await cleanMemory();

  // Create corrupted memory file with unclosed paren
  const corruptedContent = `; HQL Memory
(def good1 100)
(def broken
(def good2 200)
(defn workingFn [x] (* x 2))
`;
  await Deno.mkdir(getMemoryFilePath().replace("/memory.hql", ""), { recursive: true });
  await Deno.writeTextFile(getMemoryFilePath(), corruptedContent);

  const state = new ReplState();
  state.setLoadingMemory(true);
  const loadResult = await loadMemory(async (code: string) => {
    const r = await evaluate(code, state);
    return { success: r.success, error: r.error };
  });
  state.setLoadingMemory(false);

  // Should load 3 definitions, skipping the malformed one
  assertEquals(loadResult.count, 3, "Should load 3 valid definitions");
  assertEquals(loadResult.errors.length, 0, "Should have no errors");

  // Verify each value works
  const g1 = await evaluate("good1", state);
  const g2 = await evaluate("good2", state);
  const fn = await evaluate("(workingFn 5)", state);

  assertEquals(g1.value, 100, "good1 should be 100");
  assertEquals(g2.value, 200, "good2 should be 200");
  assertEquals(fn.value, 10, "workingFn(5) should be 10");
});

// ============================================================
// Round-trip tests - verify loaded values actually work
// ============================================================

Deno.test("round-trip: def value is usable after reload", async () => {
  await cleanMemory();

  // Step 1: Define a value and persist it
  const state1 = new ReplState();
  await evaluate("(def roundTripValue 42)", state1);

  // Verify it was persisted
  const content = await Deno.readTextFile(getMemoryFilePath());
  assert(content.includes("(def roundTripValue 42)"), "Value should be persisted");

  // Step 2: Simulate REPL restart - new state, load from memory
  const state2 = new ReplState();
  state2.setLoadingMemory(true);
  const loadResult = await loadMemory(async (code: string) => {
    const r = await evaluate(code, state2);
    return { success: r.success, error: r.error };
  });
  state2.setLoadingMemory(false);

  assertEquals(loadResult.count, 1, "Should load 1 definition");
  assertEquals(loadResult.errors.length, 0, "Should have no errors");

  // Step 3: Verify the value is actually usable
  const useResult = await evaluate("roundTripValue", state2);
  assert(useResult.success, "Should be able to use loaded value");
  assertEquals(useResult.value, 42, "Loaded value should equal original");
});

Deno.test("round-trip: defn function executes after reload", async () => {
  await cleanMemory();

  // Step 1: Define a function and persist it
  const state1 = new ReplState();
  await evaluate("(defn roundTripDouble [x] (* x 2))", state1);

  // Verify it was persisted
  const content = await Deno.readTextFile(getMemoryFilePath());
  assert(content.includes("(defn roundTripDouble [x] (* x 2))"), "Function should be persisted");

  // Step 2: Simulate REPL restart
  const state2 = new ReplState();
  state2.setLoadingMemory(true);
  const loadResult = await loadMemory(async (code: string) => {
    const r = await evaluate(code, state2);
    return { success: r.success, error: r.error };
  });
  state2.setLoadingMemory(false);

  assertEquals(loadResult.count, 1, "Should load 1 definition");
  assertEquals(loadResult.errors.length, 0, "Should have no errors");

  // Step 3: Verify the function actually executes
  const callResult = await evaluate("(roundTripDouble 21)", state2);
  assert(callResult.success, "Should be able to call loaded function");
  assertEquals(callResult.value, 42, "Function should compute correct result");
});

Deno.test("round-trip: multiple definitions persist and load correctly", async () => {
  await cleanMemory();

  // Step 1: Define multiple values and functions
  const state1 = new ReplState();
  await evaluate("(def rtMultiA 10)", state1);
  await evaluate("(def rtMultiB 20)", state1);
  await evaluate("(defn rtMultiAdd [x y] (+ x y))", state1);

  // Step 2: Simulate REPL restart
  const state2 = new ReplState();
  state2.setLoadingMemory(true);
  const loadResult = await loadMemory(async (code: string) => {
    const r = await evaluate(code, state2);
    return { success: r.success, error: r.error };
  });
  state2.setLoadingMemory(false);

  assertEquals(loadResult.count, 3, "Should load 3 definitions");

  // Step 3: Verify all definitions work together
  const result = await evaluate("(rtMultiAdd rtMultiA rtMultiB)", state2);
  assert(result.success, "Should be able to use all loaded definitions");
  assertEquals(result.value, 30, "Computation should use loaded values");
});

// Clean up after all tests
Deno.test("cleanup", async () => {
  await cleanMemory();
});
