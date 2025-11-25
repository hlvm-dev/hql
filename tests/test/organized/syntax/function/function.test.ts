// test/organized/syntax/function/function.test.ts
// Comprehensive tests for functions: basic, parameters, returns, validation, syntax flexibility
// Total: 67 tests (51 original + 16 syntax flexibility tests)
// Consolidates: syntax-function.test.ts, syntax-function-params.test.ts, syntax-return.test.ts
// New: Section 9 tests both Lisp-style and JSON-style syntax variations

import { assertEquals, assertRejects } from "jsr:@std/assert@1";
import { run } from "../../../helpers.ts";

// ============================================================================
// SECTION 1: BASIC FUNCTIONS (15 tests)
// ============================================================================

Deno.test("Function: simple fn definition", async () => {
  const code = `
(fn add [a b]
  (+ a b))
(add 3 5)
`;
  const result = await run(code);
  assertEquals(result, 8);
});

Deno.test("Function: fn with single parameter", async () => {
  const code = `
(fn square [x]
  (* x x))
(square 5)
`;
  const result = await run(code);
  assertEquals(result, 25);
});

Deno.test("Function: fn with no parameters", async () => {
  const code = `
(fn get-value []
  42)
(get-value)
`;
  const result = await run(code);
  assertEquals(result, 42);
});

Deno.test("Function: fn with multiple parameters", async () => {
  const code = `
(fn add [a b]
  (+ a b))
(add 10 20)
`;
  const result = await run(code);
  assertEquals(result, 30);
});

Deno.test("Function: anonymous fn expression", async () => {
  const code = `
(let square (fn (x) (* x x)))
(square 6)
`;
  const result = await run(code);
  assertEquals(result, 36);
});

Deno.test("Function: anonymous fn with parameters", async () => {
  const code = `
(let add (fn (a b) (+ a b)))
(add 7 8)
`;
  const result = await run(code);
  assertEquals(result, 15);
});

Deno.test("Function: nested function calls", async () => {
  const code = `
(fn add [a b] (+ a b))
(fn multiply [a b] (* a b))
(multiply (add 2 3) (add 4 5))
`;
  const result = await run(code);
  assertEquals(result, 45);
});

Deno.test("Function: function returning function", async () => {
  const code = `
(fn make-adder [n]
  (fn (x) (+ x n)))
(let add5 (make-adder 5))
(add5 10)
`;
  const result = await run(code);
  assertEquals(result, 15);
});

Deno.test("Function: recursive function", async () => {
  const code = `
(fn factorial [n]
  (if (<= n 1)
    1
    (* n (factorial (- n 1)))))
(factorial 5)
`;
  const result = await run(code);
  assertEquals(result, 120);
});

Deno.test("Function: function with multiple expressions", async () => {
  const code = `
(fn process [x]
  (var result (* x 2))
  (= result (+ result 1))
  result)
(process 5)
`;
  const result = await run(code);
  assertEquals(result, 11);
});

Deno.test("Function: function as argument", async () => {
  const code = `
(fn apply-twice [f x]
  (f (f x)))
(fn add-one [n] (+ n 1))
(apply-twice add-one 5)
`;
  const result = await run(code);
  assertEquals(result, 7);
});

Deno.test("Function: arrow function syntax", async () => {
  const code = `
(var nums [1, 2, 3, 4, 5])
(nums.map (fn (n) (* n 2)))
`;
  const result = await run(code);
  assertEquals(result, [2, 4, 6, 8, 10]);
});

Deno.test("Function: function with default behavior", async () => {
  const code = `
(fn greet [name]
  (str "Hello, " name "!"))
(greet "World")
`;
  const result = await run(code);
  assertEquals(result, "Hello, World!");
});

Deno.test("Function: immediately invoked function", async () => {
  const code = `
((fn (x) (* x x)) 7)
`;
  const result = await run(code);
  assertEquals(result, 49);
});

Deno.test("Function: closure capturing variable", async () => {
  const code = `
(let x 10)
(fn add-x [n]
  (+ n x))
(add-x 5)
`;
  const result = await run(code);
  assertEquals(result, 15);
});

