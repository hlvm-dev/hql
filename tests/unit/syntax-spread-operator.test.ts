import { assertEquals } from "jsr:@std/assert@1";
import { run } from "./helpers.ts";

// Runtime coverage only: current type-checking still lags some spread forms.
const runSpread = (code: string) => run(code, { typeCheck: false });

Deno.test("Spread: array literals preserve position, multiple sources, and copy semantics", async () => {
  const result = await runSpread(`
    (let left [2 3])
    (let right [4 5])
    (let copy [...left ...right])
    (js-set copy 0 99)
    [
      [1 ...left]
      [...left ...right 6]
      copy
      left
    ]
  `);

  assertEquals(result, [
    [1, 2, 3],
    [2, 3, 4, 5, 6],
    [99, 3, 4, 5],
    [2, 3],
  ]);
});

Deno.test("Spread: function calls support positional and multiple spread expansion", async () => {
  const result = await runSpread(`
    (fn add [a b c d] (+ a b c d))
    (let middle [2 3])
    (let tail [4])
    (let left [1 2])
    (let right [3 4])
    [
      (add 1 ...middle ...tail)
      (add ...left ...right)
    ]
  `);

  assertEquals(result, [10, 10]);
});

Deno.test("Spread: object literals merge sources and honor overwrite order", async () => {
  const result = await runSpread(`
    (let base {"a": 1, "b": 2})
    (let override {"b": 99, "c": 3})
    [
      {...base}
      {...base, ...override}
      {"b": 0, ...override, "d": 4}
      {...base, "a": 7}
    ]
  `);

  assertEquals(result, [
    { a: 1, b: 2 },
    { a: 1, b: 99, c: 3 },
    { b: 99, c: 3, d: 4 },
    { a: 7, b: 2 },
  ]);
});

Deno.test("Spread: inline expression form works in arrays and hash maps", async () => {
  const result = await runSpread(`
    (fn getItems [] [2 3])
    [
      [1 (... (getItems)) 4]
      [(... [1 2]) (... [3 4]) 5]
      (hash-map (... (hash-map "a" 1)) "b" 2)
    ]
  `);

  assertEquals(result, [
    [1, 2, 3, 4],
    [1, 2, 3, 4, 5],
    { a: 1, b: 2 },
  ]);
});

Deno.test("Spread: method calls accept spread arguments through js-call and dot syntax", async () => {
  const result = await runSpread(`
    (let items [1 2 3])
    (let more [4 5])
    (let via-js-call [])
    (let via-dot [])
    (let combined [])
    (js-call via-js-call "push" ...items)
    (via-dot .push ...items)
    (js-call combined "push" ...items ...more)
    [via-js-call via-dot combined]
  `);

  assertEquals(result, [
    [1, 2, 3],
    [1, 2, 3],
    [1, 2, 3, 4, 5],
  ]);
});

Deno.test("Spread: let-bound copies created with spread do not mutate the source", async () => {
  const result = await runSpread(`
    (let [src [10 20 30]]
      (let [copy [...src]]
        (js-set copy 1 999)
        [copy src]))
  `);

  assertEquals(result, [
    [10, 999, 30],
    [10, 20, 30],
  ]);
});
