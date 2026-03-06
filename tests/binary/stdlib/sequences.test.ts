import {
  assertSuccessWithOutput,
  assertSuccessWithOutputs,
  binaryTest,
  runExpression,
} from "../_shared/binary-helpers.ts";

binaryTest("stdlib binary: map and filter compose end-to-end", async () => {
  const result = await runExpression('(print (vec (filter (fn [x] (> x 4)) (map (fn [x] (* x 2)) [1 2 3 4]))))');
  assertSuccessWithOutputs(result, "6", "8");
});

binaryTest("stdlib binary: reduce, take, and drop work with ranges", async () => {
  const result = await runExpression('(print [(reduce add 0 [1 2 3 4 5]) (vec (take 3 (range 100))) (vec (drop 2 [1 2 3 4 5]))])');
  assertSuccessWithOutputs(result, "15", "0", "1", "2", "3", "4", "5");
});

binaryTest("stdlib binary: concat, flatten, and distinct preserve sequence output", async () => {
  const result = await runExpression('(print [(vec (concat [1 2] [3 4])) (vec (flatten [[1 2] [3 4]])) (vec (distinct [1 2 2 3 3 3]))])');
  assertSuccessWithOutputs(result, "1", "2", "3", "4");
});

binaryTest("stdlib binary: reduce keeps init on empty collection", async () => {
  const result = await runExpression('(reduce add 100 [])');
  assertSuccessWithOutput(result, "100");
});
