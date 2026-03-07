import {
  assertEquals,
  assertMatch,
} from "https://deno.land/std@0.208.0/assert/mod.ts";
import { macroexpand } from "../../mod.ts";
import { macroexpand1 } from "../../src/hql/macroexpand.ts";

Deno.test("macroexpand: expands user macros and cond into executable core forms", async () => {
  const [nestedMacro] = await macroexpand(`(do
    (macro double [x]
      \`(* 2 ~x))
    (double 5))`);
  assertEquals(nestedMacro, `(do (* 2 5))`);

  const [condExpanded] = await macroexpand(`(cond false 0 true 1)`);
  assertEquals(condExpanded, `(if false 0 (if true 1 nil))`);

  const [condElse] = await macroexpand(`(cond false 0 (else 2))`);
  assertEquals(condElse, `(if false 0 2)`);
});

Deno.test("macroexpand: macroexpand1 only expands the outermost macro layer", async () => {
  const [unlessExpanded] = await macroexpand1(`(unless false (print "ok"))`);
  assertEquals(unlessExpanded, `(if false nil (do (js-call console "log" "ok")))`);

  const [doExpanded] = await macroexpand1(`(do (print "a") 42)`);
  assertEquals(doExpanded, `(do (js-call console "log" "a") 42)`);
});

Deno.test("macroexpand: collection helper macros normalize to canonical constructors", async () => {
  const [emptyArray] = await macroexpand(`(empty-array)`);
  const [emptyMap] = await macroexpand(`(empty-map)`);
  const [emptySet] = await macroexpand(`(empty-set)`);

  assertEquals(emptyArray, `(vector)`);
  assertEquals(emptyMap, `(__hql_hash_map)`);
  assertEquals(emptySet, `(hash-set)`);
});

Deno.test("macroexpand: hash-map accepts both literal and expression keys", async () => {
  const [literalKeys] = await macroexpand(`(hash-map "host" "localhost" "port" 8080)`);
  const [expressionKeys] = await macroexpand(`(hash-map key (+ 1 2))`);

  assertMatch(literalKeys, /__hql_hash_map/);
  assertMatch(expressionKeys, /__hql_hash_map/);
});

Deno.test("macroexpand: identity-style forms remain stable when already core syntax", async () => {
  const [expanded] = await macroexpand(`(throw (js-new Error "boom"))`);
  assertEquals(expanded, `(throw (js-new Error "boom"))`);
});
