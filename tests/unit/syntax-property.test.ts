// test/syntax-property.test.ts
// Comprehensive tests for property access patterns
// Covers dot notation, bracket notation, nested access, method calls

import { assertEquals } from "https://deno.land/std@0.208.0/assert/mod.ts";
import { run } from "./helpers.ts";

// ============================================================================
// SECTION 1: DOT NOTATION PROPERTY ACCESS
// ============================================================================

Deno.test("Property: access object property with dot notation", async () => {
  const code = `
(var person {\"name\": \"Alice\", \"age\": 30})
person.name
`;
  const result = await run(code);
  assertEquals(result, "Alice");
});

Deno.test("Property: access nested property with dot notation", async () => {
  const code = `
(var user {\"profile\": {\"name\": \"Bob\", \"email\": \"bob@test.com\"}})
user.profile
`;
  const result = await run(code);
  assertEquals(result.name, "Bob");
  assertEquals(result.email, "bob@test.com");
});

Deno.test("Property: access array length property", async () => {
  const code = `
(var nums [1, 2, 3, 4, 5])
nums.length
`;
  const result = await run(code);
  assertEquals(result, 5);
});

Deno.test("Property: access string length property", async () => {
  const code = `
(var str \"Hello World\")
str.length
`;
  const result = await run(code);
  assertEquals(result, 11);
});

// ============================================================================
// SECTION 2: BRACKET NOTATION WITH GET
// ============================================================================

Deno.test("Property: access with get function and string key", async () => {
  const code = `
(var person {\"name\": \"Charlie\", \"age\": 25})
(get person \"name\")
`;
  const result = await run(code);
  assertEquals(result, "Charlie");
});

Deno.test("Property: access array element with get and numeric index", async () => {
  const code = `
(var colors [\"red\", \"green\", \"blue\"])
(get colors 1)
`;
  const result = await run(code);
  assertEquals(result, "green");
});

Deno.test("Property: access nested property with chained get", async () => {
  const code = `
(var data {\"users\": [{\"name\": \"Alice\"}, {\"name\": \"Bob\"}]})
(get (get (get data \"users\") 1) \"name\")
`;
  const result = await run(code);
  assertEquals(result, "Bob");
});

// ============================================================================
// SECTION 3: METHOD INVOCATION VIA PROPERTY ACCESS
// ============================================================================

Deno.test("Property: call method with dot notation", async () => {
  const code = `
(var str \"  hello  \")
(str.trim)
`;
  const result = await run(code);
  assertEquals(result, "hello");
});

Deno.test("Property: call method with arguments", async () => {
  const code = `
(var str \"Hello\")
(str.charAt 1)
`;
  const result = await run(code);
  assertEquals(result, "e");
});

Deno.test("Property: call array push method", async () => {
  const code = `
(var nums [1, 2, 3])
(nums.push 4)
nums
`;
  const result = await run(code);
  assertEquals(result, [1, 2, 3, 4]);
});

Deno.test("Property: call array map method with anonymous fn", async () => {
  const code = `
(var nums [1, 2, 3])
(nums.map (fn [n] (* n 2)))
`;
  const result = await run(code);
  assertEquals(result, [2, 4, 6]);
});

Deno.test("Property: call array filter method with anonymous fn", async () => {
  const code = `
(var nums [1, 2, 3, 4, 5])
(nums.filter (fn [n] (> n 2)))
`;
  const result = await run(code);
  assertEquals(result, [3, 4, 5]);
});

// ============================================================================
// SECTION 4: CHAINED PROPERTY ACCESS
// ============================================================================

Deno.test("Property: chain multiple method calls", async () => {
  const code = `
(var str \"  HELLO  \")
((str.trim).toLowerCase)
`;
  const result = await run(code);
  assertEquals(result, "hello");
});

Deno.test("Property: chain map and filter operations", async () => {
  const code = `
(var nums [1, 2, 3, 4, 5])
(var doubled (nums.map (fn [n] (* n 2))))
(doubled.filter (fn [n] (> n 5)))
`;
  const result = await run(code);
  assertEquals(result, [6, 8, 10]);
});

// ============================================================================
// SECTION 5: PROPERTY ACCESS ON CLASS INSTANCES
// ============================================================================

Deno.test("Property: access class instance property", async () => {
  const code = `
(class Person
  (constructor (name age)
    (do
      (= this.name name)
      (= this.age age))))

(var p (new Person \"Alice\" 30))
p.name
`;
  const result = await run(code);
  assertEquals(result, "Alice");
});

Deno.test("Property: call class instance method", async () => {
  const code = `
(class Calculator
  (constructor (base)
    (= this.base base))

  (fn add [x]
    (+ this.base x)))

(var calc (new Calculator 10))
(calc.add 5)
`;
  const result = await run(code);
  assertEquals(result, 15);
});

// ============================================================================
// SECTION 6: DYNAMIC PROPERTY ACCESS
// ============================================================================

Deno.test("Property: access property with variable key", async () => {
  const code = `
(var obj {\"x\": 10, \"y\": 20})
(var key \"x\")
(get obj key)
`;
  const result = await run(code);
  assertEquals(result, 10);
});

Deno.test("Property: access array element with variable index", async () => {
  const code = `
(var arr [\"a\", \"b\", \"c\"])
(var idx 2)
(get arr idx)
`;
  const result = await run(code);
  assertEquals(result, "c");
});

// ============================================================================
// SECTION 7: PROPERTY MODIFICATION
// ============================================================================

Deno.test("Property: modify object property via =", async () => {
  const code = `
(var obj {\"count\": 0})
(= obj.count 42)
obj.count
`;
  const result = await run(code);
  assertEquals(result, 42);
});

Deno.test("Property: add new property via =", async () => {
  const code = `
(var obj {\"name\": \"Test\"})
(= obj.newProp \"added\")
obj.newProp
`;
  const result = await run(code);
  assertEquals(result, "added");
});
