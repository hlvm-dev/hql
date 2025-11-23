// test/organized/syntax/class/class.test.ts
// Comprehensive tests for class definitions, constructors, methods, and OOP
// Migrated from: test/syntax-class.test.ts

import { assertEquals } from "https://deno.land/std@0.208.0/assert/mod.ts";
import { run } from "../../../helpers.ts";

// ============================================================================
// SECTION 1: BASIC CLASS DEFINITION
// ============================================================================

Deno.test("Class: define empty class", async () => {
  const code = `
(class EmptyClass)
EmptyClass
`;
  const result = await run(code);
  assertEquals(typeof result, "function");
});

Deno.test("Class: define class with constructor", async () => {
  const code = `
(class Person
  (constructor (name)
    (set! this.name name)))
Person
`;
  const result = await run(code);
  assertEquals(typeof result, "function");
});

Deno.test("Class: create instance with new", async () => {
  const code = `
(class Person
  (constructor (name)
    (set! this.name name)))

(var p (new Person "Alice"))
p
`;
  const result = await run(code);
  assertEquals(typeof result, "object");
  assertEquals(result.name, "Alice");
});

// ============================================================================
// SECTION 2: CONSTRUCTOR BEHAVIOR
// ============================================================================

Deno.test("Class: constructor with single parameter", async () => {
  const code = `
(class Person
  (constructor (name)
    (set! this.name name)))

(var p (new Person "Bob"))
p.name
`;
  const result = await run(code);
  assertEquals(result, "Bob");
});

Deno.test("Class: constructor with multiple parameters", async () => {
  const code = `
(class Person
  (constructor (name age)
    (do
      (set! this.name name)
      (set! this.age age))))

(var p (new Person "Alice" 30))
p.age
`;
  const result = await run(code);
  assertEquals(result, 30);
});

Deno.test("Class: constructor initializes multiple properties", async () => {
  const code = `
(class Point
  (constructor (x y)
    (do
      (set! this.x x)
      (set! this.y y))))

(var p (new Point 10 20))
(+ p.x p.y)
`;
  const result = await run(code);
  assertEquals(result, 30);
});

// ============================================================================
// SECTION 3: METHODS
// ============================================================================

Deno.test("Class: method with no parameters", async () => {
  const code = `
(class Person
  (constructor (name)
    (set! this.name name))

  (fn greet []
    (+ "Hello, " this.name)))

(var p (new Person "Alice"))
(p.greet)
`;
  const result = await run(code);
  assertEquals(result, "Hello, Alice");
});

Deno.test("Class: method with parameters", async () => {
  const code = `
(class Calculator
  (constructor (base)
    (set! this.base base))

  (fn add [x]
    (+ this.base x)))

(var c (new Calculator 10))
(c.add 5)
`;
  const result = await run(code);
  assertEquals(result, 15);
});

Deno.test("Class: method returns value", async () => {
  const code = `
(class Math
  (fn double [x]
    (* x 2)))

(var m (new Math))
(m.double 7)
`;
  const result = await run(code);
  assertEquals(result, 14);
});

Deno.test("Class: method accesses instance properties", async () => {
  const code = `
(class Counter
  (constructor ()
    (set! this.count 0))

  (fn increment []
    (set! this.count (+ this.count 1))
    this.count))

(var c (new Counter))
(c.increment)
(c.increment)
(c.increment)
`;
  const result = await run(code);
  assertEquals(result, 3);
});

Deno.test("Class: method calls another method", async () => {
  const code = `
(class Person
  (constructor (name)
    (set! this.name name))

  (fn getName ()
    this.name)

  (fn greet []
    (+ "Hello, " (this.getName))))

(var p (new Person "Bob"))
(p.greet)
`;
  const result = await run(code);
  assertEquals(result, "Hello, Bob");
});

// ============================================================================
// SECTION 4: FIELD DECLARATIONS (var/let in classes)
// ============================================================================

