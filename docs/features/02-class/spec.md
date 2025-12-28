## Class: Object-Oriented Reference Type

Classes in HQL follow a more traditional object-oriented model. They allow
shared mutable state, can capture external values, and support advanced OOP
features such as inheritance.

### Definition

```lisp
(class Person
  ;; Field declarations using unified syntax
  (var name)         ;; mutable field (set in constructor)
  (var age)          ;; mutable field (set in constructor)
  (var score 0)        ;; mutable field with default value
  (const role "user")  ;; immutable field with default value

  ;; Constructor: initializes required fields, can override defaults
  (constructor [name age]
    (do
      (= this.name name)
      (= this.age age)
      ;; score and role use their default values (0 and "user")
      this))

  ;; Methods:
  (fn greet []
    (+ "Hello, " this.name))

  (fn celebrateBirthday [newAge]
    (do
      (= this.age newAge)
      this))
)
```

### Usage (Caller API)

```lisp
;; Instantiate a Person class
(let person (new Person "Alice" 30))

;; Field access:
(print (person.name))    ;; Output: "Alice"
(print (person.age))     ;; Output: 30

;; Method calls:
(print (person.greet))                 ;; Output: "Hello, Alice"
(print (person.celebrateBirthday 31))   ;; Updates age and returns the instance
(print (person.age))                   ;; Output: 31 (after birthday celebration)
```

**Features of Classes:**

- **Reference Semantics:** The same instance can be shared and mutated by
  multiple parts of your program.
- **Field Defaults:** Fields can have default values that are used when not set
  by the constructor.
- **Constructor Priority:** Constructor can override field defaults by
  explicitly setting fields with `=`.
- **Interoperability:** Classes can reference external values or variables (if
  desired) in their constructor or methods.
- **Inheritance & Polymorphism:** While not shown in this example, classes are
  designed to support subclassing and method overriding.
- **Unified Declaration:** The same `(var …)`, `(let …)`, and `(const …)` syntax
  is used for fields, keeping the language consistent with JavaScript semantics.

---

## Summary of the Class API

- **Construction:** Classes are created using `(new ClassName args...)` syntax,
  providing a uniform instantiation process.

- **Field Access via Dot Notation:** Access fields with dot notation:

  ```lisp
  (person.name)  ;; Accesses the name field
  ```

- **Method Invocation:** Methods are called the same way:

  ```lisp
  (person.greet)          ;; Calls the greet method
  (person.celebrateBirthday 31)  ;; Calls a method with arguments
  ```

- **Unified Field Declaration:** Using `(var ...)` and `(let ...)` for mutable
  fields, and `(const ...)` for immutable fields keeps the syntax consistent
  with JavaScript semantics.

---

This design provides a clear and intuitive API for object-oriented programming
in HQL, with reference semantics and support for traditional OOP features.#
HQL's Object-Oriented Programming Features

## Everything is an Object in HQL

In HQL, all values—including primitives like strings, numbers, and
booleans—behave like objects. This is achieved by leveraging JavaScript's
automatic boxing of primitive values, allowing method calls on any value.

### Primitive Values as Objects

```lisp
;; String methods
(print ("hello world" .toLowerCase .split " " .join "-"))
;; => "hello-world"

;; Number methods
(print (123.456 .toFixed 2))
;; => "123.46"

;; Boolean methods
(print (false .toString .toUpperCase))
;; => "FALSE"
```

### Collections as Objects

```lisp
;; Array methods
(print ([1, 2, 3, 4, 5]
  .filter (fn [n] (= (% n 2) 0))
  .map (fn [n] (* n 2))))
;; => [4, 8]

;; Object methods
(print (Object.keys person .map (fn [key] (.toUpperCase key))))
;; => ["NAME", "AGE", "ADDRESS"]
```

## Benefits of OOP in HQL

### 1. Method Chaining for Complex Operations

Method chaining allows for elegant composition of operations:

```lisp
;; Process text in a single expression
(print (text
  .trim
  .toLowerCase
  .replace "quick" "clever"
  .split " "
  .filter (fn [word] (> (length word) 3))
  .map (fn [word] (.toUpperCase word))
  .join "_"))
;; => "CLEVER_BROWN_JUMPS_OVER_LAZY"
```

### 2. Working with Collections

Object-oriented programming shines when working with collections:

