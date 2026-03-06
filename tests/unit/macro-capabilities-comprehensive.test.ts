import { assertEquals } from "jsr:@std/assert";
import hql from "../../mod.ts";

async function expectMacroResult(code: string, expected: unknown): Promise<void> {
  const result = await hql.run(code);
  assertEquals(result, expected);
}

Deno.test("Macro integration: basic macro definition with multiple parameters works", async () => {
  await expectMacroResult(`
    (macro add3 [a b c] (+ a b c))
    (add3 1 2 3)
  `, 6);
});

Deno.test("Macro integration: quasiquote and unquote can generate callable functions", async () => {
  await expectMacroResult(`
    (macro make-adder [n]
      \`(fn [x] (+ x ~n)))
    (let add10 (make-adder 10))
    (add10 5)
  `, 15);
});

Deno.test("Macro integration: unquote-splicing expands rest arguments", async () => {
  await expectMacroResult(`
    (macro my-vec [& items]
      \`(vector ~@items))
    (my-vec "a" "b" "c")
  `, ["a", "b", "c"]);
});

Deno.test("Macro integration: stdlib functions are usable at macro time", async () => {
  await expectMacroResult(`
    (macro filter-positive [& nums]
      \`(doall (filter (fn [x] (> x 2)) (list ~@nums))))
    (filter-positive 1 2 3 4 5)
  `, [3, 4, 5]);
});

Deno.test("Macro integration: user-defined functions are callable in macro bodies", async () => {
  await expectMacroResult(`
    (fn helper-calc [a b] (* a (+ b 1)))
    (macro use-helper [x]
      (helper-calc x 2))
    (use-helper 5)
  `, 15);
});

Deno.test("Macro integration: conditional logic in macro bodies evaluates at expansion time", async () => {
  await expectMacroResult(`
    (macro classify [n]
      (cond
        ((< n 0) "negative")
        ((=== n 0) "zero")
        (true "positive")))
    [(classify -5) (classify 0) (classify 10)]
  `, ["negative", "zero", "positive"]);
});

Deno.test("Macro integration: macros can generate other macros", async () => {
  await expectMacroResult(`
    (macro def-multiplier [name factor]
      \`(macro ~name [x] (* x ~factor)))
    (def-multiplier triple 3)
    (def-multiplier quadruple 4)
    [(triple 5) (quadruple 5)]
  `, [15, 20]);
});

Deno.test("Macro integration: nested quasiquote can build higher-order function factories", async () => {
  await expectMacroResult(`
    (macro make-fn-factory [op]
      \`(fn [n]
         (fn [x]
           (~op x n))))
    (let make-adder-fn (make-fn-factory +))
    (let add7 (make-adder-fn 7))
    (add7 3)
  `, 10);
});

Deno.test("Macro integration: macro-generated closures capture runtime values correctly", async () => {
  await expectMacroResult(`
    (macro make-multiplier [factor]
      \`(fn [x] (* x ~factor)))
    (let times5 (make-multiplier 5))
    (times5 7)
  `, 35);
});
