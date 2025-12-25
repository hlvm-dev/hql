# Class Feature Documentation

**Implementation:** Transpiler class syntax transformers
**Coverage:** ✅ 100%

## Overview

HQL v2.0 provides full object-oriented programming (OOP) support with classes:

1. **Class definitions** - Define reusable object templates
2. **Constructors** - Initialize instance state
3. **Methods** - Instance functions with `this` binding
4. **Fields** - Mutable (`var`) and immutable (`let`) properties
5. **Static members** - Class-level properties and methods (v2.0)
6. **Private fields** - Encapsulated state with `#` prefix (v2.0)
7. **Getters/Setters** - Computed property access (v2.0)
8. **Multiple instances** - Independent object state
9. **Default parameters** - Methods with optional arguments
10. **Property access** - Dot notation for members

All classes compile to JavaScript ES6 class syntax.

## Syntax

### Basic Class Definition

```lisp
; Empty class
(class MyClass)

; Class with constructor
(class Person
  (constructor [name age]
    (do
      (= this.name name)
      (= this.age age))))

; Instantiate with 'new'
(var p (new Person "Alice" 30))
```

### Constructors

```lisp
; Single parameter
(class Counter
  (constructor [initial]
    (= this.count initial)))

; Multiple parameters
(class Point
  (constructor [x y]
    (do
      (= this.x x)
      (= this.y y))))

; Empty constructor
(class Empty
  (constructor []))

; Constructor with computation
(class Circle
  (constructor [radius]
    (do
      (= this.radius radius)
      (= this.diameter (* 2 radius)))))
```

### Methods

```lisp
; Method without parameters
(class Counter
  (constructor [n]
    (= this.count n))

  (fn getValue []
    this.count))

; Method with parameters
(class Calculator
  (constructor []
    (= this.value 0))

  (fn add [x y]
    (+ x y)))

; Method accessing this properties
(class Person
  (constructor [name]
    (= this.name name))

  (fn greet []
    (+ "Hello, " this.name)))

; Method calling another method
(class Counter
  (constructor []
    (= this.count 0))

  (fn increment []
    (= this.count (+ this.count 1)))

  (fn incrementTwice []
    (do
      (this.increment)
      (this.increment))))
```

### Field Declarations

```lisp
; Mutable field (var) - must have default value
(class Counter
  (var count 0)

  (constructor []
    (= this.count 0)))

; Immutable field (let) - must have default value
(class Config
  (let maxSize 100)

  (constructor []))

; Mixed mutable and immutable fields
(class Account
  (let bankName "MyBank")  ; immutable constant
  (var balance 0)          ; mutable state

  (constructor [accNum initialBalance]
    (do
      (= this.accountNumber accNum)
      (= this.balance initialBalance))))
```

### Static Members (v2.0)

```lisp
; Static variable
(class Counter
  (static var count 0)

  (constructor []
    (= Counter.count (+ Counter.count 1)))

  (static fn getCount []
    Counter.count))

(new Counter)
(new Counter)
(Counter.getCount)  ; => 2

; Static constants
(class MathUtils
  (static let PI 3.14159)
  (static let E 2.71828)

  (static fn circleArea [r]
    (* MathUtils.PI r r)))

(MathUtils.circleArea 5)  ; => 78.53975
```

### Private Fields (v2.0)

```lisp
; Private fields start with #
(class BankAccount
  (#balance 0)  ; private field

  (constructor [initial]
    (= this.#balance initial))

  (fn deposit [amount]
    (= this.#balance (+ this.#balance amount)))

  (fn getBalance []
    this.#balance))

(let account (new BankAccount 100))
(.deposit account 50)
(.getBalance account)  ; => 150
; account.#balance     ; ERROR: Private field
```

### Getters and Setters (v2.0)

```lisp
; Getter - computed property access
(class Circle
  (var _radius 0)

  (constructor [r]
    (= this._radius r))

  (getter radius []
    this._radius)

  (getter diameter []
    (* 2 this._radius))

  (getter area []
    (* 3.14159 this._radius this._radius)))

(let c (new Circle 5))
c.radius    ; => 5 (calls getter)
c.diameter  ; => 10
c.area      ; => 78.53975

; Setter - property assignment
(class Temperature
  (var _celsius 0)

  (getter celsius []
    this._celsius)

  (setter celsius [value]
    (= this._celsius value))

  (getter fahrenheit []
    (+ (* this._celsius 1.8) 32))

  (setter fahrenheit [value]
    (= this._celsius (/ (- value 32) 1.8))))

(let t (new Temperature))
(= t.celsius 100)
t.fahrenheit  ; => 212
(= t.fahrenheit 32)
t.celsius     ; => 0
```

### Property Access and Modification

