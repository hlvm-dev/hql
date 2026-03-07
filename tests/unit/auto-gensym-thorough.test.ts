import {
  assertEquals,
  assertMatch,
  assertNotEquals,
} from "https://deno.land/std@0.208.0/assert/mod.ts";
import { macroexpand } from "../../mod.ts";
import { transpileToJavascript } from "../../src/hql/transpiler/hql-transpiler.ts";
import { resetGensymCounter } from "../../src/hql/gensym.ts";

function resetCounter() {
  resetGensymCounter();
}

Deno.test("auto-gensym: repeated references inside one template stay stable across positions", async () => {
  resetCounter();
  const [functionExpanded] = await macroexpand(`(do
    (macro call-with-temp [f]
      \`(let (tmp# 42)
         (tmp# tmp#)))
    (call-with-temp identity))`);
  const [nestedExpanded] = await macroexpand(`(do
    (macro deep-nest []
      \`(if true
         (let (x# 1)
           (do
             (print x#)
             (+ x# x#)))))
    (deep-nest))`);
  const [vectorExpanded] = await macroexpand(`(do
    (macro vec-test []
      \`[a# b# a#])
    (vec-test))`);

  const tmpMatches = functionExpanded.match(/tmp_\d+/g);
  const xMatches = nestedExpanded.match(/x_\d+/g);
  const aMatches = vectorExpanded.match(/a_\d+/g);
  const bMatches = vectorExpanded.match(/b_\d+/g);

  assertEquals(tmpMatches?.length, 3);
  assertEquals(tmpMatches?.[0], tmpMatches?.[1]);
  assertEquals(tmpMatches?.[1], tmpMatches?.[2]);
  assertEquals(new Set(xMatches).size, 1);
  assertEquals(aMatches?.length, 2);
  assertEquals(aMatches?.[0], aMatches?.[1]);
  assertNotEquals(aMatches?.[0], bMatches?.[0]);
});

Deno.test("auto-gensym: unquote escapes transformation while manual and auto gensyms coexist", async () => {
  resetCounter();
  const [unquoteExpanded] = await macroexpand(`(do
    (macro test-unquote [x#]
      \`(+ tmp# ~x#))
    (test-unquote 5))`);
  const [hybridExpanded] = await macroexpand(`(do
    (macro hybrid [val]
      (var manual (gensym "manual"))
      \`(let (~manual ~val auto# 2)
         (+ ~manual auto#)))
    (hybrid 10))`);

  assertMatch(unquoteExpanded, /tmp_\d+/);
  assertMatch(unquoteExpanded, /5/);
  assertMatch(hybridExpanded, /manual_\d+/);
  assertMatch(hybridExpanded, /auto_\d+/);
});

Deno.test("auto-gensym: real-world match-style macros and repeated calls stay isolated", async () => {
  resetCounter();
  const [matchExpanded] = await macroexpand(`(do
    (macro my-match [value & clauses]
      \`(let (val# ~value)
         (if (=== val# 1) "one"
             (if (=== val# 2) "two"
                 "other"))))
    (my-match (+ 1 1)))`);
  const [isolatedCalls] = await macroexpand(`(do
    (macro make-binding []
      \`(let (x# 1) x#))
    (do
      (make-binding)
      (make-binding)
      (make-binding)))`);

  const valMatches = matchExpanded.match(/val_\d+/g);
  const callMatches = isolatedCalls.match(/x_\d+/g) ?? [];
  const uniqueCallIds = new Set(callMatches.map((value) => value.match(/\d+/)?.[0]));

  assertEquals(new Set(valMatches).size, 1);
  assertEquals(callMatches.length, 6);
  assertEquals(uniqueCallIds.size, 3);
});

Deno.test("auto-gensym: generated prefixes support varied names and transpile to usable JS", async () => {
  resetCounter();
  const [nameExpanded] = await macroexpand(`(do
    (macro test-names []
      \`(do
         a#
         abc#
         a-b-c#
         ABC#
         _private#
         x#
         y#))
    (test-names))`);

  assertMatch(nameExpanded, /a_\d+/);
  assertMatch(nameExpanded, /abc_\d+/);
  assertMatch(nameExpanded, /a-b-c_\d+/);
  assertMatch(nameExpanded, /ABC_\d+/);
  assertMatch(nameExpanded, /_private_\d+/);
  assertMatch(nameExpanded, /x_\d+/);
  assertMatch(nameExpanded, /y_\d+/);

  const withTemp = await transpileToJavascript(`(do
    (macro with-temp [val]
      \`(let (tmp# ~val)
         (+ tmp# 1)))
    (with-temp 42))`, {});
  const swap = await transpileToJavascript(`
    (macro my-swap [a b]
      \`(let (temp# ~a)
         (= ~a ~b)
         (= ~b temp#)))
    (fn []
      (var x 1)
      (var y 2)
      (my-swap x y)
      [x y])`, {});

  assertMatch(withTemp.code, /let\s+tmp_\d+\s*=/);
  assertMatch(withTemp.code, /tmp_\d+\s*\+\s*1/);
  assertMatch(swap.code, /let\s+temp_\d+\s*=\s*x/);
  assertMatch(swap.code, /x\s*=\s*y/);
  assertMatch(swap.code, /y\s*=\s*temp_\d+/);
});