Deno.test("Class: mutable field with var", async () => {
  const code = `
(class Config
  (var setting)

  (constructor (val)
    (set! this.setting val)))

(var cfg (new Config "production"))
cfg.setting
`;
  const result = await run(code);
  assertEquals(result, "production");
});

Deno.test("Class: field with default value", async () => {
  const code = `
(class Person
  (var count 0)

  (constructor (name)
    (do
      (set! this.name name)
      (set! this.count (+ this.count 1)))))

(var p (new Person "Alice"))
p.count
`;
  const result = await run(code);
  assertEquals(result, 1);
});

Deno.test("Class: immutable field with let", async () => {
  const code = `
(class Config
  (let defaultKey "default-key")

  (constructor (key)
    (do
      (set! this.activeKey key))))

(var cfg (new Config "secret123"))
cfg.defaultKey
`;
  const result = await run(code);
  assertEquals(result, "default-key");
});

Deno.test("Class: immutable field with default value", async () => {
  const code = `
(class Constants
  (let PI 3.14159)
  (let E 2.71828)

  (constructor ()
    (set! this.timestamp (js-call Date "now"))))

(var c (new Constants))
c.PI
`;
  const result = await run(code);
  assertEquals(result, 3.14159);
});

Deno.test("Class: multiple immutable and mutable fields", async () => {
  const code = `
(class Account
  (let bankName "MyBank")  ;; immutable - must have default value
  (var balance 0)          ;; mutable

  (constructor (accNum initialBalance)
    (do
      (set! this.accountNumber accNum)
      (set! this.balance initialBalance))))

(var acc (new Account "ACC123" 100))
(+ acc.bankName "-" acc.accountNumber "-" acc.balance)
`;
  const result = await run(code);
  assertEquals(result, "MyBank-ACC123-100");
});

// ============================================================================
// SECTION 5: PROPERTY ACCESS & MODIFICATION
// ============================================================================

Deno.test("Class: access property via dot notation", async () => {
  const code = `
(class Person
  (constructor (name age)
    (set! this.name name)
    (set! this.age age)))

(var p (new Person "Alice" 25))
p.name
`;
  const result = await run(code);
  assertEquals(result, "Alice");
});

Deno.test("Class: modify property after creation", async () => {
  const code = `
(class Person
  (constructor (name)
    (set! this.name name)))

(var p (new Person "Alice"))
(set! p.name "Bob")
p.name
`;
  const result = await run(code);
  assertEquals(result, "Bob");
});

Deno.test("Class: add new property after creation", async () => {
  const code = `
(class Person
  (constructor (name)
    (set! this.name name)))

(var p (new Person "Alice"))
(set! p.age 30)
p.age
`;
  const result = await run(code);
  assertEquals(result, 30);
});

// ============================================================================
// SECTION 6: MULTIPLE INSTANCES
// ============================================================================

Deno.test("Class: multiple instances are independent", async () => {
  const code = `
(class Counter
  (constructor ()
    (set! this.count 0))

  (fn increment []
    (set! this.count (+ this.count 1))
    this.count))

(var c1 (new Counter))
(var c2 (new Counter))
(c1.increment)
(c1.increment)
(c2.increment)
c1.count
`;
  const result = await run(code);
  assertEquals(result, 2);
});

Deno.test("Class: second instance independent from first", async () => {
  const code = `
(class Counter
  (constructor ()
    (set! this.count 0))

  (fn increment []
    (set! this.count (+ this.count 1))
    this.count))

(var c1 (new Counter))
(var c2 (new Counter))
(c1.increment)
(c1.increment)
(c2.increment)
c2.count
`;
  const result = await run(code);
  assertEquals(result, 1);
});

// ============================================================================
// SECTION 7: METHOD WITH DEFAULT PARAMETERS
// ============================================================================