```lisp
; Dot notation access
(var p (new Person "Alice" 25))
p.name  ; → "Alice"

; Modify property
(= p.name "Bob")

; Add new property dynamically
(= p.email "bob@example.com")
```

### Default Parameters

```lisp
; Methods with JSON map parameters (defaults)
(class Calculator
  (constructor [baseValue]
    (= this.baseValue baseValue))

  (fn multiply {"x": 10, "y": 2}
    (* x y)))

; Use all defaults
(calc.multiply)  ; → 20

; Override first default
(calc.multiply {"x": 5})  ; → 10 (5 * 2)

; Override all defaults
(calc.multiply {"x": 7, "y": 3})  ; → 21
```

## Implementation Details

### Class Compilation

**HQL Source:**

```lisp
(class Person
  (constructor [name age]
    (do
      (= this.name name)
      (= this.age age)))

  (fn greet []
    (+ "Hello, " this.name)))
```

**Compiled JavaScript:**

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

### Instance Creation

**HQL:**

```lisp
(var p (new Person "Alice" 30))
(p.greet)  ; → "Hello, Alice"
```

**Compiled:**

```javascript
const p = new Person("Alice", 30);
p.greet(); // → "Hello, Alice"
```

### Field Initialization

**HQL:**

```lisp
(class Counter
  (var count 0)
  (let maxCount 100))
```

**Compiled:**

```javascript
class Counter {
  count = 0;
  maxCount = 100;
}
```

### Method This Binding

**HQL:**

```lisp
(fn increment []
  (= this.count (+ this.count 1)))
```

**Compiled:**

```javascript
increment() {
  this.count = this.count + 1;
}
```

### Characteristics

**Class Features:**

- ✅ ES6 class syntax output
- ✅ Constructor with parameters
- ✅ Instance methods with `this` binding
- ✅ Field declarations (var/let)
- ✅ Property access via dot notation
- ✅ Dynamic property addition
- ✅ Multiple independent instances
- ✅ Method default parameters

**Method Features:**

- ✅ Access instance properties (`this.prop`)
- ✅ Call other methods (`this.method()`)
- ✅ Modify instance state (`(= this.prop value)`)
- ✅ Return computed values
- ✅ Return self for chaining
- ✅ Default parameter values

## Features Covered

✅ Empty class definition ✅ Simple class with constructor ✅ Constructor with
single parameter ✅ Constructor with multiple parameters ✅ Constructor with
computations ✅ Empty constructor ✅ Method without parameters ✅ Method with
single parameter ✅ Method with multiple parameters ✅ Method calling another
method ✅ Method accessing instance properties ✅ Method with expression body ✅
Method with return statement ✅ Mutable field declaration (var) ✅ Immutable
field declaration (let) ✅ Var field with default value ✅ Let field with
default value ✅ Mixed var and let fields ✅ Property access via dot notation ✅
Modify property after creation ✅ Add new property after creation ✅ Multiple
independent instances (first) ✅ Multiple independent instances (second) ✅
Method with default parameter values ✅ Method with one default used ✅ Method
with no defaults used ✅ Method modifies state and returns self ✅ Complex
method using multiple properties ✅ Constructor with computation ✅ Method
accessing computed property ✅ Top-level class with helper call ✅ Using this
in nested expressions ✅ Method returns object literal

## Test Coverage



### Section 1: Basic Class Definition

- Empty class
- Simple class with constructor

### Section 2: Constructor Behavior

- Single parameter
- Multiple parameters
- Computations in constructor
- Empty constructor

### Section 3: Methods

- Without parameters
- With single parameter
- With multiple parameters
- Calling other methods
- Accessing instance properties
- Expression body
- Return statement
- Various signatures

### Section 4: Field Declarations

- Mutable field (var)
- Immutable field (let)
- Var with default value
- Let with default value
- Mixed var and let fields

### Section 5: Property Access & Modification

- Dot notation access
- Modify existing property
- Add new property

### Section 6: Multiple Instances

- First instance independence
- Second instance independence

### Section 7: Method Default Parameters

- All defaults used
- One default used
- No defaults used

### Section 8: Complex Scenarios

- Method returns self
- Multi-property computation
- Constructor computation
- Computed property access

## Use Cases

### 1. Data Models

```lisp
; User data model
(class User
  (constructor [id name email]
    (do
      (= this.id id)
      (= this.name name)
      (= this.email email)))

  (fn getDisplayName []
    (+ this.name " (" this.email ")")))

(var user (new User 1 "Alice" "alice@example.com"))
(user.getDisplayName)  ; → "Alice (alice@example.com)"
```

### 2. State Management

