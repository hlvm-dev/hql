import {
  assertSuccessWithOutputs,
  binaryTest,
  runExpression,
} from "../_shared/binary-helpers.ts";

binaryTest("stdlib binary: comp works with built-in and custom functions", async () => {
  const result = await runExpression('(print [((comp inc inc) 5) ((comp (fn [x] (* x 2)) inc) 5)])');
  assertSuccessWithOutputs(result, "7", "12");
});

binaryTest("stdlib binary: partial and apply preserve function invocation semantics", async () => {
  const result = await runExpression('(print [((partial add 10) 5) ((partial (fn [a b c] (+ a b c)) 1 2) 3) (apply (fn [a b c] (+ a b c)) [1 2 3])])');
  assertSuccessWithOutputs(result, "15", "6");
});