// ============================================================================
// SECTION 2: DEFAULT PARAMETERS (6 tests)
// ============================================================================

Deno.test("Function: default params - both defaults used", async () => {
  const code = `
(fn multiply [x = 10 y = 20]
  (* x y))

(multiply)
`;
  const result = await run(code);
  assertEquals(result, 200);
});

Deno.test("Function: default params - override first param", async () => {
  const code = `
(fn multiply [x = 10 y = 20]
  (* x y))

(multiply 5)
`;
  const result = await run(code);
  assertEquals(result, 100);
});

Deno.test("Function: default params - override second param with placeholder", async () => {
  const code = `
(fn multiply [x = 10 y = 20]
  (* x y))

(multiply _ 7)
`;
  const result = await run(code);
  assertEquals(result, 70);
});

Deno.test("Function: default params - override both params", async () => {
  const code = `
(fn multiply [x = 10 y = 20]
  (* x y))

(multiply 3 4)
`;
  const result = await run(code);
  assertEquals(result, 12);
});

Deno.test("Function: default params - single param with default", async () => {
  const code = `
(fn greet [name = "World"]
  (+ "Hello, " name "!"))

(greet)
`;
  const result = await run(code);
  assertEquals(result, "Hello, World!");
});

Deno.test("Function: default params - single param override", async () => {
  const code = `
(fn greet [name = "World"]
  (+ "Hello, " name "!"))

(greet "Alice")
`;
  const result = await run(code);
  assertEquals(result, "Hello, Alice!");
});

// ============================================================================
// SECTION 3: REST PARAMETERS (4 tests)
// ============================================================================

Deno.test("Function: rest params - basic rest only", async () => {
  const code = `
(fn sum [& rest]
  (.reduce rest (fn (acc val) (+ acc val)) 0))

(sum 1 2 3 4 5)
`;
  const result = await run(code);
  assertEquals(result, 15);
});

Deno.test("Function: rest params - with regular params", async () => {
  const code = `
(fn sum [x y & rest]
  (+ x y (.reduce rest (fn (acc val) (+ acc val)) 0)))

(sum 10 20 1 2 3)
`;
  const result = await run(code);
  assertEquals(result, 36);
});

Deno.test("Function: rest params - empty rest array", async () => {
  const code = `
(fn sum [x y & rest]
  (+ x y (.reduce rest (fn (acc val) (+ acc val)) 0)))

(sum 10 20)
`;
  const result = await run(code);
  assertEquals(result, 30);
});

Deno.test("Function: rest params - accessing rest length", async () => {
  const code = `
(fn count-extras [x & rest]
  rest.length)

(count-extras 10 1 2 3)
`;
  const result = await run(code);
  assertEquals(result, 3);
});

// ============================================================================
// SECTION 4: JSON MAP PARAMETERS (6 tests)
// ============================================================================

Deno.test("Function: JSON map params - basic definition", async () => {
  const code = `
(fn configure {"host": "localhost", "port": 8080, "timeout": 30}
  (+ host ":" port))

(configure)
`;
  const result = await run(code);
  assertEquals(result, "localhost:8080");
});

Deno.test("Function: JSON map params - all defaults used", async () => {
  const code = `
(fn greet {"name": "World", "greeting": "Hello"}
  (+ greeting ", " name "!"))

(greet)
`;
  const result = await run(code);
  assertEquals(result, "Hello, World!");
});

Deno.test("Function: JSON map params - some values provided", async () => {
  const code = `
(fn calculate {"x": 10, "y": 20, "z": 30}
  (+ x y z))

(calculate {"x": 5, "y": 15, "z": 25})
`;
  const result = await run(code);
  assertEquals(result, 45);
});

Deno.test("Function: JSON map params - override specific keys", async () => {
  const code = `
(fn connect {"host": "localhost", "port": 8080, "ssl": false}
  (if ssl
    (+ "https://" host ":" port)
    (+ "http://" host ":" port)))

(connect {"ssl": true, "port": 443, "host": "example.com"})
`;
  const result = await run(code);
  assertEquals(result, "https://example.com:443");
});