```lisp
; Counter with increment/decrement
(class Counter
  (constructor [initial]
    (= this.count initial))

  (fn increment []
    (= this.count (+ this.count 1)))

  (fn decrement []
    (= this.count (- this.count 1)))

  (fn reset []
    (= this.count 0)))

(var counter (new Counter 10))
(counter.increment)
(counter.increment)
counter.count  ; → 12
```

### 3. Calculations

```lisp
; Rectangle with area and perimeter
(class Rectangle
  (constructor [width height]
    (do
      (= this.width width)
      (= this.height height)))

  (fn area []
    (* this.width this.height))

  (fn perimeter []
    (* 2 (+ this.width this.height))))

(var rect (new Rectangle 5 10))
(rect.area)       ; → 50
(rect.perimeter)  ; → 30
```

### 4. Configuration Objects

```lisp
; Config with defaults
(class AppConfig
  (let defaultPort 3000)
  (let defaultHost "localhost")
  (var port 3000)
  (var host "localhost")

  (constructor [customPort customHost]
    (do
      (= this.port customPort)
      (= this.host customHost)))

  (fn getUrl []
    (+ "http://" this.host ":" this.port)))

(var config (new AppConfig 8080 "example.com"))
(config.getUrl)  ; → "http://example.com:8080"
```

### 5. Builder Pattern

```lisp
; Builder for complex objects
(class UserBuilder
  (constructor []
    (do
      (= this.data {})))

  (fn setName [name]
    (do
      (= this.data.name name)
      this))  ; return self for chaining

  (fn setAge [age]
    (do
      (= this.data.age age)
      this))

  (fn build []
    this.data))

(var builder (new UserBuilder))
((builder.setName "Alice").setAge 30)
(builder.build)  ; → {name: "Alice", age: 30}
```

### 6. Banking/Financial

```lisp
; Bank account with transactions
(class BankAccount
  (let bankName "MyBank")
  (var balance 0)

  (constructor [accountNumber initialBalance]
    (do
      (= this.accountNumber accountNumber)
      (= this.balance initialBalance)))

  (fn deposit [amount]
    (do
      (= this.balance (+ this.balance amount))
      this.balance))

  (fn withdraw [amount]
    (do
      (= this.balance (- this.balance amount))
      this.balance))

  (fn getBalance []
    this.balance))

(var account (new BankAccount "ACC123" 1000))
(account.deposit 500)   ; → 1500
(account.withdraw 200)  ; → 1300
```

### 7. Geometry/Graphics

```lisp
; Circle with computed properties
(class Circle
  (constructor [radius]
    (= this.radius radius))

  (fn diameter []
    (* 2 this.radius))

  (fn circumference []
    (* 2 3.14159 this.radius))

  (fn area []
    (* 3.14159 this.radius this.radius)))

(var circle (new Circle 5))
(circle.diameter)        ; → 10
(circle.circumference)   ; → 31.4159
(circle.area)            ; → 78.53975
```

### 8. Task/Todo Management

```lisp
; Todo item with status
(class TodoItem
  (let STATUS_PENDING "pending")
  (let STATUS_DONE "done")
  (var status "pending")

  (constructor [title description]
    (do
      (= this.title title)
      (= this.description description)
      (= this.status this.STATUS_PENDING)))

  (fn markDone []
    (do
      (= this.status this.STATUS_DONE)
      this))

  (fn isDone []
    (= this.status this.STATUS_DONE)))

(var todo (new TodoItem "Write docs" "Complete README"))
(todo.markDone)
(todo.isDone)  ; → true
```

## Comparison with Other Languages

### JavaScript/TypeScript Classes

```javascript
// JavaScript ES6
class Person {
  constructor(name, age) {
    this.name = name;
    this.age = age;
  }

  greet() {
    return "Hello, " + this.name;
  }
}

// HQL (same concept)
(class Person
  (constructor [name age]
    (do
      (= this.name name)
      (= this.age age)))

  (fn greet []
    (+ "Hello, " this.name)))
```

### Python Classes

```python
# Python
class Person:
    def __init__(self, name, age):
        self.name = name
        self.age = age

    def greet(self):
        return f"Hello, {self.name}"

# HQL
(class Person
  (constructor [name age]
    (do
      (= this.name name)
      (= this.age age)))

  (fn greet []
    (+ "Hello, " this.name)))
```

### Java Classes

```java
// Java
public class Person {
    private String name;
    private int age;

    public Person(String name, int age) {
        this.name = name;
        this.age = age;
    }

    public String greet() {
        return "Hello, " + this.name;
    }
}

// HQL (no access modifiers, but similar structure)
(class Person
  (constructor [name age]
    (do
      (= this.name name)
      (= this.age age)))

  (fn greet []
    (+ "Hello, " this.name)))
```

### Clojure Records (closest Lisp analogy)

