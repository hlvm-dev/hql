# Class Feature Documentation

**Implementation:** `src/hql/transpiler/syntax/class.ts`, `src/hql/transpiler/pipeline/ir-to-typescript.ts`

## Overview

HQL classes compile to JavaScript ES6 class syntax. Supported features:

1. **Class definitions** with `(class Name ...)`
2. **Constructors** with `(constructor [params] body)`
3. **Methods** with `(fn name [params] body)`
4. **Fields** with `(var name val)`, `(let name val)`, `(const name val)`
5. **Static members** with `(static var/let/const/fn ...)`
6. **Private fields** with `(#fieldName value)`
7. **Getters/Setters** with `(getter name [] body)` / `(setter name [param] body)`
8. **Inheritance** with `extends` and `(super args...)`
9. **Generic type parameters** with `(class Box<T> ...)`
10. **Default parameters** on methods

## Syntax

### Basic Class Definition

```lisp
// Empty class
(class MyClass)

// Class with constructor
(class Person
  (constructor [name age]
    (do
      (= this.name name)
      (= this.age age))))

// Instantiate with 'new'
(var p (new Person "Alice" 30))
```

### Constructors

Constructor parameters can use either bracket `[x y]` or parenthesis `(x y)` syntax. Both are supported by the parser.

```lisp
// Single parameter
(class Counter
  (constructor [initial]
    (= this.count initial)))

// Multiple parameters
(class Point
  (constructor [x y]
    (do
      (= this.x x)
      (= this.y y))))

// Empty constructor
(class Empty
  (constructor []
    (= this.val 42)))

// Constructor with computation
(class Circle
  (constructor [radius]
    (do
      (= this.radius radius)
      (= this.diameter (* 2 radius)))))

// Multiple body expressions without do-block
(class Point
  (constructor (x y)
    (= this.x x)
    (= this.y y)))
```

### Methods

```lisp
// Method without parameters
(class Counter
  (constructor [n]
    (= this.count n))

  (fn getValue []
    this.count))

// Method with parameters
(class Calculator
  (constructor [base]
    (= this.base base))

  (fn add [x]
    (+ this.base x)))

// Method accessing this properties
(class Person
  (constructor [name]
    (= this.name name))

  (fn greet []
    (+ "Hello, " this.name)))

// Method calling another method
(class Person
  (constructor [name]
    (= this.name name))

  (fn getName []
    this.name)

  (fn greet []
    (+ "Hello, " (this.getName))))
```

Methods have implicit return: the last expression in the body is automatically returned.

### Field Declarations

Fields are declared with `var`, `let`, or `const`. Both `var` and `let` produce mutable fields; `const` is tracked as immutable in the IR but does not emit `readonly` in the generated code (all three produce the same field initializer syntax at runtime).

```lisp
// Mutable field (var)
(class Config
  (var setting)

  (constructor [val]
    (= this.setting val)))

// Field with default value
(class Person
  (var count 0)

  (constructor [name]
    (do
      (= this.name name)
      (= this.count (+ this.count 1)))))

// Const field - must have default value
// Note: const is tracked in the IR but does not emit `readonly` in the generated code.
// At runtime, const fields can still be reassigned (enforcement is semantic only).
(class Constants
  (const PI 3.14159)
  (const E 2.71828))

// Mixed const and mutable fields
(class Account
  (const bankName "MyBank")  // const (semantic-only immutability)
  (var balance 0)            // mutable (var)

  (constructor [accNum initialBalance]
    (do
      (= this.accountNumber accNum)
      (= this.balance initialBalance))))
```

### Static Members

```lisp
// Static variable
(class Counter
  (static var count 0)

  (constructor []
    (= Counter.count (+ Counter.count 1)))

  (static fn getCount []
    Counter.count))

// Static constants
(class MathUtils
  (static let PI 3.14159)

  (static fn circleArea [r]
    (* MathUtils.PI r r)))

// Mixed static and instance members
(class Counter
  (static var count 0)
  (var value 1)
  (static fn increment []
    (= Counter.count (+ Counter.count 1)))
  (fn getValue []
    this.value))
```

The codegen emits `static fieldName = value;` inline. After TypeScript compilation (downlevel), static fields with initial values become hoisted assignments (e.g., `Counter.count = 0;` after the class declaration).

### Private Fields

Private fields use the `#` prefix shorthand syntax.

```lisp
// Private field with default value
(class BankAccount
  (#balance 0)

  (constructor [initial]
    (= this.#balance initial))

  (fn deposit [amount]
    (= this.#balance (+ this.#balance amount)))

  (fn getBalance []
    this.#balance))

// Mixed private and public fields
(class User
  (#password "secret")
  (var username "guest"))
```

Private fields are always mutable. They compile to JavaScript `#`-prefixed private fields, which TypeScript then compiles to WeakMap patterns.

### Getters and Setters

The keywords are `getter` and `setter` (not `get`/`set`, to avoid conflicts with macros).