Deno.test("Function: JSON map params - works with computed access", async () => {
  const code = `
(fn config {"host": "localhost", "port": 8080}
  (var result (+ host ":" port))
  result)

(config {"port": 3000})
`;
  const result = await run(code);
  assertEquals(result, "localhost:3000");
});

Deno.test("Function: JSON map params - nested map values", async () => {
  const code = `
(fn handle-data {"data": {"nested": "value"}}
  data)

(handle-data)
`;
  const result = await run(code);
  assertEquals(typeof result, "object");
});

// ============================================================================
// SECTION 5: PLACEHOLDERS (2 tests)
// ============================================================================

Deno.test("Function: placeholder - multiple placeholders", async () => {
  const code = `
(fn calc [a = 1 b = 2 c = 3 d = 4]
  (+ a b c d))

(calc _ _ 30 _)
`;
  const result = await run(code);
  // a=1 (default), b=2 (default), c=30 (provided), d=4 (default)
  assertEquals(result, 37);
});

Deno.test("Function: placeholder - all placeholders", async () => {
  const code = `
(fn sum [x = 5 y = 10 z = 15]
  (+ x y z))

(sum _ _ _)
`;
  const result = await run(code);
  // All params use defaults: x=5, y=10, z=15
  assertEquals(result, 30);
});

// ============================================================================
// SECTION 6: COMPREHENSIVE (1 test)
// ============================================================================

Deno.test("Function: comprehensive - defaults + rest", async () => {
  const code = `
(fn calculate [base = 100 multiplier = 2 & rest]
  (+ (* base multiplier) (.reduce rest (fn (acc val) (+ acc val)) 0)))

(calculate 10 5 1 2 3)
`;
  const result = await run(code);
  // (10 * 5) + (1 + 2 + 3) = 50 + 6 = 56
  assertEquals(result, 56);
});

// ============================================================================
// SECTION 7: RETURN STATEMENTS (15 tests)
// ============================================================================

Deno.test("Return: implicit return from function", async () => {
  const code = `
(fn implicit-return [x]
  (let doubled (* x 2))
  doubled)
(implicit-return 5)
`;
  const result = await run(code);
  assertEquals(result, 10);
});

Deno.test("Return: implicit return from anonymous fn", async () => {
  const code = `
(let add-two (fn (x) (+ x 2)))
(add-two 10)
`;
  const result = await run(code);
  assertEquals(result, 12);
});

Deno.test("Return: explicit return with value", async () => {
  const code = `
(fn explicit-return [x]
  (let doubled (* x 2))
  (return doubled))
(explicit-return 7)
`;
  const result = await run(code);
  assertEquals(result, 14);
});

Deno.test("Return: early return exits immediately", async () => {
  const code = `
(fn early-exit [x]
  (return 42)
  (+ x 100))
(early-exit 5)
`;
  const result = await run(code);
  assertEquals(result, 42);
});

Deno.test("Return: return in conditional branch", async () => {
  const code = `
(fn conditional-return [x]
  (if (< x 0)
    (return 0)
    (* x 2)))
(conditional-return -5)
`;
  const result = await run(code);
  assertEquals(result, 0);
});

Deno.test("Return: explicit return in anonymous fn", async () => {
  const code = `
(let check-positive
  (fn (x)
    (if (< x 0)
      (return false)
      true)))
(check-positive -3)
`;
  const result = await run(code);
  assertEquals(result, false);
});

Deno.test("Return: anonymous fn with early return", async () => {
  const code = `
(let process
  (fn (x)
    (if (=== x 0)
      (return "zero")
      (+ "number: " x))))
(process 0)
`;
  const result = await run(code);
  assertEquals(result, "zero");
});

Deno.test("Return: multiple return paths with cond", async () => {
  const code = `
(fn classify [x]
  (cond
    ((< x 0) (return "negative"))
    ((=== x 0) (return "zero"))
    ((> x 0) (return "positive"))
    (else (return "unknown"))))
(classify 5)
`;
  const result = await run(code);
  assertEquals(result, "positive");
});

