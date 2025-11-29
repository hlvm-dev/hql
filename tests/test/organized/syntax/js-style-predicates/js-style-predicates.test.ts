// test/organized/syntax/js-style-predicates/js-style-predicates.test.ts
// Comprehensive tests for JavaScript-style type predicate macros
// These macros provide familiar JS naming while compiling to efficient inline checks

import { assertEquals } from "https://deno.land/std@0.208.0/assert/mod.ts";
import { run } from "../../../helpers.ts";

// ============================================================================
// SECTION 1: isNull - NULL CHECK
// ============================================================================

Deno.test("isNull: returns true for null", async () => {
  const result = await run(`(isNull null)`);
  assertEquals(result, true);
});

Deno.test("isNull: returns false for undefined", async () => {
  const result = await run(`(isNull undefined)`);
  assertEquals(result, false);
});

Deno.test("isNull: returns false for zero", async () => {
  const result = await run(`(isNull 0)`);
  assertEquals(result, false);
});

Deno.test("isNull: returns false for empty string", async () => {
  const result = await run(`(isNull "")`);
  assertEquals(result, false);
});

Deno.test("isNull: returns false for false", async () => {
  const result = await run(`(isNull false)`);
  assertEquals(result, false);
});

Deno.test("isNull: returns false for object", async () => {
  const result = await run(`(isNull {a: 1})`);
  assertEquals(result, false);
});

Deno.test("isNull: returns false for array", async () => {
  const result = await run(`(isNull [1 2 3])`);
  assertEquals(result, false);
});

Deno.test("isNull: works with variable", async () => {
  const result = await run(`
    (let x null)
    (isNull x)
  `);
  assertEquals(result, true);
});

// ============================================================================
// SECTION 2: isUndefined - UNDEFINED CHECK
// ============================================================================

Deno.test("isUndefined: returns true for undefined", async () => {
  const result = await run(`(isUndefined undefined)`);
  assertEquals(result, true);
});

Deno.test("isUndefined: returns false for null", async () => {
  const result = await run(`(isUndefined null)`);
  assertEquals(result, false);
});

Deno.test("isUndefined: returns false for zero", async () => {
  const result = await run(`(isUndefined 0)`);
  assertEquals(result, false);
});

Deno.test("isUndefined: returns false for empty string", async () => {
  const result = await run(`(isUndefined "")`);
  assertEquals(result, false);
});

Deno.test("isUndefined: returns false for false", async () => {
  const result = await run(`(isUndefined false)`);
  assertEquals(result, false);
});

Deno.test("isUndefined: works with variable", async () => {
  const result = await run(`
    (let x undefined)
    (isUndefined x)
  `);
  assertEquals(result, true);
});

// ============================================================================
// SECTION 3: isNil - NULL OR UNDEFINED CHECK
// ============================================================================

Deno.test("isNil: returns true for null", async () => {
  const result = await run(`(isNil null)`);
  assertEquals(result, true);
});

Deno.test("isNil: returns true for undefined", async () => {
  const result = await run(`(isNil undefined)`);
  assertEquals(result, true);
});

Deno.test("isNil: returns false for zero", async () => {
  const result = await run(`(isNil 0)`);
  assertEquals(result, false);
});

Deno.test("isNil: returns false for empty string", async () => {
  const result = await run(`(isNil "")`);
  assertEquals(result, false);
});

Deno.test("isNil: returns false for false", async () => {
  const result = await run(`(isNil false)`);
  assertEquals(result, false);
});

Deno.test("isNil: returns false for object", async () => {
  const result = await run(`(isNil {a: 1})`);
  assertEquals(result, false);
});

Deno.test("isNil: returns false for array", async () => {
  const result = await run(`(isNil [1 2 3])`);
  assertEquals(result, false);
});

// ============================================================================
// SECTION 4: isDefined - NOT UNDEFINED CHECK
// ============================================================================

Deno.test("isDefined: returns false for undefined", async () => {
  const result = await run(`(isDefined undefined)`);
  assertEquals(result, false);
});

