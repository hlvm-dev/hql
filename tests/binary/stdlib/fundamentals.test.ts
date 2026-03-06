import {
  assertSuccessWithOutput,
  assertSuccessWithOutputs,
  binaryTest,
  runExpression,
} from "../_shared/binary-helpers.ts";

binaryTest("stdlib binary: sequence fundamentals work end-to-end", async () => {
  const result = await runExpression('(print [(first [1 2 3]) (vec (rest [1 2 3])) (vec (cons 0 [1 2 3]))])');
  assertSuccessWithOutputs(result, "1", "2", "3", "0");
});

binaryTest("stdlib binary: indexed access and counts work end-to-end", async () => {
  const result = await runExpression('(print [(nth [10 20 30] 2) (count "hello") (second [10 20 30]) (last [10 20 30])])');
  assertSuccessWithOutputs(result, "30", "5", "20");
});

binaryTest("stdlib binary: empty and string semantics stay intact", async () => {
  const result = await runExpression('(print [(first []) (first "hello") (count []) (isEmpty [])])');
  assertSuccessWithOutputs(result, "undefined", "h", "0", "true");
});

binaryTest("stdlib binary: nil-safe nth fallback works", async () => {
  const result = await runExpression('(nth null 0 "missing")');
  assertSuccessWithOutput(result, "missing");
});
