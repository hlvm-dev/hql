// hql_test.ts - Unit tests for the HQL interpreter, including tests for module imports.
// Run these tests with: 
//    deno test --allow-read --allow-write --allow-net hql_test.ts

import { runHQLFile, getExport } from "./hql.ts";
import { assertEquals, assertThrows } from "https://deno.land/std@0.170.0/testing/asserts.ts";

// ---------- Arithmetic Operations Test ----------
Deno.test("Arithmetic operations", async () => {
  const code = `
    (def addTest (fn ((a Number) (b Number)) (+ a b)))
    (export "addTest" addTest)
  `;
  const testFile = "temp_test.hql";
  await Deno.writeTextFile(testFile, code);
  await runHQLFile(testFile);
  const addTest = getExport("addTest");
  // Since addTest is defined with "def", it returns an async function,
  // so we must await its result.
  assertEquals(await addTest(5, 7), 12);
  await Deno.remove(testFile);
});

// ---------- Defsync Synchronous Behavior Test ----------
Deno.test("Defsync function synchronous behavior", async () => {
  const code = `
    (defsync syncTest (fn ((x Number)) (+ x 10)))
    (export "syncTest" syncTest)
  `;
  const testFile = "temp_sync.hql";
  await Deno.writeTextFile(testFile, code);
  await runHQLFile(testFile);
  const syncTest = getExport("syncTest");
  // syncTest is defined with defsync so it returns a plain value.
  const result = syncTest(5);
  assertEquals(result, 15);
  await Deno.remove(testFile);
});

// ---------- Async Operation in Defsync Error Test ----------
Deno.test("Error on async operation in defsync", async () => {
  const code = `
    (defsync faulty (fn () (sleep 100)))
    (export "faulty" faulty)
  `;
  const testFile = "temp_faulty.hql";
  await Deno.writeTextFile(testFile, code);
  await runHQLFile(testFile);
  const faulty = getExport("faulty");
  // The error message now is "Sync code tried to call async operation 'sleep'!"
  assertThrows(
    () => { faulty(); },
    Error,
    "Sync code tried to call async operation"
  );
  await Deno.remove(testFile);
});

// ---------- Built-in Keyword Function Test ----------
Deno.test("Built-in keyword function", async () => {
  const code = `
    (def testKeyword (fn ((s String)) (keyword s)))
    (export "testKeyword" testKeyword)
  `;
  const testFile = "temp_keyword.hql";
  await Deno.writeTextFile(testFile, code);
  await runHQLFile(testFile);
  const testKeyword = getExport("testKeyword");
  // testKeyword returns an async function, so await its result.
  const result = await testKeyword("a");
  assertEquals(result, ":a");
  await Deno.remove(testFile);
});

// ---------- Data Structure Constructor Test ----------
Deno.test("Data structure constructors", async () => {
  const code = `
    (def testVector (fn () (vector 1 2 3)))
    (export "testVector" testVector)
  `;
  const testFile = "temp_vector.hql";
  await Deno.writeTextFile(testFile, code);
  await runHQLFile(testFile);
  const testVector = getExport("testVector");
  // testVector is async, so await its result.
  const result = await testVector();
  // Expected: (vector 1 2 3) is represented as an array: ["vector", 1, 2, 3]
  assertEquals(result, ["vector", 1, 2, 3]);
  await Deno.remove(testFile);
});

// ---------- npm Module Import Test (lodash) ----------
Deno.test("Import npm module: lodash", async () => {
  const code = `
    (def lodash (import "npm:lodash"))
    (def chunk (get lodash "chunk"))
    (def chunked (chunk (list 1 2 3 4 5 6) 2))
    (export "chunked" chunked)
  `;
  const testFile = "temp_lodash.hql";
  await Deno.writeTextFile(testFile, code);
  await runHQLFile(testFile);
  const chunked = getExport("chunked");
  // Expected result: [[1,2], [3,4], [5,6]]
  assertEquals(chunked, [[1,2], [3,4], [5,6]]);
  await Deno.remove(testFile);
});

// ---------- Deno Module Import Test (chalk) ----------
Deno.test("Import deno module: chalk", async () => {
  const code = `
    (def chalk (import "https://deno.land/x/chalk_deno@v4.1.1-deno/source/index.js"))
    (def blue (get chalk "blue"))
    (def message (blue "hello hql!"))
    (export "message" message)
  `;
  const testFile = "temp_chalk.hql";
  await Deno.writeTextFile(testFile, code);
  await runHQLFile(testFile);
  const message = getExport("message");
  // Check that message is a string and that it includes "hello hql!".
  if (typeof message !== "string") {
    throw new Error("Expected message to be a string");
  }
  if (!message.includes("hello hql!")) {
    throw new Error("Message does not include 'hello hql!'");
  }
  await Deno.remove(testFile);
});