```clojure
;; Clojure defrecord
(defrecord Person [name age]
  (greet [this]
    (str "Hello, " (:name this))))

;; HQL class
(class Person
  (constructor [name age]
    (do
      (= this.name name)
      (= this.age age)))

  (fn greet []
    (+ "Hello, " this.name)))
```

## Related Specs

- Complete class system specification available in project specs
- Transpiler class transformers in syntax module
- Method compilation in function transformer

## Examples

See `examples.hql` for executable real-world examples.

## Transform Pipeline

```
HQL Class Syntax
  ↓
S-expression Parser
  ↓
Class Transformer
  ↓
Constructor/Method Transformers
  ↓
IR Nodes (ClassDeclaration, MethodDefinition)
  ↓
ESTree AST
  ↓
JavaScript ES6 Classes
```

## Best Practices

### Use Constructors to Initialize State

```lisp
; ✅ Good: Initialize in constructor
(class Person
  (constructor [name age]
    (do
      (= this.name name)
      (= this.age age))))

; ❌ Avoid: Uninitialized state
(class Person
  (fn setName [n] (= this.name n)))
```

### Group Related Fields

```lisp
; ✅ Good: Related fields together
(class Rectangle
  (var width 0)
  (var height 0)
  (let unit "px")

  (constructor [w h]
    (do
      (= this.width w)
      (= this.height h))))

; ❌ Avoid: Scattered fields
(class Rectangle
  (var width 0)
  (let unit "px")
  (var height 0))
```

### Use let for Constants

```lisp
; ✅ Good: Constants with let
(class Config
  (let MAX_CONNECTIONS 100)
  (let DEFAULT_TIMEOUT 5000))

; ❌ Avoid: Mutable constants
(class Config
  (var MAX_CONNECTIONS 100))
```

### Return Self for Chaining

```lisp
; ✅ Good: Return this for fluent API
(class Builder
  (fn setName [n]
    (do
      (= this.name n)
      this))

  (fn setAge [a]
    (do
      (= this.age a)
      this)))

; Usage: chaining
((builder.setName "Alice").setAge 30)
```

### Document Methods with Examples

```lisp
; ✅ Good: Clear method purpose
(class Calculator
  (fn add [x y]
    ; Returns sum of x and y
    (+ x y)))
```

## Edge Cases Tested

✅ Empty class definition ✅ Empty constructor ✅ Constructor with computation
✅ Method with no parameters ✅ Method with multiple parameters ✅ Method with
default parameters ✅ Method accessing instance properties ✅ Method calling
other methods ✅ Method returning self ✅ Method returning object literal ✅
Multiple independent instances ✅ Dynamic property addition ✅ Mutable and
immutable fields ✅ Nested expressions with this ✅ Computed properties

## Common Patterns

### 1. Simple Data Container

```lisp
(class Point
  (constructor [x y]
    (do
      (= this.x x)
      (= this.y y))))
```

### 2. State Manager

```lisp
(class Store
  (constructor []
    (= this.state {}))

  (fn setState [key value]
    (= this.state[key] value))

  (fn getState [key]
    (get this.state key)))
```

### 3. Service Class

```lisp
(class UserService
  (constructor [apiUrl]
    (= this.apiUrl apiUrl))

  (fn fetchUser [id]
    (fetch (+ this.apiUrl "/users/" id))))
```

### 4. Stateful Component

```lisp
(class Counter
  (var count 0)

  (constructor []
    (= this.count 0))

  (fn increment []
    (= this.count (+ this.count 1)))

  (fn getValue []
    this.count))
```

## Performance Considerations

**Instance Creation:**

- ✅ Lightweight ES6 class instances
- ✅ Constructor runs once per instance
- ✅ Methods shared via prototype

**Memory:**

- ✅ Methods not duplicated per instance
- ✅ Fields stored per instance
- ✅ Constants (let) can be optimized

**Best Practices:**

- Avoid complex computations in constructors
- Use methods for computed properties
- Share behavior via methods (prototype)
- Use field declarations for simple defaults

## Summary

HQL's class system provides:

- ✅ **Class definitions** (standard ES6 output)
- ✅ **Constructors** (single or multi-param)
- ✅ **Methods** (with this binding)
- ✅ **Fields** (var for mutable, let for immutable)
- ✅ **Property access** (dot notation)
- ✅ **Multiple instances** (independent state)
- ✅ **Default parameters** (optional method args)
- ✅ **Method chaining** (return self pattern)
- ✅ **Object literals** (complex return values)

Choose the right pattern:

- **Data models**: Constructor + getters
- **State management**: Methods mutating instance
- **Calculations**: Pure methods on immutable data
- **Services**: Methods using injected dependencies
- **Builders**: Fluent API with method chaining