Deno.test("Class: method with default parameter values", async () => {
  const code = `
(class Calculator
  (constructor (baseValue)
    (set! this.baseValue baseValue))

  (fn multiply [x = 10 y = 2]
    (* x y)))

(var calc (new Calculator 5))
(calc.multiply)
`;
  const result = await run(code);
  assertEquals(result, 20);
});

Deno.test("Class: method with one default parameter used", async () => {
  const code = `
(class Calculator
  (constructor (baseValue)
    (set! this.baseValue baseValue))

  (fn multiply [x = 10 y = 2]
    (* x y)))

(var calc (new Calculator 5))
(calc.multiply 5)
`;
  const result = await run(code);
  assertEquals(result, 10);
});

Deno.test("Class: method with no defaults used", async () => {
  const code = `
(class Calculator
  (constructor (baseValue)
    (set! this.baseValue baseValue))

  (fn multiply [x = 10 y = 2]
    (* x y)))

(var calc (new Calculator 5))
(calc.multiply 7 3)
`;
  const result = await run(code);
  assertEquals(result, 21);
});

// ============================================================================
// SECTION 8: COMPLEX SCENARIOS
// ============================================================================

Deno.test("Class: method modifies instance state and returns self", async () => {
  const code = `
(class Person
  (constructor (name age)
    (do
      (set! this.name name)
      (set! this.age age)))

  (fn celebrateBirthday (newAge)
    (do
      (set! this.age newAge)
      this)))

(var p (new Person "Alice" 30))
(var result (p.celebrateBirthday 31))
result.age
`;
  const result = await run(code);
  assertEquals(result, 31);
});

Deno.test("Class: complex method using multiple instance properties", async () => {
  const code = `
(class Rectangle
  (constructor (width height)
    (do
      (set! this.width width)
      (set! this.height height)))

  (fn area []
    (* this.width this.height))

  (fn perimeter []
    (* 2 (+ this.width this.height))))

(var r (new Rectangle 5 10))
(+ (r.area) (r.perimeter))
`;
  const result = await run(code);
  assertEquals(result, 80); // area: 50, perimeter: 30, sum: 80
});

Deno.test("Class: constructor with computation", async () => {
  const code = `
(class Circle
  (constructor (radius)
    (do
      (set! this.radius radius)
      (set! this.diameter (* 2 radius)))))

(var c (new Circle 5))
c.diameter
`;
  const result = await run(code);
  assertEquals(result, 10);
});

Deno.test("Class: method accessing computed property", async () => {
  const code = `
(class Circle
  (constructor (radius)
    (set! this.radius radius))

  (fn diameter []
    (* 2 this.radius))

  (fn circumference []
    (* 2 3.14159 this.radius)))

(var c (new Circle 5))
(c.diameter)
`;
  const result = await run(code);
  assertEquals(result, 10);
});

Deno.test("Class: top-level class with helper-producing call returns final value", async () => {
  const code = `
(class Example
  (constructor ()
    (set! this.value 1)))

(doall (range 3))
`;
  const result = await run(code);
  assertEquals(result, [0, 1, 2]);
});

Deno.test("Class: using this/self in nested expressions", async () => {
  const code = `
(class Calculator
  (constructor (x y)
    (do
      (set! this.x x)
      (set! this.y y)))

  (fn compute []
    (+ (* this.x 2) (* this.y 3))))

(var calc (new Calculator 5 10))
(calc.compute)
`;
  const result = await run(code);
  assertEquals(result, 40); // (5*2) + (10*3) = 10 + 30 = 40
});

Deno.test("Class: method returns object literal", async () => {
  const code = `
(class Person
  (constructor (name age)
    (do
      (set! this.name name)
      (set! this.age age)))

  (fn toObject ()
    {"name": this.name, "age": this.age}))

(var p (new Person "Alice" 30))
(var obj (p.toObject))
(get obj "name")
`;
  const result = await run(code);
  assertEquals(result, "Alice");
});