Deno.test("Return: multiple explicit returns in branches", async () => {
  const code = `
(fn grade [score]
  (if (>= score 90)
    (return "A")
    (if (>= score 80)
      (return "B")
      (if (>= score 70)
        (return "C")
        (return "F")))))
(grade 85)
`;
  const result = await run(code);
  assertEquals(result, "B");
});

Deno.test("Return: return only affects inner function", async () => {
  const code = `
(fn outer [x]
  (fn inner [y]
    (if (< y 0)
      (return "negative")
      "positive"))
  (let result (inner x))
  (+ "Result: " result))
(outer -5)
`;
  const result = await run(code);
  assertEquals(result, "Result: negative");
});

Deno.test("Return: outer function continues after inner return", async () => {
  const code = `
(fn outer [x]
  (fn inner [y]
    (return (* y 2)))
  (let doubled (inner x))
  (+ doubled 10))
(outer 5)
`;
  const result = await run(code);
  assertEquals(result, 20);
});

Deno.test("Return: function without return yields last expression", async () => {
  const code = `
(fn side-effect [x]
  (let temp x)
  temp)
(side-effect 42)
`;
  const result = await run(code);
  assertEquals(result, 42);
});

Deno.test("Return: return inside do block", async () => {
  const code = `
(let process-list
  (fn (nums)
    (do
      (if (< (get nums 0) 0)
        (return "negative")
        (return "positive")))))
(process-list [-5, 10, 20])
`;
  const result = await run(code);
  assertEquals(result, "negative");
});

Deno.test("Return: return with complex expression", async () => {
  const code = `
(fn calculate [a b c]
  (if (=== b 0)
    (return "division by zero")
    (return (/ (+ a c) b))))
(calculate 10 2 6)
`;
  const result = await run(code);
  assertEquals(result, 8);
});

Deno.test("Return: consistent return types in all branches", async () => {
  const code = `
(fn safe-divide [a b]
  (if (=== b 0)
    (return 0)
    (/ a b)))
(safe-divide 10 0)
`;
  const result = await run(code);
  assertEquals(result, 0);
});

// ============================================================================
// SECTION 8: VALIDATION & ERRORS (2 tests)
// ============================================================================

Deno.test("Validation: named arguments are rejected with helpful error", async () => {
  const code = `
(fn add [x y] (+ x y))
(add x: 10 y: 20)
`;
  await assertRejects(
    async () => await run(code),
    Error,
    "HQL1001",
  );
});

Deno.test("Validation: named arguments error mentions migration options", async () => {
  const code = `
(fn calc [a b c] (+ a b c))
(calc 5 b: 10 c: 15)
`;
  await assertRejects(
    async () => await run(code),
    Error,
    "JSON map",
  );
});

// ============================================================================
// SECTION 9: SYNTAX FLEXIBILITY TESTS (New - testing both Lisp and JSON styles)
// ============================================================================

Deno.test("Syntax Flexibility: Lisp-style map params {x: 0 y: 0}", async () => {
  const code = `
(fn add {x: 0 y: 0}
  (+ x y))
(add {x: 10 y: 20})
`;
  const result = await run(code);
  assertEquals(result, 30);
});

Deno.test("Syntax Flexibility: Lisp-style map params no commas {x: 0 y: 0 z: 0}", async () => {
  const code = `
(fn sum {x: 0 y: 0 z: 0}
  (+ x y z))
(sum {x: 5 y: 10 z: 15})
`;
  const result = await run(code);
  assertEquals(result, 30);
});

Deno.test("Syntax Flexibility: JSON-style map params {\"x\": 0, \"y\": 0}", async () => {
  const code = `
(fn add {"x": 0, "y": 0}
  (+ x y))
(add {"x": 10, "y": 20})
`;
  const result = await run(code);
  assertEquals(result, 30);
});

Deno.test("Syntax Flexibility: Mixed-style map params {x: 0, \"y\": 0}", async () => {
  const code = `
(fn add {x: 0, "y": 0}
  (+ x y))
(add {x: 10 "y": 20})
`;
  const result = await run(code);
  assertEquals(result, 30);
});