Deno.test("isDefined: returns true for null", async () => {
  const result = await run(`(isDefined null)`);
  assertEquals(result, true);
});

Deno.test("isDefined: returns true for zero", async () => {
  const result = await run(`(isDefined 0)`);
  assertEquals(result, true);
});

Deno.test("isDefined: returns true for empty string", async () => {
  const result = await run(`(isDefined "")`);
  assertEquals(result, true);
});

Deno.test("isDefined: returns true for false", async () => {
  const result = await run(`(isDefined false)`);
  assertEquals(result, true);
});

Deno.test("isDefined: returns true for object", async () => {
  const result = await run(`(isDefined {a: 1})`);
  assertEquals(result, true);
});

// ============================================================================
// SECTION 5: notNil - NOT NULL AND NOT UNDEFINED CHECK
// ============================================================================

Deno.test("notNil: returns false for null", async () => {
  const result = await run(`(notNil null)`);
  assertEquals(result, false);
});

Deno.test("notNil: returns false for undefined", async () => {
  const result = await run(`(notNil undefined)`);
  assertEquals(result, false);
});

Deno.test("notNil: returns true for zero", async () => {
  const result = await run(`(notNil 0)`);
  assertEquals(result, true);
});

Deno.test("notNil: returns true for empty string", async () => {
  const result = await run(`(notNil "")`);
  assertEquals(result, true);
});

Deno.test("notNil: returns true for false", async () => {
  const result = await run(`(notNil false)`);
  assertEquals(result, true);
});

Deno.test("notNil: returns true for object", async () => {
  const result = await run(`(notNil {a: 1})`);
  assertEquals(result, true);
});

Deno.test("notNil: returns true for array", async () => {
  const result = await run(`(notNil [1 2 3])`);
  assertEquals(result, true);
});

// ============================================================================
// SECTION 6: isString - STRING TYPE CHECK
// ============================================================================

Deno.test("isString: returns true for string literal", async () => {
  const result = await run(`(isString "hello")`);
  assertEquals(result, true);
});

Deno.test("isString: returns true for empty string", async () => {
  const result = await run(`(isString "")`);
  assertEquals(result, true);
});

Deno.test("isString: returns false for number", async () => {
  const result = await run(`(isString 42)`);
  assertEquals(result, false);
});

Deno.test("isString: returns false for boolean", async () => {
  const result = await run(`(isString true)`);
  assertEquals(result, false);
});

Deno.test("isString: returns false for null", async () => {
  const result = await run(`(isString null)`);
  assertEquals(result, false);
});

Deno.test("isString: returns false for undefined", async () => {
  const result = await run(`(isString undefined)`);
  assertEquals(result, false);
});

Deno.test("isString: returns false for array", async () => {
  const result = await run(`(isString [1 2 3])`);
  assertEquals(result, false);
});

Deno.test("isString: returns false for object", async () => {
  const result = await run(`(isString {a: 1})`);
  assertEquals(result, false);
});

// ============================================================================
// SECTION 7: isNumber - NUMBER TYPE CHECK
// ============================================================================

Deno.test("isNumber: returns true for integer", async () => {
  const result = await run(`(isNumber 42)`);
  assertEquals(result, true);
});

Deno.test("isNumber: returns true for float", async () => {
  const result = await run(`(isNumber 3.14)`);
  assertEquals(result, true);
});

Deno.test("isNumber: returns true for zero", async () => {
  const result = await run(`(isNumber 0)`);
  assertEquals(result, true);
});

Deno.test("isNumber: returns true for negative", async () => {
  const result = await run(`(isNumber -5)`);
  assertEquals(result, true);
});

Deno.test("isNumber: returns false for string", async () => {
  const result = await run(`(isNumber "42")`);
  assertEquals(result, false);
});

Deno.test("isNumber: returns false for boolean", async () => {
  const result = await run(`(isNumber true)`);
  assertEquals(result, false);
});

