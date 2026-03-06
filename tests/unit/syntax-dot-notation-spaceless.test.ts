import { assertEquals } from "jsr:@std/assert";
import hql from "../../mod.ts";
import { run } from "./helpers.ts";

async function assertEquivalent(
  spaceless: string,
  spaced: string,
  label: string,
): Promise<void> {
  const spacelessJS = await hql.transpile(spaceless);
  const spacedJS = await hql.transpile(spaced);
  const spacelessCode = typeof spacelessJS === "string" ? spacelessJS : spacelessJS.code;
  const spacedCode = typeof spacedJS === "string" ? spacedJS : spacedJS.code;

  assertEquals(spacelessCode, spacedCode, `${label}: transpiled JS should match`);
  assertEquals(await run(spaceless), await run(spaced), `${label}: runtime should match`);
}

Deno.test("DotNotation: spaceless and spaced method chains stay equivalent", async () => {
  await assertEquivalent(
    '(var text "  hello  ") (text.trim.toUpperCase)',
    '(var text "  hello  ") (text .trim .toUpperCase)',
    "no-arg chain",
  );
  await assertEquivalent(
    '(var arr [1 2 3 4 5]) (arr.map (fn [x] (* x 2)).filter (fn [x] (> x 5)))',
    '(var arr [1 2 3 4 5]) (arr .map (fn [x] (* x 2)) .filter (fn [x] (> x 5)))',
    "arg chain",
  );
});

Deno.test("DotNotation: spaceless chains support real string and array pipelines", async () => {
  const stringResult = await run('(var text "  hello world  ") (text.trim.toUpperCase.split " ")');
  const arrayResult = await run('(var arr [1 2 3 4 5 6]) (arr.filter (fn [x] (> x 3)).map (fn [x] (* x 2)))');

  assertEquals(stringResult, ["HELLO", "WORLD"]);
  assertEquals(arrayResult, [8, 10, 12]);
});

Deno.test("DotNotation: parser keeps js prefixes, decimal literals, and dotted argument access unambiguous", async () => {
  const prefixResult = await run('(js/Math.max 1 5 3)');
  const decimalResult = await run('(+ 42.5 10)');
  const propertyArgResult = await run('(var users [{"name": "Alice"} {"name": "Bob"}]) (users.map (fn [u] u.name))');

  assertEquals(prefixResult, 5);
  assertEquals(decimalResult, 52.5);
  assertEquals(propertyArgResult, ["Alice", "Bob"]);
});

Deno.test("DotNotation: prefix-dot syntax and property access regressions remain stable", async () => {
  const prefixDot = await run('(var arr [1 2 3]) (.push arr 99) arr');
  const propertyAccess = await run('(var obj {"items": [1 2 3]}) (obj.items.length)');
  const bareProperty = await run('(var arr [1 2 3]) arr.length');

  assertEquals(prefixDot, [1, 2, 3, 99]);
  assertEquals(propertyAccess, 3);
  assertEquals(bareProperty, 3);
});

Deno.test("DotNotation: consecutive dots normalize and multiline spaced chains still work", async () => {
  const normalized = await run('(var textValue "test") (textValue..toUpperCase)');
  const multiline = await run(`
    (var arr [1 2 3 4 5 6 7 8 9 10])
    (arr
      .filter (fn [x] (=== (% x 2) 0))
      .map (fn [x] (* x 2))
      .slice 0 3)
  `);

  assertEquals(normalized, "TEST");
  assertEquals(multiline, [4, 8, 12]);
});

Deno.test("DotNotation: real-world spaceless pipelines compose multiple collection operations", async () => {
  const result = await run(`
    (var data [1 2 3 4 5 6 7 8 9 10])
    (data
      .filter (fn [x] (> x 3))
      .map (fn [x] (* x 2))
      .slice 0 5
      .reduce (fn [acc val] (+ acc val)) 0)
  `);

  assertEquals(result, 60);
});
