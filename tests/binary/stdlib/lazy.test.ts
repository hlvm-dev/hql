import {
  assertSuccessWithOutputs,
  binaryTest,
  runExpression,
} from "../_shared/binary-helpers.ts";

binaryTest("stdlib binary: repeat macro and repeatedly both execute lazily", async () => {
  const result = await runExpression(`
    (var count 0)
    (repeat 3 (= count (+ count 10)))
    (print [count (vec (take 4 (repeatedly (fn [] 42))))])
  `);
  assertSuccessWithOutputs(result, "30", "42");
});

binaryTest("stdlib binary: cycle and iterate generate infinite-style sequences", async () => {
  const result = await runExpression('(print [(vec (take 6 (cycle [1 2 3]))) (vec (take 5 (iterate inc 0)))])');
  assertSuccessWithOutputs(result, "[ 1, 2, 3, 1, 2, 3 ]", "[ 0, 1, 2, 3, 4 ]");
});

binaryTest("stdlib binary: seq, conj, and into preserve collection behavior", async () => {
  const result = await runExpression('(print [(first (seq [1 2 3])) (conj [1 2] 3 4) (into [1 2] [3 4])])');
  assertSuccessWithOutputs(result, "1", "2", "3", "4");
});

binaryTest("stdlib binary: mapIndexed, keep, and mapcat transform lazily", async () => {
  const result = await runExpression('(print [(vec (mapIndexed (fn [i x] (+ i x)) [10 20 30])) (vec (keep (fn [x] (if (> x 2) x null)) [1 2 3 4 5])) (vec (mapcat (fn [x] [x x]) [1 2 3]))])');
  assertSuccessWithOutputs(result, "10", "21", "32", "3", "4", "5");
});
