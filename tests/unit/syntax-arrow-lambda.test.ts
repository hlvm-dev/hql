import { assertEquals, assertRejects } from "https://deno.land/std@0.208.0/assert/mod.ts";
import { run } from "./helpers.ts";

Deno.test("arrow lambda: implicit parameters cover single, multiple, gaps, and inline calls", async () => {
  const result = await run(`
    (let double (=> (* $0 2)))
    (let add (=> (+ $0 $1)))
    (let sum3 (=> (+ $0 (+ $1 $2))))
    (let gap (=> (+ $0 $2)))
    [
      (double 5)
      (add 3 7)
      (sum3 10 20 30)
      (gap 10 999 20)
      ((=> (* $0 3)) 7)
    ]
  `);

  assertEquals(result, [10, 10, 60, 30, 21]);
});

Deno.test("arrow lambda: explicit parameters support zero, one, and many args", async () => {
  const result = await run(`
    (let constant (=> () 42))
    (let square (=> (x) (* x x)))
    (let multiply (=> (x y) (* x y)))
    [(constant) (square 7) (multiply 6 7)]
  `);

  assertEquals(result, [42, 49, 42]);
});

Deno.test("arrow lambda: integrates with lazy collection operations", async () => {
  const result = await run(`
    (let nums [1 2 3 4 5 6 7 8 9 10])
    [
      (doall (map (=> (* $0 2)) [1 2 3 4 5]))
      (doall (filter (=> (> $0 5)) [1 3 6 8 2 9]))
      (reduce (=> (+ $0 $1)) 0 [1 2 3 4 5])
      (doall
        (take 3
          (filter (=> (> $0 0))
            (map (=> (* $0 2)) nums))))
    ]
  `);

  assertEquals(result, [
    [2, 4, 6, 8, 10],
    [6, 8, 9],
    15,
    [2, 4, 6],
  ]);
});

Deno.test("arrow lambda: nested lambdas preserve scope and compose correctly", async () => {
  const result = await run(`
    (let matrix [[1 2] [3 4] [5 6]])
    (let doubled (map (=> (map (=> (* $0 2)) $0)) matrix))
    (let scale (=> (x) (map (=> (* $0 x)) [1 2 3])))
    [(doall (map doall doubled)) (doall (scale 10))]
  `);

  assertEquals(result, [[[2, 4], [6, 8], [10, 12]], [10, 20, 30]]);
});

Deno.test("arrow lambda: bodies support do, conditionals, property access, and nested structures", async () => {
  const result = await run(`
    (let transform (=> (x)
      (do
        (var temp (* x 2))
        (= temp (+ temp 1))
        temp)))
    (let abs (=> (if (< $0 0) (- $0) $0)))
    (let get-name (=> ($0.name)))
    (let shape (=> [(* $0 2) (+ $0 1)]))
    [(transform 5) (abs -5) (abs 5) (get-name {name: "Alice"}) (shape 5)]
  `);

  assertEquals(result, [11, 5, 5, "Alice", [10, 6]]);
});

Deno.test("arrow lambda: supports real-world array operations", async () => {
  const result = await run(`
    (let nums [5 2 8 1 9 3])
    (let users [
      {name: "Alice", age: 30}
      {name: "Bob", age: 25}
      {name: "Carol", age: 35}
    ])
    (let data [
      {x: 1, y: 2}
      {x: 3, y: 4}
    ])
    [
      ((nums.slice 0).sort (=> (- $0 $1)))
      ((users.find (=> (=== $0.name "Bob"))).age)
      (doall (map (=> (+ $0.x $0.y)) data))
      (reduce (=> (+ $0 $1)) 0
        (map (=> (* $0 $0))
          (filter (=> (> $0 2)) [1 2 3 4 5])))
    ]
  `);

  assertEquals(result, [[1, 2, 3, 5, 8, 9], 25, [3, 7], 50]);
});

Deno.test("arrow lambda: rejects invalid forms", async () => {
  await assertRejects(
    async () => await run("(=> 42)"),
    Error,
    "must use $0, $1, $2",
  );
  await assertRejects(
    async () => await run("(=> (x y))"),
    Error,
  );
  await assertRejects(
    async () => await run("(=> $300)"),
    Error,
    "too many implicit parameters",
  );
});
