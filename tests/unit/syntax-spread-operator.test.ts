// test/syntax-spread-operator.test.ts
// Unit tests for ...spread operator (JS-style spread syntax)
// Part of HQL v2.0 - JS syntax alignment

import { assertEquals } from "https://deno.land/std@0.208.0/assert/mod.ts";
import { run } from "./helpers.ts";

////////////////////////////////////////////////////////////////////////////////
// Section 1: Array Spread - Basic
////////////////////////////////////////////////////////////////////////////////

Deno.test("Spread: array at start", async () => {
  const result = await run(`
    (let arr [1 2])
    [...arr 3 4]
  `);
  assertEquals(result, [1, 2, 3, 4]);
});

Deno.test("Spread: array in middle", async () => {
  const result = await run(`
    (let arr [2 3])
    [1 ...arr 4]
  `);
  assertEquals(result, [1, 2, 3, 4]);
});

Deno.test("Spread: array at end", async () => {
  const result = await run(`
    (let arr [3 4])
    [1 2 ...arr]
  `);
  assertEquals(result, [1, 2, 3, 4]);
});

Deno.test("Spread: multiple arrays", async () => {
  const result = await run(`
    (let a [1 2])
    (let b [5 6])
    [0 ...a 3 4 ...b 7]
  `);
  assertEquals(result, [0, 1, 2, 3, 4, 5, 6, 7]);
});

Deno.test("Spread: empty array", async () => {
  const result = await run(`
    (let arr [])
    [1 ...arr 2]
  `);
  assertEquals(result, [1, 2]);
});

Deno.test("Spread: array of arrays", async () => {
  const result = await run(`
    (let nested [[1 2] [3 4]])
    [...nested [5 6]]
  `);
  assertEquals(result, [[1, 2], [3, 4], [5, 6]]);
});

////////////////////////////////////////////////////////////////////////////////
// Section 2: Function Call Spread - Basic
////////////////////////////////////////////////////////////////////////////////

Deno.test("Spread: spread all arguments", async () => {
  const result = await run(`
    (fn add [x y z] (+ x y z))
    (let args [1 2 3])
    (add ...args)
  `);
  assertEquals(result, 6);
});

Deno.test("Spread: mixed positional and spread", async () => {
  const result = await run(`
    (fn add [w x y z] (+ w x y z))
    (let rest [3 4])
    (add 1 2 ...rest)
  `);
  assertEquals(result, 10);
});

Deno.test("Spread: multiple spreads in call", async () => {
  const result = await run(`
    (fn sum [...nums]
      (.reduce nums (fn [a b] (+ a b)) 0))
    (let a [1 2])
    (let b [3 4])
    (sum ...a ...b)
  `);
  assertEquals(result, 10);
});

Deno.test("Spread: spread with rest parameter", async () => {
  const result = await run(`
    (fn sum [first ...rest]
      (+ first (.reduce rest (fn [a b] (+ a b)) 0)))
    (let nums [2 3 4])
    (sum 1 ...nums)
  `);
  assertEquals(result, 10);
});

Deno.test("Spread: empty array in call", async () => {
  const result = await run(`
    (fn add [x y] (+ x y))
    (let arr [])
    (add 5 7 ...arr)
  `);
  assertEquals(result, 12);
});

////////////////////////////////////////////////////////////////////////////////
// Section 3: Array Spread - Complex Scenarios
////////////////////////////////////////////////////////////////////////////////

Deno.test("Spread: nested array creation", async () => {
  const result = await run(`
    (let inner [2 3])
    (let outer [...inner 4])
    [1 ...outer 5]
  `);
  assertEquals(result, [1, 2, 3, 4, 5]);
});

Deno.test("Spread: with map", async () => {
  const result = await run(`
    (let arr [1 2 3])
    (let doubled (.map arr (fn [x] (* x 2))))
    [...doubled 7]
  `);
  assertEquals(result, [2, 4, 6, 7]);
});

Deno.test("Spread: with filter", async () => {
  const result = await run(`
    (let arr [1 2 3 4 5])
    (let evens (.filter arr (fn [x] (== (% x 2) 0))))
    [0 ...evens 6]
  `);
  assertEquals(result, [0, 2, 4, 6]);
});

////////////////////////////////////////////////////////////////////////////////
// Section 4: Function Call Spread - Complex Scenarios
////////////////////////////////////////////////////////////////////////////////

Deno.test("Spread: with higher-order function", async () => {
  const result = await run(`
    (fn apply [f ...args]
      (f ...args))
    (fn add [x y z] (+ x y z))
    (apply add 1 2 3)
  `);
  assertEquals(result, 6);
});

// NOTE: Spread of function call results `...(expr)` not yet supported