```lisp
// Getter - computed property access
(class Circle
  (var _radius 0)

  (constructor [r]
    (= this._radius r))

  (getter radius []
    this._radius)

  (getter area []
    (* Math.PI this._radius this._radius)))

(let c (new Circle 5))
c.radius  // => 5 (calls getter)
c.area    // => ~78.54

// Setter - property assignment
(class Circle
  (var _radius 0)

  (setter radius [value]
    (= this._radius value)))

// Getter + Setter pair
(class Rectangle
  (var _width 0)
  (var _height 0)

  (getter width []
    this._width)
  (setter width [value]
    (= this._width value))
  (getter height []
    this._height)
  (setter height [value]
    (= this._height value)))
```

Getters must have zero parameters. Setters must have exactly one parameter. Getters have implicit return on the last expression.

### Inheritance

```lisp
// Class inheritance with extends
(class Animal
  (constructor [name]
    (= this.name name))
  (fn speak []
    (+ this.name " makes a sound")))

(class Dog extends Animal
  (constructor [name]
    (super name))
  (fn speak []
    (+ this.name " barks")))

(var d (new Dog "Rex"))
(d.speak)  // => "Rex barks"

// Inherited methods
(class Base
  (constructor [x]
    (= this.x x))
  (fn getX []
    this.x))

(class Child extends Base
  (constructor [x y]
    (super x)
    (= this.y y))
  (fn getY []
    this.y))

(var c (new Child 10 20))
(c.getX)  // => 10 (inherited from Base)
(c.getY)  // => 20

// instanceof works through the chain
(instanceof c Child)  // => true
(instanceof c Base)   // => true
```

`super` calls the parent constructor. Method overriding works by defining a method with the same name in the child class. `super.method()` calls are not yet supported (only `(super args...)` for constructor delegation).

### Generic Type Parameters

```lisp
// Class with type parameters (TypeScript output only)
(class Box<T>
  (constructor [value:T]
    (= this.value value)))
```

Type parameters are extracted from the class name and emitted in the TypeScript output.

### Default Parameters

Methods support default parameter values using `=` syntax:

```lisp
(class Calculator
  (constructor [baseValue]
    (= this.baseValue baseValue))

  (fn multiply [x = 10 y = 2]
    (* x y)))

(var calc (new Calculator 5))
(calc.multiply)       // => 20 (all defaults)
(calc.multiply 5)     // => 10 (5 * 2)
(calc.multiply 7 3)   // => 21 (7 * 3)
```

JSON map syntax for defaults is also supported:

```lisp
(class Calculator
  (fn multiply {"x": 10, "y": 2}
    (* x y)))
```

### Property Access and Modification

```lisp
// Dot notation access
(var p (new Person "Alice" 25))
p.name  // => "Alice"

// Modify property
(= p.name "Bob")

// Add new property dynamically
(= p.email "bob@example.com")
```

## Compilation

### Class to JavaScript

**HQL:**

```lisp
(class Person
  (constructor [name age]
    (do
      (= this.name name)
      (= this.age age)))

  (fn greet []
    (+ "Hello, " this.name)))
```

**Generated JavaScript:**

```javascript
class Person {
  constructor(name, age) {
    this.name = name;
    this.age = age;
  }

  greet() {
    return "Hello, " + this.name;
  }
}
```

### Field Initialization

**HQL:**

```lisp
(class Counter
  (var count 0)
  (let maxCount 100))
```

**Generated JavaScript:**

```javascript
class Counter {
  count = 0;
  maxCount = 100;
}
```

## Transform Pipeline

```
HQL Class Syntax
  |
S-expression Parser
  |
Class Transformer (class.ts)
  |
IRClassDeclaration { fields, constructor, methods, superClass?, typeParameters? }
  |
TypeScript Code Generator (ir-to-typescript.ts)
  |
JavaScript ES6 Classes
```

## Test Coverage

Tests are in:
- `tests/unit/organized/syntax/class/class.test.ts` — main class tests (constructors, methods, fields, inheritance, instanceof)
- `tests/unit/syntax-class-constructor.test.ts` — constructor parameter edge cases
- `tests/unit/static-class-members.test.ts` — static fields and methods
- `tests/unit/private-fields.test.ts` — private field transpilation
- `tests/unit/getters-setters.test.ts` — getter/setter transpilation

### What is tested

- Empty class definition
- Constructor with 0, 1, or multiple parameters (both `()` and `[]` syntax)
- Constructor with computation and do-blocks
- Methods: no params, with params, accessing `this`, calling other methods, implicit return
- Field declarations: `var`, `let`, `const`, with and without defaults, mixed
- Property access via dot notation, modification, dynamic addition
- Multiple independent instances
- Method default parameters (all defaults, partial, none)
- Static fields (`static var`, `static let`, `static const`)
- Static methods (`static fn`)
- Private fields (`#name value`)
- Getters (`getter name [] body`)
- Setters (`setter name [param] body`)
- Inheritance: `extends`, `super`, inherited methods, `instanceof`
- Method returns self (chaining pattern)
- Object literal return from methods

### What is NOT yet implemented

- `super.method()` calls (only `(super args...)` for constructor delegation)
- Abstract classes are available via `(abstract-class ...)` (see type-system docs), but not via the `(class ...)` form
- Decorators (IR type exists: `IRDecorator`, but no HQL syntax to produce it)
