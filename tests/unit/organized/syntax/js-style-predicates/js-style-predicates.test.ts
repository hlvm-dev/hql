import { assertEquals } from "jsr:@std/assert";
import { run } from "../../../helpers.ts";

Deno.test("JS-style predicates: nullish predicates distinguish null, undefined, and defined values", async () => {
  const result = await run(`
    [
      (isNull null)
      (isNull undefined)
      (isUndefined undefined)
      (isUndefined null)
      (isNil null)
      (isNil undefined)
      (isDefined undefined)
      (isDefined 0)
      (notNil null)
      (notNil false)
    ]
  `);

  assertEquals(result, [true, false, true, false, true, true, false, true, false, true]);
});

Deno.test("JS-style predicates: primitive and structural predicates classify representative values", async () => {
  const result = await run(`
    (let [text "hello"
          num 3.14
          flag false
          arr [1 2 3]
          obj {a: 1}
          noop (fn [] 1)]
      [
        (isString text)
        (isString num)
        (isNumber num)
        (isNumber text)
        (isBoolean flag)
        (isBoolean null)
        (isFunction noop)
        (isFunction obj)
        (isArray arr)
        (isArray obj)
        (isObject obj)
        (isObject arr)
        (isObject null)
        (isSymbol text)
      ])
  `);

  assertEquals(result, [true, false, true, false, true, false, true, false, true, false, true, false, false, false]);
});

Deno.test("JS-style predicates: ifLet returns the bound value or fallback", async () => {
  const literalHit = await run(`
    (fn getNull [] null)
    (ifLet [x 5] x 0)
  `);
  const nullMiss = await run(`
    (fn getNull [] null)
    (ifLet [x (getNull)] x "default")
  `);
  const objectHit = await run(`
    (var obj {name: "Alice"})
    (ifLet [name (get obj "name")] name "unknown")
  `);
  const objectMiss = await run(`
    (var obj {})
    (ifLet [name (get obj "name")] name "unknown")
  `);

  assertEquals(literalHit, 5);
  assertEquals(nullMiss, "default");
  assertEquals(objectHit, "Alice");
  assertEquals(objectMiss, "unknown");
});

Deno.test("JS-style predicates: whenLet only runs for truthy bindings and returns the last body form", async () => {
  const result = await run(`
    (fn getNull [] null)
    (var sum 0)
    [
      (whenLet [x 5]
        (= sum (+ sum x))
        (= sum (+ sum 10))
        sum)
      (whenLet [x (getNull)]
        42)
      sum
    ]
  `);

  assertEquals(result, [15, null, 15]);
});

Deno.test("JS-style predicates: validation helpers combine correctly in practical flows", async () => {
  const result = await run(`
    (fn validateInput [x]
      (if (isNil x) "invalid" "valid"))

    (fn process [data]
      (if (isArray data)
        (get data "length")
        1))

    (fn isValidConfig [config]
      (and (isObject config)
           (notNil (get config "host"))
           (isNumber (get config "port"))))

    [
      (validateInput null)
      (validateInput 0)
      (process [1 2 3])
      (process "single")
      (isValidConfig {host: "localhost", port: 8080})
      (isValidConfig {host: "localhost"})
      (isValidConfig [1 2 3])
    ]
  `);

  assertEquals(result, ["invalid", "valid", 3, 1, true, false, false]);
});

Deno.test("JS-style predicates: combined type chains remain stable and short-circuit safely", async () => {
  const result = await run(`
    (fn classify [x]
      (cond
        ((isNull x) "null")
        ((isUndefined x) "undefined")
        ((isArray x) "array")
        ((isObject x) "object")
        ((isString x) "string")
        ((isNumber x) "number")
        ((isBoolean x) "boolean")
        ((isFunction x) "function")
        (else "unknown")))

    (fn safeDivide [a b]
      (if (or (isNil a) (isNil b) (=== b 0))
        null
        (/ a b)))

    [
      (classify null)
      (classify undefined)
      (classify [1])
      (classify {a: 1})
      (classify "hi")
      (classify 42)
      (classify true)
      (classify (fn [] 1))
      (safeDivide 10 2)
      (safeDivide 10 0)
      (safeDivide null 2)
    ]
  `);

  assertEquals(result, ["null", "undefined", "array", "object", "string", "number", "boolean", "function", 5, null, null]);
});
