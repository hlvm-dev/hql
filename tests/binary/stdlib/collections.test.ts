import {
  assertSuccessWithOutput,
  assertSuccessWithOutputs,
  binaryTest,
  runExpression,
} from "../_shared/binary-helpers.ts";

binaryTest("stdlib binary: get and getIn read nested data end-to-end", async () => {
  const result = await runExpression('(print [(get {"a": 1} "a") (get {"a": 1} "b" 99) (get [10 20 30] 1) (getIn {"user": {"name": "Bob"}, "items": [10 20 30]} ["user" "name"]) (getIn {"items": [10 20 30]} ["items" 1])])');
  assertSuccessWithOutputs(result, "1", "99", "20", "Bob");
});

binaryTest("stdlib binary: assoc, update, and merge transform maps end-to-end", async () => {
  const result = await runExpression('(print [(assoc {"a": 1} "b" 2) (get (update {"count": 5} "count" inc) "count") (merge {"a": 1} {"a": 99, "b": 2})])');
  assertSuccessWithOutputs(result, "a", "b", "6", "99");
});

binaryTest("stdlib binary: dissoc removes keys and keys enumerates maps", async () => {
  const result = await runExpression('(print [(dissoc {"a": 1, "b": 2} "a") (keys {"a": 1, "b": 2, "c": 3})])');
  assertSuccessWithOutputs(result, "b", "c");
});

binaryTest("stdlib binary: groupBy groups values by computed key", async () => {
  const result = await runExpression('(print (groupBy (fn [x] (mod x 2)) [1 2 3 4 5]))');
  assertSuccessWithOutputs(result, "0", "1", "2", "3", "4", "5");
});

binaryTest("stdlib binary: merge prefers later values", async () => {
  const result = await runExpression('(get (merge {"a": 1} {"a": 99}) "a")');
  assertSuccessWithOutput(result, "99");
});
