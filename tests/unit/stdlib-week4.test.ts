import { assertEquals, assertThrows } from "jsr:@std/assert@1";
import {
  cycle,
  doall,
  LazySeq,
  repeat,
  repeatedly,
  take,
} from "../../src/hql/lib/stdlib/js/index.js";

Deno.test("stdlib week4: repeat is lazy and reuses the same value", () => {
  const obj = { value: 1 };
  const repeated = repeat(obj);
  const result = doall(take(3, repeated));

  assertEquals(result, [obj, obj, obj]);
  assertEquals(result[0] === result[1], true);
});

Deno.test("stdlib week4: repeatedly defers generator calls until realization", () => {
  let counter = 0;
  const lazy = repeatedly(() => counter++);

  assertEquals(counter, 0);
  assertEquals(doall(take(3, lazy)), [0, 1, 2]);
  assertEquals(counter, 3);
});

Deno.test("stdlib week4: repeatedly validates its callback", () => {
  assertThrows(() => repeatedly(null as unknown as (() => unknown)), TypeError, "must be a function");
});

Deno.test("stdlib week4: cycle repeats finite input and handles empty input", () => {
  assertEquals(doall(take(7, cycle([1, 2, 3])!)), [1, 2, 3, 1, 2, 3, 1]);
  assertEquals(doall(take(5, cycle("ab")!)), ["a", "b", "a", "b", "a"]);
  assertEquals(cycle([]), null);
  assertEquals(cycle(null), null);
});

Deno.test("stdlib week4: cycle realizes a lazy source once before repeating it", () => {
  let realized = 0;
  const lazy = new LazySeq(function* () {
    realized++;
    yield 1;
    realized++;
    yield 2;
  });

  const result = doall(take(5, cycle(lazy)!));

  assertEquals(result, [1, 2, 1, 2, 1]);
  assertEquals(realized, 2);
});