Deno.test("isNumber: returns false for null", async () => {
  const result = await run(`(isNumber null)`);
  assertEquals(result, false);
});

Deno.test("isNumber: returns false for undefined", async () => {
  const result = await run(`(isNumber undefined)`);
  assertEquals(result, false);
});

Deno.test("isNumber: returns false for array", async () => {
  const result = await run(`(isNumber [1 2 3])`);
  assertEquals(result, false);
});

Deno.test("isNumber: returns false for object", async () => {
  const result = await run(`(isNumber {a: 1})`);
  assertEquals(result, false);
});

// ============================================================================
// SECTION 8: isBoolean - BOOLEAN TYPE CHECK
// ============================================================================

Deno.test("isBoolean: returns true for true", async () => {
  const result = await run(`(isBoolean true)`);
  assertEquals(result, true);
});

Deno.test("isBoolean: returns true for false", async () => {
  const result = await run(`(isBoolean false)`);
  assertEquals(result, true);
});

Deno.test("isBoolean: returns false for number", async () => {
  const result = await run(`(isBoolean 1)`);
  assertEquals(result, false);
});

Deno.test("isBoolean: returns false for string", async () => {
  const result = await run(`(isBoolean "true")`);
  assertEquals(result, false);
});

Deno.test("isBoolean: returns false for null", async () => {
  const result = await run(`(isBoolean null)`);
  assertEquals(result, false);
});

Deno.test("isBoolean: returns false for undefined", async () => {
  const result = await run(`(isBoolean undefined)`);
  assertEquals(result, false);
});

// ============================================================================
// SECTION 9: isFunction - FUNCTION TYPE CHECK
// ============================================================================

Deno.test("isFunction: returns true for function", async () => {
  const result = await run(`
    (fn add [a b] (+ a b))
    (isFunction add)
  `);
  assertEquals(result, true);
});

Deno.test("isFunction: returns true for lambda", async () => {
  const result = await run(`(isFunction (fn [x] x))`);
  assertEquals(result, true);
});

Deno.test("isFunction: returns false for number", async () => {
  const result = await run(`(isFunction 42)`);
  assertEquals(result, false);
});

Deno.test("isFunction: returns false for string", async () => {
  const result = await run(`(isFunction "hello")`);
  assertEquals(result, false);
});

Deno.test("isFunction: returns false for array", async () => {
  const result = await run(`(isFunction [1 2 3])`);
  assertEquals(result, false);
});

Deno.test("isFunction: returns false for object", async () => {
  const result = await run(`(isFunction {a: 1})`);
  assertEquals(result, false);
});

Deno.test("isFunction: returns false for null", async () => {
  const result = await run(`(isFunction null)`);
  assertEquals(result, false);
});

// ============================================================================
// SECTION 10: isSymbol - SYMBOL TYPE CHECK
// ============================================================================

Deno.test("isSymbol: returns false for string", async () => {
  const result = await run(`(isSymbol "hello")`);
  assertEquals(result, false);
});

Deno.test("isSymbol: returns false for number", async () => {
  const result = await run(`(isSymbol 42)`);
  assertEquals(result, false);
});

Deno.test("isSymbol: returns false for object", async () => {
  const result = await run(`(isSymbol {a: 1})`);
  assertEquals(result, false);
});

// ============================================================================
// SECTION 11: isArray - ARRAY TYPE CHECK
// ============================================================================

Deno.test("isArray: returns true for array literal", async () => {
  const result = await run(`(isArray [1 2 3])`);
  assertEquals(result, true);
});

Deno.test("isArray: returns true for empty array", async () => {
  const result = await run(`(isArray [])`);
  assertEquals(result, true);
});

Deno.test("isArray: returns true for nested array", async () => {
  const result = await run(`(isArray [[1] [2] [3]])`);
  assertEquals(result, true);
});

Deno.test("isArray: returns false for object", async () => {
  const result = await run(`(isArray {a: 1})`);
  assertEquals(result, false);
});

