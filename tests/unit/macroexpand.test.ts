import {
  assertEquals,
  assertMatch,
} from "https://deno.land/std@0.208.0/assert/mod.ts";
import { macroexpand } from "../../mod.ts";
import { macroexpand1 } from "../../src/hql/macroexpand.ts";

Deno.test("macroexpand expands nested macro definition", async () => {
  const source = `(do
    (macro double [x]
      \`(* 2 ~x))
    (double 5))`;

  const [expanded] = await macroexpand(source);
  assertEquals(expanded, `(do (* 2 5))`);
});

Deno.test("macroexpand1 expands outer form once", async () => {
  const [expanded] = await macroexpand1(`(unless false (print "ok"))`);
  assertEquals(expanded, `(if false nil (do (js-call console "log" "ok")))`);
});

Deno.test("cond macro expands to nested ifs", async () => {
  const [expanded] = await macroexpand(`(cond false 0 true 1)`);
  assertEquals(expanded, `(if false 0 (if true 1 nil))`);
});

Deno.test("cond macro handles else clause", async () => {
  const [expanded] = await macroexpand(`(cond false 0 (else 2))`);
  assertEquals(expanded, `(if false 0 2)`);
});

Deno.test("do macro expands sequentially", async () => {
  const [expanded] = await macroexpand(`(do (print "a") (print "b") 3)`);
  assertEquals(expanded, `(do (js-call console "log" "a") (js-call console "log" "b") 3)`);
});

Deno.test("do macro single step expansion", async () => {
  const [expanded] = await macroexpand1(`(do (print "a") 42)`);
  assertEquals(expanded, `(do (js-call console "log" "a") 42)`);
});

Deno.test("empty-array macro produces vector form", async () => {
  const [expanded] = await macroexpand(`(empty-array)`);
  assertEquals(expanded, `(vector)`);
});

Deno.test("empty-map macro produces hash-map form", async () => {
  const [expanded] = await macroexpand(`(empty-map)`);
  assertEquals(expanded, `(__hql_hash_map)`);
});

Deno.test("empty-set macro produces hash-set form", async () => {
  const [expanded] = await macroexpand(`(empty-set)`);
  assertEquals(expanded, `(hash-set)`);
});

Deno.test("macroexpand hash-map macro assigns literal keys", async () => {
  const [expanded] = await macroexpand(
    `(hash-map "host" "localhost" "port" 8080)`,
  );
  assertMatch(expanded, /__hql_hash_map/);
});

Deno.test("macroexpand hash-map macro keeps expression keys", async () => {
  const [expanded] = await macroexpand(`(hash-map key (+ 1 2))`);
  assertMatch(expanded, /__hql_hash_map/);
});

Deno.test("macroexpand throw macro expands to helper", async () => {
  const [expanded] = await macroexpand(`(throw (js-new Error "boom"))`);
  assertEquals(expanded, `(throw (js-new Error "boom"))`);
});