```lisp
;; Group and summarize data
(print (users
  .filter (fn [user] (user .isActive))
  .groupBy (fn [user] (user .department))
  .map (fn [group] {
    "department": (group .key),
    "count": (group .value .length),
    "avgAge": (/ ((group .value .map (fn [u] (u .age))) .reduce (fn [a b] (+ a b)) 0)
              (group .value .length)),
    "names": ((group .value .map (fn [u] (u .name))) .join ", ")
  })))
```

### 3. Custom Classes and Methods

HQL supports defining custom classes with methods for domain-specific
functionality:

```lisp
;; Define a custom class with field defaults
(class Point
  (var x 0)  ;; Default to origin (0, 0)
  (var y 0)

  (constructor [initialX initialY]
    (do
      ;; Constructor overrides the default values
      (= this.x initialX)
      (= this.y initialY)))

  (fn distanceTo [otherPoint]
    (let (dx (- otherPoint.x this.x)
          dy (- otherPoint.y this.y))
      (Math.sqrt (+ (* dx dx) (* dy dy)))))

  (fn toString []
    (+ "Point(" this.x ", " this.y ")")))

;; Use the class and its methods
(var p1 (new Point 3 4))
(var p2 (new Point 6 8))

(print (p1 .toString))                ;; => "Point(3, 4)"
(print (p1 .distanceTo p2))           ;; => 5
```

### Field Defaults and Constructor Priority

HQL classes support field defaults that work seamlessly with constructor
initialization:

```lisp
(class Config
  (var host "localhost")  ;; Default values
  (var port 8080)
  (var debug false)

  (constructor [serverHost serverPort]
    (do
      ;; Constructor overrides the defaults
      (= this.host serverHost)
      (= this.port serverPort)
      ;; debug keeps its default value (false)
      )))

(var config (new Config "api.example.com" 443))
(print config.host)   ;; => "api.example.com" (overridden by constructor)
(print config.port)   ;; => 443 (overridden by constructor)
(print config.debug)  ;; => false (default value used)
```

**Execution Order:**

1. **Field defaults are set first**: All fields with default values are
   initialized
2. **Constructor runs second**: Can override any field using `=`
3. **Constructor has priority**: Any field set by the constructor overrides its
   default value

**Best Practice:** Use different names for constructor parameters when fields
have defaults (e.g., `serverHost` instead of `host`) to make the override
explicit and clear.

## Behind the Scenes: JavaScript's Object Model

HQL's object-oriented features leverage JavaScript's object model:

1. **Property Access**: When accessing properties like `object.property`, HQL
   generates code that accesses the property directly.

2. **Method Calls**: When calling methods like `object.method(args)`, HQL
   generates code that calls the method with the correct `this` binding.

3. **Primitive Boxing**: When calling methods on primitives, JavaScript
   automatically "boxes" the primitive value into a temporary object.

### Example: String Processing Internals

Consider this HQL expression:

```lisp
(text .trim .toUpperCase .split " ")
```

The generated JavaScript looks similar to:

```javascript
(() => {
  const _obj = text;

  // Handle .trim - could be property or method
  const _prop1 = _obj.trim;
  const _result1 = typeof _prop1 === "function" ? _prop1.call(_obj) : _prop1;

  // Handle .toUpperCase - could be property or method
  const _prop2 = _result1.toUpperCase;
  const _result2 = typeof _prop2 === "function"
    ? _prop2.call(_result1)
    : _prop2;

  // Handle .split with argument
  return _result2.split(" ");
})();
```

This demonstrates how HQL bridges functional and object-oriented paradigms by
generating JavaScript that preserves the semantics of both approaches.

## Practical Applications

### Data Processing Pipeline

```lisp
(fn processOrders [orders]
  (orders
    .filter (fn [order] (order .isActive))
    .map (fn [order] {
      "id": (order .id),
      "total": (order .items .reduce (fn [sum item] (+ sum (item .price))) 0),
      "date": (order .date .toLocaleDateString),
      "customer": (order .customer .name)
    })
    .sort (fn [a b] (- (b .total) (a .total)))
    .slice 0 10))
```

### UI Component Event Handling

```lisp
(button
  .addEventListener "click" (fn [event]
    (event .preventDefault)
    (form .validate)
    (form .submit)
    ((event .target) .setAttribute "disabled" "disabled")))
```

By combining functional programming with object-oriented features, HQL provides
a powerful, expressive language for modern application development.
