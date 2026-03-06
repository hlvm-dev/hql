import { assertEquals, assertThrows } from "jsr:@std/assert@1";
import {
  every,
  isSome,
  LazySeq,
  notAny,
  notEvery,
} from "../../src/hql/lib/stdlib/js/index.js";

Deno.test("stdlib week5: every supports vacuous truth and short-circuits", () => {
  let counter = 0;
  const lazy = new LazySeq(function* () {
    for (const value of [2, 4, 3, 6]) {
      counter++;
      yield value;
    }
  });

  assertEquals(every((x: number) => x % 2 === 0, []), true);
  assertEquals(every((x: number) => x % 2 === 0, null), true);
  assertEquals(every((x: number) => x % 2 === 0, lazy), false);
  assertEquals(counter, 3);
});

Deno.test("stdlib week5: every validates the predicate", () => {
  assertThrows(() => every(null as unknown as ((value: number) => boolean), [1, 2, 3]), TypeError, "must be a function");
});

Deno.test("stdlib week5: notAny returns true only when no item matches", () => {
  let counter = 0;
  const lazy = new LazySeq(function* () {
    for (const value of [1, 3, 4, 7]) {
      counter++;
      yield value;
    }
  });

  assertEquals(notAny((x: number) => x % 2 === 0, []), true);
  assertEquals(notAny((x: number) => x % 2 === 0, null), true);
  assertEquals(notAny((x: number) => x % 2 === 0, lazy), false);
  assertEquals(counter, 3);
});

Deno.test("stdlib week5: notEvery mirrors every and short-circuits on the first failure", () => {
  let counter = 0;
  const lazy = new LazySeq(function* () {
    for (const value of [2, 4, 5, 6]) {
      counter++;
      yield value;
    }
  });

  assertEquals(notEvery((x: number) => x % 2 === 0, [2, 4, 6]), false);
  assertEquals(notEvery((x: number) => x % 2 === 0, lazy), true);
  assertEquals(counter, 3);
});

Deno.test("stdlib week5: notEvery validates the predicate", () => {
  assertThrows(() => notEvery("bad" as unknown as ((value: number) => boolean), [1, 2, 3]), TypeError, "must be a function");
});

Deno.test("stdlib week5: isSome only rejects nil values", () => {
  assertEquals(isSome(null), false);
  assertEquals(isSome(undefined), false);
  assertEquals(isSome(0), true);
  assertEquals(isSome(false), true);
  assertEquals(isSome(""), true);
  assertEquals(isSome([]), true);
});