Deno.test("Spread: in method call", async () => {
  const result = await run(`
    (let arr [2 3 4])
    (.push arr ...arr)
    arr
  `);
  assertEquals(result, [2, 3, 4, 2, 3, 4]);
});

////////////////////////////////////////////////////////////////////////////////
// Section 5: Integration with Other Features
////////////////////////////////////////////////////////////////////////////////

Deno.test("Spread: with let binding", async () => {
  const result = await run(`
    (let a [1 2])
    (let b [3 4])
    (let combined [...a ...b])
    combined
  `);
  assertEquals(result, [1, 2, 3, 4]);
});

Deno.test("Spread: with template literals", async () => {
  const result = await run(`
    (let vals [2 3])
    (let arr [1 ...vals 4])
    \`result: \${(get arr 0)} \${(get arr 1)} \${(get arr 2)} \${(get arr 3)}\`
  `);
  assertEquals(result, "result: 1 2 3 4");
});

Deno.test("Spread: with ternary", async () => {
  const result = await run(`
    (let useSpread true)
    (let arr [2 3])
    (? useSpread [1 ...arr 4] [1 2 3 4])
  `);
  assertEquals(result, [1, 2, 3, 4]);
});

////////////////////////////////////////////////////////////////////////////////
// Section 6: Edge Cases
////////////////////////////////////////////////////////////////////////////////

Deno.test("Spread: single element array", async () => {
  const result = await run(`
    (let arr [42])
    [1 ...arr 3]
  `);
  assertEquals(result, [1, 42, 3]);
});

Deno.test("Spread: only spread no literals", async () => {
  const result = await run(`
    (let a [1 2])
    (let b [3 4])
    [...a ...b]
  `);
  assertEquals(result, [1, 2, 3, 4]);
});

Deno.test("Spread: spread same array multiple times", async () => {
  const result = await run(`
    (let arr [1 2])
    [...arr ...arr]
  `);
  assertEquals(result, [1, 2, 1, 2]);
});

Deno.test("Spread: deeply nested spreads", async () => {
  const result = await run(`
    (let a [1])
    (let b [...a 2])
    (let c [...b 3])
    [...c 4]
  `);
  assertEquals(result, [1, 2, 3, 4]);
});

////////////////////////////////////////////////////////////////////////////////
// Section 7: Object Spread - Basic
////////////////////////////////////////////////////////////////////////////////

Deno.test("Spread: object at start", async () => {
  const result = await run(`
    (let obj {"b": 2, "c": 3})
    {...obj, "a": 1}
  `);
  assertEquals(result, { b: 2, c: 3, a: 1 });
});

Deno.test("Spread: object in middle", async () => {
  const result = await run(`
    (let obj {"b": 2, "c": 3})
    {"a": 1, ...obj, "d": 4}
  `);
  assertEquals(result, { a: 1, b: 2, c: 3, d: 4 });
});

Deno.test("Spread: object at end", async () => {
  const result = await run(`
    (let obj {"b": 2, "c": 3})
    {"a": 1, ...obj}
  `);
  assertEquals(result, { a: 1, b: 2, c: 3 });
});

Deno.test("Spread: multiple objects", async () => {
  const result = await run(`
    (let a {"a": 1})
    (let b {"b": 2})
    (let c {"c": 3})
    {...a, ...b, ...c}
  `);
  assertEquals(result, { a: 1, b: 2, c: 3 });
});

Deno.test("Spread: object overwrite property", async () => {
  const result = await run(`
    (let obj {"a": 1, "b": 2})
    {...obj, "a": 99}
  `);
  assertEquals(result, { a: 99, b: 2 });
});

Deno.test("Spread: property then spread overwrite", async () => {
  const result = await run(`
    (let obj {"a": 99, "b": 2})
    {"a": 1, ...obj}
  `);
  assertEquals(result, { a: 99, b: 2 });
});

Deno.test("Spread: empty object", async () => {
  const result = await run(`
    (let obj {})
    {"a": 1, ...obj, "b": 2}
  `);
  assertEquals(result, { a: 1, b: 2 });
});

Deno.test("Spread: nested object values", async () => {
  const result = await run(`
    (let inner {"x": 1})
    (let obj {"a": inner})
    {...obj, "b": 2}
  `);
  assertEquals(result, { a: { x: 1 }, b: 2 });
});

////////////////////////////////////////////////////////////////////////////////
// Section 8: Object Spread - Complex Scenarios
////////////////////////////////////////////////////////////////////////////////

Deno.test("Spread: spread with computed properties", async () => {
  const result = await run(`
    (let obj {"a": 1, "b": 2})
    (let merged {...obj, "c": (+ 1 2)})
    merged
  `);
  assertEquals(result, { a: 1, b: 2, c: 3 });
});

