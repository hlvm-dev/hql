## Class: Object-Oriented Reference Type

Classes in HQL compile to JavaScript ES6 classes. They support mutable state, constructors, methods, field declarations, static members, private fields, getters/setters, and inheritance.

### Definition

```lisp
(class Person
  // Field declarations
  (var name)           // mutable field (set in constructor)
  (var age)            // mutable field (set in constructor)
  (var score 0)        // mutable field with default value
  (const role "user")  // immutable field with default value

  // Constructor: initializes fields
  (constructor [name age]
    (do
      (= this.name name)
      (= this.age age)))

  // Methods
  (fn greet []
    (+ "Hello, " this.name))

  (fn celebrateBirthday [newAge]
    (do
      (= this.age newAge)
      this)))
```

### Inheritance

```lisp
(class Animal
  (constructor [name]
    (= this.name name))
  (fn describe []
    (+ "Animal: " this.name)))

(class Dog extends Animal
  (constructor [name breed]
    (super name)
    (= this.breed breed))
  (fn bark []
    "Woof!"))
```

`super` calls the parent constructor. Method overriding works by redefining a method in the child class. `super.method()` calls are not yet supported.

### Static Members

```lisp
(class Counter
  (static var count 0)
  (static fn increment []
    (= Counter.count (+ Counter.count 1))))
```

Static fields and methods use the `static` keyword prefix before `var`/`let`/`const`/`fn`.

### Private Fields

```lisp
(class BankAccount
  (#balance 0)

  (constructor [initial]
    (= this.#balance initial))

  (fn getBalance []
    this.#balance))
```

Private fields use the `#` shorthand prefix. They are always mutable. They compile to JavaScript `#`-prefixed private class fields.

### Getters and Setters

```lisp
(class Circle
  (var _radius 0)

  (getter radius []
    this._radius)

  (setter radius [value]
    (= this._radius value)))
```

Keywords are `getter` and `setter` (not `get`/`set`). Getters take zero parameters. Setters take exactly one parameter. Getters have implicit return.

### Usage

```lisp
// Instantiate
(let person (new Person "Alice" 30))

// Field access via dot notation
person.name    // => "Alice"
person.age     // => 30

// Method calls
(person.greet)                  // => "Hello, Alice"
(person.celebrateBirthday 31)   // Updates age, returns instance
person.age                      // => 31
```

### Field Semantics

- `(var name)` / `(let name)` — mutable field (both `var` and `let` produce mutable fields)
- `(var name value)` / `(let name value)` — mutable field with default
- `(const name value)` — const field with default (must have a value; tracked as immutable in IR but `readonly` is not emitted in generated code)
- Field defaults are initialized when the class instance is created
- Constructor can override field defaults via `(= this.field value)`

### Constructor

- Parameters can use bracket `[x y]` or parenthesis `(x y)` syntax
- Body can be a single expression, a `(do ...)` block, or multiple expressions
- In subclasses, `(super args...)` must be called to invoke the parent constructor

### Methods

- Defined with `(fn name [params] body)`
- Have implicit return: the last expression is automatically wrapped in a return statement
- Support default parameter values: `(fn add [x = 10 y = 2] (+ x y))`
- Support JSON map parameter defaults: `(fn add {"x": 10, "y": 2} (+ x y))`

### Compilation Target

All classes compile to JavaScript ES6 `class` syntax. The generated code preserves:
- `class` declarations with optional `extends`
- Field initializers (instance and static)
- Constructor with parameters
- Methods (instance, static, getters, setters)
- Private fields with `#` prefix
- Type parameters in TypeScript output

### Not Yet Implemented

- `super.method()` calls (only constructor delegation via `(super args...)`)
- Abstract classes are available via `(abstract-class ...)` (see type-system docs), but not via `(class ...)`
- Decorators (IR type exists but no HQL syntax to produce it)