Deno.test("Syntax Flexibility: Lisp-style call with JSON-style params", async () => {
  const code = `
(fn multiply {"x": 10, "y": 20}
  (* x y))
(multiply {x: 5 y: 4})
`;
  const result = await run(code);
  assertEquals(result, 20);
});

Deno.test("Syntax Flexibility: JSON-style call with Lisp-style params", async () => {
  const code = `
(fn multiply {x: 10 y: 20}
  (* x y))
(multiply {"x": 5, "y": 4})
`;
  const result = await run(code);
  assertEquals(result, 20);
});

Deno.test("Syntax Flexibility: Positional params with commas [x, y]", async () => {
  const code = `
(fn add [x, y]
  (+ x y))
(add 10, 20)
`;
  const result = await run(code);
  assertEquals(result, 30);
});

Deno.test("Syntax Flexibility: Positional params mixed commas [x, y z]", async () => {
  const code = `
(fn sum [x, y z]
  (+ x y z))
(sum 10, 20 30)
`;
  const result = await run(code);
  assertEquals(result, 60);
});

Deno.test("Syntax Flexibility: Array literal with commas [1, 2, 3]", async () => {
  const code = `
(fn sum-array [nums]
  (.reduce nums (fn [a b] (+ a b)) 0))
(sum-array [1, 2, 3, 4, 5])
`;
  const result = await run(code);
  assertEquals(result, 15);
});

Deno.test("Syntax Flexibility: Array literal without commas [1 2 3]", async () => {
  const code = `
(fn sum-array [nums]
  (.reduce nums (fn [a b] (+ a b)) 0))
(sum-array [1 2 3 4 5])
`;
  const result = await run(code);
  assertEquals(result, 15);
});

Deno.test("Syntax Flexibility: Hash-map Lisp style {name: \"Alice\" age: 25}", async () => {
  const code = `
(let user {name: "Alice" age: 25 city: "NYC"})
(+ user.name " is " user.age " years old")
`;
  const result = await run(code);
  assertEquals(result, "Alice is 25 years old");
});

Deno.test("Syntax Flexibility: Hash-map JSON style {\"name\": \"Alice\", \"age\": 25}", async () => {
  const code = `
(let user {"name": "Alice", "age": 25, "city": "NYC"})
(+ user.name " is " user.age " years old")
`;
  const result = await run(code);
  assertEquals(result, "Alice is 25 years old");
});

Deno.test("Syntax Flexibility: Hash-map mixed style {name: \"Alice\", \"age\": 25}", async () => {
  const code = `
(let user {name: "Alice", "age": 25, city: "NYC"})
(+ user.name " is " user.age " years old")
`;
  const result = await run(code);
  assertEquals(result, "Alice is 25 years old");
});

Deno.test("Syntax Flexibility: Copy-paste JSON works directly", async () => {
  const code = `
(let response {
  "status": 200,
  "message": "Success",
  "data": {
    "users": [
      {"id": 1, "name": "Alice"},
      {"id": 2, "name": "Bob"}
    ]
  }
})
response.status
`;
  const result = await run(code);
  assertEquals(result, 200);
});

// Note: Nested property access on Lisp-style maps works, but may need get() helper
// for deeply nested structures. Testing with simpler examples below.

Deno.test("Syntax Flexibility: Function returning Lisp-style map", async () => {
  const code = `
(fn create-user {name: "Unknown" role: "user"}
  {name: name role: role active: true})
(create-user {name: "Alice" role: "admin"})
`;
  const result = await run(code);
  assertEquals(result.name, "Alice");
  assertEquals(result.role, "admin");
  assertEquals(result.active, true);
});

Deno.test("Syntax Flexibility: Function returning JSON-style map", async () => {
  const code = `
(fn create-user {"name": "Unknown", "role": "user"}
  {"name": name, "role": role, "active": true})
(create-user {"name": "Bob", "role": "viewer"})
`;
  const result = await run(code);
  assertEquals(result.name, "Bob");
  assertEquals(result.role, "viewer");
  assertEquals(result.active, true);
});