Deno.test("isArray: returns false for string", async () => {
  const result = await run(`(isArray "hello")`);
  assertEquals(result, false);
});

Deno.test("isArray: returns false for number", async () => {
  const result = await run(`(isArray 42)`);
  assertEquals(result, false);
});

Deno.test("isArray: returns false for null", async () => {
  const result = await run(`(isArray null)`);
  assertEquals(result, false);
});

Deno.test("isArray: returns false for undefined", async () => {
  const result = await run(`(isArray undefined)`);
  assertEquals(result, false);
});

// ============================================================================
// SECTION 12: isObject - OBJECT TYPE CHECK (not null, not array)
// ============================================================================

Deno.test("isObject: returns true for object literal", async () => {
  const result = await run(`(isObject {a: 1})`);
  assertEquals(result, true);
});

Deno.test("isObject: returns true for empty object", async () => {
  const result = await run(`(isObject {})`);
  assertEquals(result, true);
});

Deno.test("isObject: returns true for nested object", async () => {
  const result = await run(`(isObject {a: {b: 1}})`);
  assertEquals(result, true);
});

Deno.test("isObject: returns false for array (important!)", async () => {
  const result = await run(`(isObject [1 2 3])`);
  assertEquals(result, false);
});

Deno.test("isObject: returns false for null (important!)", async () => {
  const result = await run(`(isObject null)`);
  assertEquals(result, false);
});

Deno.test("isObject: returns false for string", async () => {
  const result = await run(`(isObject "hello")`);
  assertEquals(result, false);
});

Deno.test("isObject: returns false for number", async () => {
  const result = await run(`(isObject 42)`);
  assertEquals(result, false);
});

Deno.test("isObject: returns false for function", async () => {
  const result = await run(`(isObject (fn [x] x))`);
  assertEquals(result, false);
});

Deno.test("isObject: returns false for undefined", async () => {
  const result = await run(`(isObject undefined)`);
  assertEquals(result, false);
});

// ============================================================================
// SECTION 13: ifLet - CAMELCASE ALIAS FOR if-let
// ============================================================================
// Note: if-let/ifLet bindings use parentheses (x value), not square brackets [x value]

Deno.test("ifLet: basic truthy binding", async () => {
  const result = await run(`
    (ifLet (x 5) x 0)
  `);
  assertEquals(result, 5);
});

Deno.test("ifLet: basic falsy binding with function", async () => {
  // Note: Using function call due to transpiler quirk with direct null values
  const result = await run(`
    (fn getNull [] null)
    (ifLet (x (getNull)) x "default")
  `);
  assertEquals(result, "default");
});

Deno.test("ifLet: with function call", async () => {
  const result = await run(`
    (fn getValue [] 42)
    (ifLet (x (getValue)) (+ x 1) 0)
  `);
  assertEquals(result, 43);
});

Deno.test("ifLet: with null function return", async () => {
  const result = await run(`
    (fn getValue [] null)
    (ifLet (x (getValue)) x "no value")
  `);
  assertEquals(result, "no value");
});

Deno.test("ifLet: with object property access", async () => {
  const result = await run(`
    (let obj {name: "Alice"})
    (ifLet (name (get obj "name")) name "unknown")
  `);
  assertEquals(result, "Alice");
});

Deno.test("ifLet: with missing object property", async () => {
  const result = await run(`
    (let obj {})
    (ifLet (name (get obj "name")) name "unknown")
  `);
  assertEquals(result, "unknown");
});

// ============================================================================
// SECTION 14: whenLet - CAMELCASE ALIAS FOR when-let
// ============================================================================
// Note: when-let/whenLet bindings use parentheses (x value), not square brackets [x value]

Deno.test("whenLet: executes body when truthy", async () => {
  const result = await run(`
    (whenLet (x 5) (+ x 10))
  `);
  assertEquals(result, 15);
});

Deno.test("whenLet: returns null when falsy", async () => {
  // Note: Using function call due to transpiler quirk with direct null values
  const result = await run(`
    (fn getNull [] null)
    (whenLet (x (getNull)) (+ x 10))
  `);
  assertEquals(result, null);
});

