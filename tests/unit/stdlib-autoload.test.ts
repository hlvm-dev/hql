import { assertEquals } from "jsr:@std/assert@1";
import { run } from "./helpers.ts";

async function runLoose(code: string): Promise<unknown> {
  return await run(code, { typeCheck: false });
}

Deno.test("stdlib autoload: core lazy sequence primitives work without imports", async () => {
  const result = await runLoose(`
    (let nums [1 2 3 4 5 6 7 8 9 10])
    [
      (doall (take 3 nums))
      (doall (map (fn [x] (* x 2)) [1 2 3]))
      (doall (filter (fn [x] (=== (% x 2) 0)) nums))
      (reduce (fn [acc x] (+ acc x)) 0 [1 2 3 4 5])
      (doall (take 3 (range 10)))
      (doall (take 3 (filter (fn [x] (=== (% x 2) 0)) nums)))
    ]
  `);

  assertEquals(result, [
    [1, 2, 3],
    [2, 4, 6],
    [2, 4, 6, 8, 10],
    15,
    [0, 1, 2],
    [2, 4, 6],
  ]);
});

Deno.test("stdlib autoload: keys and groupBy preserve runtime semantics", async () => {
  const result = await runLoose(`
    (let obj {"a": 1, "b": 2, "c": 3})
    (let users-by-age (groupBy (fn [u] (get u "age")) [
      {"name": "Alice", "age": 28}
      {"name": "Bob", "age": 32}
      {"name": "Charlie", "age": 28}
    ]))
    (let nums-by-mod (groupBy (fn [x] (% x 3)) [1 2 3 4 5 6]))
    [
      [(get obj "a") (get obj "b") (get obj "c")]
      [(js-get (js-call users-by-age "get" 28) "length") (js-get (js-call users-by-age "get" 32) "length")]
      [(js-call nums-by-mod "get" 0) (js-call nums-by-mod "get" 1) (js-call nums-by-mod "get" 2)]
    ]
  `);

  assertEquals(result, [
    [1, 2, 3],
    [2, 1],
    [[3, 6], [1, 4], [2, 5]],
  ]);
});

Deno.test("stdlib autoload: first rest cons and isEmpty form the list core", async () => {
  const result = await runLoose(`
    (let list [1 2 3 4 5])
    (let iter-seq (iterate (fn [x] (if (=== x 0) undefined (- x 1))) 2))
    [
      (first list)
      (first [])
      (doall (rest list))
      (doall (cons 0 (cons (first list) (rest list))))
      (isEmpty [])
      (isEmpty [1])
      (isEmpty (take 3 iter-seq))
    ]
  `);

  assertEquals(result, [1, undefined, [2, 3, 4, 5], [0, 1, 2, 3, 4, 5], true, false, false]);
});

Deno.test("stdlib autoload: some returns boolean true or null", async () => {
  const result = await runLoose(`
    (fn greaterThan5 [x] (> x 5))
    (fn greaterThan10 [x] (> x 10))
    [(some greaterThan5 [1 2 6 3]) (some greaterThan10 [1 2 3])]
  `);

  assertEquals(result, [true, null]);
});

Deno.test("stdlib autoload: comp partial apply and iterate compose functions", async () => {
  const result = await runLoose(`
    (fn add [a b] (+ a b))
    (fn double [x] (* x 2))
    (fn increment [x] (+ x 1))
    (fn maximum [& args] (args.reduce (fn [a b] (if (> a b) a b))))
    (let add5 (partial add 5))
    (let add5ThenDouble (comp double add5))
    [
      (add5 10)
      (add5ThenDouble 10)
      (apply maximum [1 5 3 9 2])
      (doall (take 5 (iterate increment 0)))
    ]
  `);

  assertEquals(result, [15, 30, 9, [0, 1, 2, 3, 4]]);
});

Deno.test("stdlib autoload: flatten handles nested arrays and preserves strings and non-seq types", async () => {
  // flatten uses the .first/.rest seq protocol. Sets and Maps don't implement
  // this protocol, so they pass through unflattened (like strings).
  const result = await runLoose(`
    [
      (doall (flatten [[1 2] [3 4] [5]]))
      (doall (flatten [[1 [2 3]] [4 [5 6]]]))
      (doall (flatten [[1 2] "hello" [3 4]]))
    ]
  `);

  assertEquals(result, [
    [1, 2, 3, 4, 5],
    [1, 2, 3, 4, 5, 6],
    [1, 2, "hello", 3, 4],
  ]);
});