Deno.test("Spread: spread in let binding", async () => {
  const result = await run(`
    (let base {"x": 10, "y": 20})
    (let extended {...base, "z": 30})
    extended
  `);
  assertEquals(result, { x: 10, y: 20, z: 30 });
});

Deno.test("Spread: multiple spreads with overwrites", async () => {
  const result = await run(`
    (let a {"x": 1, "y": 2})
    (let b {"y": 99, "z": 3})
    {...a, ...b}
  `);
  assertEquals(result, { x: 1, y: 99, z: 3 });
});

////////////////////////////////////////////////////////////////////////////////
// Section 9: Inline Expression Spread (List Form)
////////////////////////////////////////////////////////////////////////////////

Deno.test("Spread: inline array expression", async () => {
  const result = await run(`
    [(... [1 2]) 3]
  `);
  assertEquals(result, [1, 2, 3]);
});

Deno.test("Spread: inline function call expression", async () => {
  const result = await run(`
    (fn getItems [] [1 2])
    [(... (getItems)) 3]
  `);
  assertEquals(result, [1, 2, 3]);
});

Deno.test("Spread: multiple inline expressions", async () => {
  const result = await run(`
    [(... [1 2]) (... [3 4]) 5]
  `);
  assertEquals(result, [1, 2, 3, 4, 5]);
});

Deno.test("Spread: inline expression with map", async () => {
  const result = await run(`
    (let arr [1 2])
    [(... (map (=> (* $0 2)) arr)) 99]
  `);
  assertEquals(result, [2, 4, 99]);
});

Deno.test("Spread: inline object expression", async () => {
  const result = await run(`
    (hash-map (... (hash-map "a" 1)) "b" 2)
  `);
  assertEquals(result, { a: 1, b: 2 });
});

Deno.test("Spread: mixed symbol and list form", async () => {
  const result = await run(`
    (let arr1 [1 2])
    [...arr1 (... [3 4]) 5]
  `);
  assertEquals(result, [1, 2, 3, 4, 5]);
});

Deno.test("Spread: nested inline expressions", async () => {
  const result = await run(`
    [(... [(... [1]) 2]) 3]
  `);
  assertEquals(result, [1, 2, 3]);
});

Deno.test("Spread: inline expression in function call", async () => {
  const result = await run(`
    (fn makeArray [...nums] nums)
    (makeArray (... [1 2 3 4]))
  `);
  assertEquals(result, [1, 2, 3, 4]);
});

////////////////////////////////////////////////////////////////////////////////
// Section 10: Method Call Spread
////////////////////////////////////////////////////////////////////////////////

Deno.test("Spread: js-call method with spread", async () => {
  const result = await run(`
    (let items [1 2 3])
    (let arr [])
    (js-call arr "push" ...items)
    arr
  `);
  assertEquals(result, [1, 2, 3]);
});

Deno.test("Spread: dot notation method with spread", async () => {
  const result = await run(`
    (let items [1 2 3])
    (let arr [])
    (arr .push ...items)
    arr
  `);
  assertEquals(result, [1, 2, 3]);
});

Deno.test("Spread: method call with inline expression", async () => {
  const result = await run(`
    (let arr [])
    (js-call arr "push" (... [1 2 3]))
    arr
  `);
  assertEquals(result, [1, 2, 3]);
});

Deno.test("Spread: multiple spreads in method call", async () => {
  const result = await run(`
    (let arr1 [1 2])
    (let arr2 [3 4])
    (let result [])
    (js-call result "push" ...arr1 ...arr2)
    result
  `);
  assertEquals(result, [1, 2, 3, 4]);
});

Deno.test("Spread: mixed regular and spread in method call", async () => {
  const result = await run(`
    (let items [2 3])
    (let arr [])
    (arr .push 1 ...items 4)
    arr
  `);
  assertEquals(result, [1, 2, 3, 4]);
});

Deno.test("Spread: concat method with spread", async () => {
  const result = await run(`
    (let arr1 [1 2])
    (let arr2 [3 4])
    (arr1 .concat ...arr2)
  `);
  assertEquals(result, [1, 2, 3, 4]);
});

Deno.test("Spread: method chain with spread", async () => {
  const result = await run(`
    (let items [2 4 6])
    (items .filter (=> (=== (% $0 2) 0)))
  `);
  assertEquals(result, [2, 4, 6]);
});

Deno.test("Spread: method call with rest parameter spread", async () => {
  const result = await run(`
    (fn doMany [...items]
      (let arr [])
      (js-call arr "push" ...items)
      arr)
    (doMany 1 2 3)
  `);
  assertEquals(result, [1, 2, 3]);
});