Deno.test("whenLet: with function call", async () => {
  const result = await run(`
    (fn getData [] [1 2 3])
    (whenLet (data (getData)) (get data 0))
  `);
  assertEquals(result, 1);
});

Deno.test("whenLet: with multiple body expressions", async () => {
  const result = await run(`
    (var sum 0)
    (whenLet (x 5)
      (= sum (+ sum x))
      (= sum (+ sum 10))
      sum)
  `);
  assertEquals(result, 15);
});

// ============================================================================
// SECTION 15: PRACTICAL USE CASES
// ============================================================================

Deno.test("Practical: input validation with isNil", async () => {
  const result = await run(`
    (fn validateInput [x]
      (if (isNil x)
        "invalid"
        "valid"))
    [(validateInput null) (validateInput undefined) (validateInput 0)]
  `);
  assertEquals(result, ["invalid", "invalid", "valid"]);
});

Deno.test("Practical: type-safe processing with isArray", async () => {
  const result = await run(`
    (fn process [data]
      (if (isArray data)
        (get data "length")
        1))
    [(process [1 2 3]) (process "single")]
  `);
  assertEquals(result, [3, 1]);
});

Deno.test("Practical: safe property access with ifLet", async () => {
  const result = await run(`
    (fn getUserName [user]
      (ifLet (name (get user "name"))
        name
        "anonymous"))
    [(getUserName {name: "Alice"}) (getUserName {})]
  `);
  assertEquals(result, ["Alice", "anonymous"]);
});

Deno.test("Practical: object validation with isObject", async () => {
  const result = await run(`
    (fn isValidConfig [config]
      (and (isObject config)
           (notNil (get config "host"))
           (isNumber (get config "port"))))
    [(isValidConfig {host: "localhost", port: 8080})
     (isValidConfig {host: "localhost"})
     (isValidConfig [1 2 3])
     (isValidConfig null)]
  `);
  assertEquals(result, [true, false, false, false]);
});

Deno.test("Practical: type checking chain", async () => {
  const result = await run(`
    (fn getType [x]
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
    [(getType null) (getType undefined) (getType [1]) (getType {a: 1})
     (getType "hi") (getType 42) (getType true) (getType (fn [] 1))]
  `);
  assertEquals(result, ["null", "undefined", "array", "object", "string", "number", "boolean", "function"]);
});

// ============================================================================
// SECTION 16: EDGE CASES AND INTEGRATION
// ============================================================================

Deno.test("Edge: isNil with short-circuit evaluation", async () => {
  const result = await run(`
    (fn safeDivide [a b]
      (if (or (isNil a) (isNil b) (=== b 0))
        null
        (/ a b)))
    [(safeDivide 10 2) (safeDivide 10 0) (safeDivide null 2) (safeDivide 10 null)]
  `);
  assertEquals(result, [5, null, null, null]);
});

Deno.test("Edge: nested ifLet", async () => {
  const result = await run(`
    (let obj {user: {profile: {name: "Alice"}}})
    (ifLet (user (get obj "user"))
      (ifLet (profile (get user "profile"))
        (ifLet (name (get profile "name"))
          name
          "no name")
        "no profile")
      "no user")
  `);
  assertEquals(result, "Alice");
});

Deno.test("Edge: isObject excludes array and null correctly", async () => {
  const result = await run(`
    [
      (isObject {})
      (isObject {a: 1})
      (isObject [])
      (isObject [1 2])
      (isObject null)
    ]
  `);
  assertEquals(result, [true, true, false, false, false]);
});

Deno.test("Edge: combining predicates", async () => {
  const result = await run(`
    (fn isNonEmptyString [x]
      (and (isString x) (> (get x "length") 0)))
    [(isNonEmptyString "hello") (isNonEmptyString "") (isNonEmptyString 123)]
  `);
  assertEquals(result, [true, false, false]);
});
