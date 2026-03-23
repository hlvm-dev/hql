# The HQL Programming Language

---

## Preface

HQL -- the High-Level Query Language -- is a programming language inspired by Swift and Clojure, compiling down to the JavaScript ecosystem.

HQL uses S-expression syntax -- the parenthesized notation that has powered Lisps for over sixty years -- but compiles to standard JavaScript that runs anywhere. It brings the functional elegance of Clojure -- lazy sequences, immutable-by-default data, a rich standard library built on the sequence abstraction -- together with Swift's emphasis on clarity and safety, all targeting the pragmatic JavaScript ecosystem. TypeScript types are first-class citizens, not an afterthought.

The core principle is homoiconicity: code is data, and data is code. Every HQL program is a data structure -- a nested list of symbols, numbers, strings, and other lists. This property, shared by all Lisps, enables macros that transform code as naturally as functions transform data. It makes metaprogramming not a special feature but a natural consequence of the language's design.

HQL is not a walled garden. It interoperates freely with JavaScript: you can call any JavaScript function, use any npm package, access browser APIs, or run on Deno and Node.js. The boundary between HQL and JavaScript is thin and permeable by design.

This book follows the tradition of Kernighan and Ritchie's *The C Programming Language*: it teaches by example, progresses from simple to complex, and respects the reader's intelligence. Part I is a tutorial introduction that covers the essential features through working programs. Parts II through IV cover the language in full detail: advanced features, the type system, macros, modules, JavaScript interop, and the standard library.

### Who This Book Is For

This book assumes you know how to program. Familiarity with JavaScript is helpful but not required -- HQL syntax is different enough that prior JavaScript knowledge is a convenience, not a prerequisite. If you know any programming language, you can learn HQL from this book.

If you have experience with Lisp, Clojure, or Scheme, much of the syntax will feel natural. If you come from Python, Ruby, or Java, the parenthesized notation may take a few hours to get used to. Either way, by the end of Chapter 3, the syntax will be second nature.

### Conventions

Throughout this book, HQL code examples use the language's S-expression syntax:

```lisp
;; This is an HQL comment using Lisp-style semicolons
(fn add [a b]
  (+ a b))
```

Where it aids understanding, the compiled JavaScript output is shown alongside:

```javascript
// Compiled JavaScript
function add(a, b) {
  return a + b;
}
```

The REPL prompt appears as `hlvm>` for interactive examples. Shell commands use `$` as the prompt.

---

## Part I: Tutorial Introduction

---

### Chapter 1: Getting Started

#### 1.1 Hello World

The first program in any language prints a greeting. In HQL:

```lisp
(print "Hello, World!")
```

This is a complete program. The outer parentheses delimit a function call. `print` is the function name. `"Hello, World!"` is the argument. In HQL, as in all Lisps, the operator always comes first, followed by its arguments.

To run this program, save it as `hello.hql` and execute:

```
$ hlvm run hello.hql
Hello, World!
```

Or evaluate it directly from the command line:

```
$ hlvm run -e '(print "Hello, World!")'
Hello, World!
```

The `print` function prints its argument followed by a newline -- it is shorthand for `console.log` in JavaScript. HQL also provides `print`, which behaves identically. Both are available globally without imports.

Let us look at a slightly more interesting program. This one converts a temperature from Fahrenheit to Celsius:

```lisp
;; fahrenheit.hql -- print Fahrenheit-Celsius table
(for [fahr 0 300 20]
  (let celsius (* (- fahr 32) (/ 5.0 9.0)))
  (print fahr "\t" celsius))
```

This introduces several features at once. The `for` loop iterates `fahr` from 0 to 300 in steps of 20. Inside the loop, `let` binds the name `celsius` to a computed value. The arithmetic operators `*`, `-`, and `/` follow prefix notation: `(- fahr 32)` means `fahr - 32`. The `print` call prints both values separated by a tab.

Several points about this program are worth noting. In HQL, all code lives inside S-expressions -- forms delimited by parentheses where the first element is the operator or function name. There are no infix operators: `a + b` is written `(+ a b)`. There are no curly braces for blocks: the structure of the code is defined by the parentheses themselves. And there is no statement/expression distinction: everything is an expression that returns a value.

#### 1.2 The REPL

HQL includes an interactive read-eval-print loop. Start it with:

```
$ hlvm repl
```

The REPL evaluates expressions as you type them:

```lisp
hlvm> (+ 1 2 3)
6

hlvm> (* 7 8)
56

hlvm> (print "Hello from the REPL!")
Hello from the REPL!
```

The REPL is the fastest way to experiment with the language. You can define functions, build data structures, and test ideas interactively:

```lisp
hlvm> (fn square [x] (* x x))

hlvm> (square 9)
81

hlvm> (map square [1 2 3 4 5])
(1 4 9 16 25)
```

Notice that `map` returns a lazy sequence, printed in parentheses rather than brackets. We will return to this distinction in Chapter 10.

#### 1.3 Running Programs

HQL programs are stored in files with the `.hql` extension. There are three ways to work with them:

**Run directly:**

```
$ hlvm run program.hql
```

This transpiles the program to JavaScript and executes it immediately.

**Compile to JavaScript:**

```
$ hlvm compile program.hql
```

This produces a `.js` file that can be run with any JavaScript runtime. For production builds, add the `--release` flag:

```
$ hlvm compile program.hql --release
```

**Evaluate an expression:**

```
$ hlvm run -e '(+ 40 2)'
42
```

This is convenient for one-liners and testing.

#### 1.4 Your First Functions

Functions are the primary building blocks of HQL programs. Here is a function that greets a person by name:

```lisp
(fn greet [name]
  (str "Hello, " name "!"))

(print (greet "World"))     ;; Hello, World!
(print (greet "Alice"))     ;; Hello, Alice!
```

The `fn` form declares a function. `greet` is the function name. `[name]` is the parameter list -- square brackets hold positional parameters. The body is `(str "Hello, " name "!")`, which concatenates three strings. The function implicitly returns the value of its last expression; no explicit `return` is needed.

Functions with multiple parameters work as you would expect:

```lisp
(fn add [a b]
  (+ a b))

(print (add 3 4))    ;; 7
```

You can write anonymous functions -- functions without names -- for use as arguments to higher-order functions:

```lisp
(map (fn [x] (* x x)) [1 2 3 4 5])
;; => (1 4 9 16 25)
```

And HQL provides a shorthand for the most common case -- a terse arrow lambda:

```lisp
(map (=> (* $0 $0)) [1 2 3 4 5])
;; => (1 4 9 16 25)
```

The `=>` form creates a compact anonymous function. `$0` refers to the first argument, `$1` to the second, and so on. This is especially useful in `map`, `filter`, and `reduce` pipelines.

#### 1.5 A Taste of Collections

HQL has three primary collection types, all expressed as literals in the source code.

**Vectors** (arrays) use square brackets:

```lisp
[1 2 3 4 5]
["apple" "banana" "cherry"]
[true false nil]
```

Elements are separated by whitespace. Commas are optional and treated as whitespace:

```lisp
[1, 2, 3]    ;; same as [1 2 3]
```

**Hash-maps** (objects) use curly braces:

```lisp
{name: "Alice" age: 30 city: "Seoul"}
```

The colon-style keys are the preferred HQL idiom. JSON-style quoted keys with commas are also supported:

```lisp
{"name": "Alice", "age": 30, "city": "Seoul"}
```

**Sets** use the `#[...]` literal:

```lisp
#[1 2 3 4 5]         ;; set of numbers
#["red" "green" "blue"]  ;; set of strings
```

These three collection types, along with the sequence abstraction that unifies them, form the backbone of data manipulation in HQL. We will explore them thoroughly in Chapters 9 and 10.

---

### Chapter 2: Lexical Elements

#### 2.1 Character Set and Encoding

HQL source files are UTF-8 encoded text. Identifiers, strings, and comments may contain any Unicode character. The language itself uses only ASCII for its syntax: parentheses, brackets, braces, and a small set of special characters.

#### 2.2 Comments

HQL supports three comment styles:

```lisp
// Single-line comment (JavaScript style)

/* Multi-line comment
   spanning several lines */

;; Lisp-style comment (idiomatic in HQL)
```

All three forms are equivalent. The `//` and `/* */` styles will be familiar to JavaScript and C programmers. The `;;` style follows Lisp convention and is preferred in idiomatic HQL code.

Comments extend from the comment marker to the end of the line (for `//` and `;;`) or to the closing `*/` (for block comments). They are stripped during parsing and have no effect on program execution.

```lisp
(+ 1 2)    ;; this adds one and two
(+ 1 2)    // this also adds one and two
```

#### 2.3 Identifiers

Identifiers in HQL follow Lisp conventions, which are broader than most languages. An identifier may contain:

- Letters (a-z, A-Z)
- Digits (0-9), but not as the first character
- Hyphens (`-`), underscores (`_`)
- Question marks (`?`), exclamation marks (`!`), asterisks (`*`)

The preferred naming convention is **kebab-case**:

```lisp
my-function         ;; kebab-case (preferred for functions/variables)
my-long-variable    ;; readable with hyphens
empty?              ;; predicate (returns boolean)
set!                ;; mutating operation
*dynamic-var*       ;; earmuff convention for dynamic variables
```

Classes and constructors use **PascalCase**:

```lisp
MyClass
BankAccount
HttpResponse
```

Private or internal names conventionally start with an underscore:

```lisp
_internal-helper
_private-state
```

Unlike most languages, hyphens in identifiers are not subtraction. The expression `my-function` is a single identifier; `(- my function)` is subtraction.

#### 2.4 Reserved Words

The following symbols have special meaning in HQL and cannot be used as variable names:

```
fn let var const def if cond when unless do
loop recur for for-of for-await-of while repeat
class new async await return throw try catch finally
import export macro match switch case default
=> & _ nil true false this
label break continue yield yield*
fn* async-fn* getter setter static
type deftype interface abstract-class namespace
const-enum declare fn-overload
```

Most of these will be familiar from JavaScript. The additions -- `fn`, `def`, `cond`, `loop`, `recur`, `macro`, `match`, `repeat`, `fn*` -- come from HQL's Lisp heritage.

#### 2.5 Literals

HQL supports the following literal types:

**Numbers:**

```lisp
42              ;; integer
3.14159         ;; floating point
-17             ;; negative
1e10            ;; scientific notation
0xFF            ;; hexadecimal
0o77            ;; octal
0b1010          ;; binary
123n            ;; BigInt (arbitrary precision)
```

All numbers are IEEE 754 double-precision floating point, as in JavaScript. BigInt literals end with `n` and support arbitrary precision integer arithmetic.

**Strings:**

```lisp
"hello"             ;; double-quoted string
"line1\nline2"      ;; escape sequences work
"tab\there"         ;; tab character
"quote: \""         ;; escaped double quote
```

Strings are always double-quoted. Single quotes are reserved for the `quote` form (see Chapter 10, on macros).

**Template literals:**

```lisp
`Hello, ${name}!`
`The sum is ${(+ a b)}.`
`Multi-line
template literal`
```

Template literals use backticks and support embedded expressions with `${}`, just as in JavaScript. Any HQL expression can appear inside the interpolation.

**Booleans:**

```lisp
true
false
```

**Nil:**

```lisp
nil       ;; equivalent to JavaScript's null
```

HQL uses `nil` where JavaScript uses `null`. The JavaScript value `undefined` is also available when needed for interop.

#### 2.6 Template Literals

Template literals deserve special attention because they bridge HQL expressions and string interpolation:

```lisp
(let name "World")
(let greeting `Hello, ${name}!`)
(print greeting)    ;; Hello, World!

;; Expressions inside template literals
(let x 10)
(let y 20)
(print `${x} + ${y} = ${(+ x y)}`)    ;; 10 + 20 = 30
```

Any valid HQL expression can appear inside `${}`. The expression is evaluated, converted to a string, and inserted into the template. Template literals compile directly to JavaScript template literals.

---

### Chapter 3: Types, Operators, and Expressions

#### 3.1 Data Types

HQL is dynamically typed -- variables can hold values of any type without declaration. The fundamental data types are:

| Type | Examples | JavaScript Equivalent |
|------|----------|----------------------|
| Number | `42`, `3.14`, `1e10` | `number` |
| BigInt | `123n`, `9999999999999999n` | `bigint` |
| String | `"hello"`, `` `template` `` | `string` |
| Boolean | `true`, `false` | `boolean` |
| Nil | `nil` | `null` |
| Undefined | `undefined` | `undefined` |
| Vector | `[1 2 3]` | `Array` |
| Hash-map | `{a: 1 b: 2}` | `Object` |
| Set | `#[1 2 3]` | `Set` |
| Function | `(fn [x] x)` | `Function` |

HQL also supports optional TypeScript type annotations for static checking (see Part III), but types are never required.

#### 3.2 Arithmetic Operators

All operators in HQL use prefix notation. The operator comes first, inside parentheses, followed by its operands:

```lisp
(+ 1 2)        ;; => 3        addition
(- 10 3)       ;; => 7        subtraction
(* 4 5)        ;; => 20       multiplication
(/ 15 3)       ;; => 5        division
(% 17 5)       ;; => 2        modulo (remainder)
(** 2 10)      ;; => 1024     exponentiation
```

Arithmetic operators are **variadic** -- they accept any number of arguments:

```lisp
(+ 1 2 3 4)    ;; => 10       chains left-to-right: ((1+2)+3)+4
(* 2 3 4)      ;; => 24       ((2*3)*4)
(- 10 3 2)     ;; => 5        ((10-3)-2)
```

With zero arguments, `+` returns the additive identity and `*` the multiplicative identity:

```lisp
(+)     ;; => 0
(*)     ;; => 1
```

With one argument, `+` is the unary plus operator and `-` is negation:

```lisp
(+ 5)   ;; => 5     (unary plus)
(- 5)   ;; => -5    (negation)
```

This variadic behavior means you can sum a list of numbers naturally:

```lisp
(apply + [1 2 3 4 5])    ;; => 15
```

#### 3.3 Comparison Operators

Comparison operators return boolean values:

```lisp
(=== 1 1)       ;; => true    strict equality (preferred)
(!== 1 2)       ;; => true    strict inequality
(< 3 5)         ;; => true    less than
(> 10 5)        ;; => true    greater than
(<= 5 5)        ;; => true    less than or equal
(>= 10 3)       ;; => true    greater than or equal
```

HQL also supports loose equality for JavaScript interop, though strict equality is strongly preferred:

```lisp
(== 1 "1")      ;; => true    loose equality (type coercion)
(!= 1 "2")      ;; => true    loose inequality
```

A critical distinction: `=` is **assignment** in HQL, not comparison. Use `===` for equality testing.

```lisp
(= x 10)        ;; assignment: x = 10
(=== x 10)      ;; comparison: x === 10
```

#### 3.4 Logical Operators

Logical operators support short-circuit evaluation:

```lisp
(and true true)     ;; => true
(and true false)    ;; => false
(or false true)     ;; => true
(or false false)    ;; => false
(not true)          ;; => false
(not false)         ;; => true
```

The JavaScript-style aliases `&&`, `||`, and `!` are also available:

```lisp
(&& true false)     ;; => false
(|| false true)     ;; => true
(! true)            ;; => false
```

Short-circuit evaluation means `and` stops at the first falsy value and `or` stops at the first truthy value, returning that value (not necessarily `true` or `false`):

```lisp
(and "hello" 42)        ;; => 42 (both truthy, returns last)
(and nil "hello")       ;; => nil (first is falsy, returns it)
(or nil "default")      ;; => "default" (first is falsy, tries second)
(or "found" "default")  ;; => "found" (first is truthy, returns it)
```

This behavior is identical to JavaScript's `&&` and `||` and is commonly used for default values and conditional execution.

#### 3.5 Bitwise Operators

Bitwise operators work on the integer representation of numbers:

```lisp
(& 0xFF 0x0F)    ;; => 15     bitwise AND
(| 0xF0 0x0F)    ;; => 255    bitwise OR
(^ 0xFF 0x0F)    ;; => 240    bitwise XOR
(~ 0)            ;; => -1     bitwise NOT
(<< 1 8)         ;; => 256    left shift
(>> -256 4)      ;; => -16    signed right shift
(>>> -1 24)      ;; => 255    unsigned right shift
```

#### 3.6 Assignment

Assignment uses the `=` operator:

```lisp
(let x 10)
(= x 20)        ;; x is now 20

;; Compound assignment operators
(+= x 5)        ;; x = x + 5
(-= x 3)        ;; x = x - 3
(*= x 2)        ;; x = x * 2
(/= x 4)        ;; x = x / 4
(%= x 3)        ;; x = x % 3
(**= x 2)       ;; x = x ** 2
```

#### 3.7 Logical Assignment

Logical assignment operators combine a logical test with assignment:

```lisp
(??= x 10)      ;; x = 10 only if x is null/undefined
(||= name "default")  ;; name = "default" only if name is falsy
(&&= x (getValue))    ;; x = getValue() only if x is truthy
```

These compile directly to their JavaScript equivalents (`??=`, `||=`, `&&=`).

#### 3.8 Nullish Coalescing and Optional Chaining

The nullish coalescing operator provides a default when a value is `null` or `undefined`:

```lisp
(?? name "Anonymous")        ;; name if not null/undefined, else "Anonymous"
(?? config.timeout 5000)     ;; config.timeout if set, else 5000
```

Optional chaining prevents errors when accessing properties of potentially null values:

```lisp
user?.name              ;; undefined if user is null, otherwise user.name
user?.address?.city     ;; safe nested access
(.?getName user)        ;; optional method call: user?.getName()
```

#### 3.9 Type Operators

HQL provides operators for runtime type checking:

```lisp
(typeof x)              ;; => "number", "string", "object", etc.
(instanceof obj Date)   ;; => true if obj is a Date
(in "name" obj)         ;; => true if obj has property "name"
(delete obj.temp)       ;; removes property from object
(void expr)             ;; evaluates expr, returns undefined
```

#### 3.10 Operator Precedence and First-Class Operators

In HQL, there is no operator precedence to memorize. Because every operation is a function call in prefix notation, evaluation order is always explicit:

```lisp
;; In JavaScript: 2 + 3 * 4 = 14 (multiplication first)
;; In HQL, you must be explicit:
(+ 2 (* 3 4))     ;; => 14
(* (+ 2 3) 4)     ;; => 20
```

The parentheses remove all ambiguity. This is one of the fundamental advantages of S-expression syntax: what you see is exactly what gets evaluated.

Operators are functions in HQL and can be used as values:

```lisp
(reduce + 0 [1 2 3 4 5])     ;; => 15
(reduce * 1 [1 2 3 4 5])     ;; => 120
(map (=> (+ $0 1)) [1 2 3])  ;; => (2 3 4)
```

---

### Chapter 4: Bindings and Scope

A **binding** associates a name with a value. HQL provides three binding forms with different scope and mutability characteristics, mirroring JavaScript's `let`, `const`, and `var`.

#### 4.1 let -- Block-Scoped Mutable Binding

`let` creates a block-scoped, mutable binding:

```lisp
(let x 10)
(print x)       ;; 10
(= x 20)          ;; reassignment is allowed
(print x)       ;; 20
```

`let` can also create a binding scope with a body -- the bindings exist only within the body, and the body's last expression is returned:

```lisp
;; Parenthesized binding pairs
(let (x 10 y 20)
  (+ x y))        ;; => 30

;; Clojure-style vector bindings
(let [x 10 y 20]
  (+ x y))        ;; => 30
```

Both forms bind `x` to 10 and `y` to 20, then evaluate `(+ x y)`. The bindings are not visible outside the body. This scoped form compiles to a JavaScript IIFE (immediately invoked function expression), ensuring proper lexical scoping.

When `let` appears without a body, it compiles to a plain JavaScript `let` declaration:

```lisp
(let x 10)    ;; compiles to: let x = 10;
```

#### 4.2 const/def -- Immutable Binding

`const` (or its alias `def`) creates an immutable binding:

```lisp
(const PI 3.14159)
(def TAU (* 2 PI))

;; (= PI 3.0)    ;; ERROR: cannot reassign const
```

In HQL, `const` goes further than JavaScript's `const`. Objects and arrays bound with `const` are **deep-frozen** using `Object.freeze`, making them truly immutable:

```lisp
(const config {host: "localhost" port: 8080})
;; config.host = "other"    ;; ERROR: cannot mutate frozen object

(const numbers [1 2 3])
;; (numbers.push 4)         ;; ERROR: cannot mutate frozen array
```

This deep immutability is enforced by a runtime helper `__hql_deepFreeze()` that recursively freezes all nested objects and arrays. It is a deliberate design choice: when you declare something constant, it should be truly constant.

#### 4.3 var -- Function-Scoped Mutable Binding

`var` creates a function-scoped, mutable binding with hoisting semantics, exactly like JavaScript's `var`:

```lisp
(var count 0)
(= count (+ count 1))
(print count)     ;; 1
```

Like `let`, `var` can take multiple binding pairs with a body:

```lisp
(var (x 10 y 20)
  (= x 100)
  (+ x y))          ;; => 120
```

In practice, prefer `let` or `const` over `var`. The `var` form exists for JavaScript compatibility and specific use cases where function-scoped hoisting is needed.

#### 4.4 Destructuring

Destructuring extracts values from collections into individual bindings. HQL supports both array and object destructuring.

**Array destructuring:**

```lisp
(let [a b c] [1 2 3])
(print a)    ;; 1
(print b)    ;; 2
(print c)    ;; 3
```

**With rest elements:**

```lisp
(let [first & rest] [1 2 3 4 5])
(print first)    ;; 1
(print rest)     ;; [2 3 4 5]
```

**Skipping elements:**

```lisp
(let [a _ c] [1 2 3])
(print a)    ;; 1
(print c)    ;; 3
```

**Object destructuring:**

```lisp
(let person {name: "Alice" age: 30})
(let {name age} person)
(print name)    ;; Alice
(print age)     ;; 30
```

**Default values:**

```lisp
(let [x (= 10)] [])      ;; x defaults to 10 (array is empty)
(let [a (= 1) b (= 2)] [42])  ;; a = 42, b = 2 (default)
```

**Nested destructuring:**

```lisp
(let [[a [b c]]] [[1 [2 3]]])
(print a)    ;; 1
(print b)    ;; 2
(print c)    ;; 3
```

Destructuring works everywhere bindings appear: in `let`, `const`, `var`, function parameters, and `for` loops.

#### 4.5 Scope Rules

HQL follows JavaScript's scoping rules:

- `let` and `const` are block-scoped: visible only within their enclosing block
- `var` is function-scoped: visible throughout the enclosing function, hoisted to the top
- Closures capture variables from enclosing scopes
- Inner scopes can shadow outer bindings

```lisp
(let x "outer")

(do
  (let x "inner")
  (print x))       ;; "inner"

(print x)           ;; "outer"
```

Closures capture variables by reference:

```lisp
(fn make-counter []
  (var count 0)
  (fn []
    (= count (+ count 1))
    count))

(let counter (make-counter))
(counter)    ;; => 1
(counter)    ;; => 2
(counter)    ;; => 3
```

When `let` or `var` appears with a body expression, HQL generates an IIFE to create the proper scope:

```lisp
(let (x 10 y 20) (+ x y))

;; Compiles to:
;; (() => { let x = 10; let y = 20; return x + y; })()
```

---

### Chapter 5: Control Flow

Every control flow construct in HQL is an **expression** -- it returns a value. There are no statements in HQL, only expressions. This fundamental property means you can use `if`, `cond`, and `match` anywhere a value is expected.

#### 5.1 if Expression

The `if` expression is the most basic conditional:

```lisp
(if condition
  then-expr
  else-expr)
```

It evaluates `condition`. If truthy, it evaluates and returns `then-expr`; otherwise, it evaluates and returns `else-expr`:

```lisp
(if (> x 0)
  "positive"
  "non-positive")

;; Use the result directly
(let label (if (> score 50) "pass" "fail"))
(print label)
```

Because `if` is an expression, it compiles to JavaScript's ternary operator `? :` when used in expression position:

```javascript
// Compiled JavaScript
const label = score > 50 ? "pass" : "fail";
```

The else branch is optional. Without it, a falsy condition returns `undefined`:

```lisp
(if (> x 0)
  (print "positive"))     ;; nothing happens if x <= 0
```

#### 5.2 Ternary Operator

The `?` form is an alias for `if`, useful when you want to emphasize the expression nature:

```lisp
(? (> age 18) "adult" "minor")
```

This is identical to `(if (> age 18) "adult" "minor")`.

#### 5.3 cond -- Multi-Way Conditional

When you need to test multiple conditions, `cond` is cleaner than nested `if` expressions:

```lisp
(cond
  ((< x 0) "negative")
  ((=== x 0) "zero")
  ((> x 0) "positive")
  (else "unknown"))
```

Each clause is a pair: a test expression in the first position and a result in the second. The clauses are evaluated top to bottom. The first clause whose test is truthy has its result returned. The `else` clause (if present) matches anything and serves as the default.

```lisp
(fn classify-temperature [temp]
  (cond
    ((< temp 0) "freezing")
    ((< temp 10) "cold")
    ((< temp 20) "cool")
    ((< temp 30) "warm")
    (else "hot")))

(classify-temperature 25)    ;; => "warm"
```

#### 5.4 when and unless

`when` executes a body of expressions only if a condition is true:

```lisp
(when (> x 0)
  (print "x is positive")
  (process x))
```

It accepts multiple body expressions -- all are executed when the condition holds. It returns the value of the last expression, or `undefined` if the condition is false.

`unless` is the opposite -- it executes when the condition is false:

```lisp
(unless (=== denominator 0)
  (/ numerator denominator))
```

#### 5.5 when-let and if-let

`when-let` combines a binding with a condition check. It binds a value and executes the body only if the value is truthy:

```lisp
(when-let [result (findUser id)]
  (print "Found user:" result.name)
  (processUser result))
```

This is equivalent to:

```lisp
(let result (findUser id))
(when result
  (print "Found user:" result.name)
  (processUser result))
```

`if-let` is similar but with an else branch:

```lisp
(if-let [user (findUser id)]
  (greet user)
  (print "User not found"))
```

#### 5.6 when-not and if-not

`when-not` executes the body when the condition is falsy:

```lisp
(when-not (isEmpty collection)
  (process collection))
```

`if-not` is `if` with the condition inverted:

```lisp
(if-not (isEmpty items)
  (first items)
  "no items")
```

#### 5.7 switch

The `switch` statement matches a value against specific cases:

```lisp
(switch status
  (case "active" (run))
  (case "waiting" (wait))
  (case "stopped" (cleanup))
  (default (error "Unknown status")))
```

Each `case` matches using strict equality (`===`). The `default` clause handles unmatched values. Unlike JavaScript, there is no fall-through between cases -- each case is independent. To opt into fall-through, use the `:fallthrough` keyword:

```lisp
(switch grade
  (case "A" :fallthrough)
  (case "B" (print "Good"))
  (default (print "Other")))
```

#### 5.8 case -- Clojure-Style Switch

The `case` form is a Clojure-inspired expression switch that matches a value and returns a result:

```lisp
(case day
  "Monday" "Start of week"
  "Friday" "Almost weekend"
  "Default day")                ;; last value without a test is default
```

This is more concise than `switch` for simple value matching and works well in expression position.

#### 5.9 do Block

The `do` block evaluates multiple expressions in sequence and returns the value of the last one:

```lisp
(do
  (print "step 1")
  (print "step 2")
  (+ 1 2))               ;; => 3
```

`do` is useful anywhere a single expression is expected but you need to perform multiple actions:

```lisp
(if (> x 0)
  (do
    (print "positive")
    (process x))
  (do
    (print "non-positive")
    (handleError x)))
```

---

### Chapter 6: Pattern Matching

Pattern matching is one of HQL's most powerful features. The `match` expression lets you destructure values and branch on their shape, combining the power of `switch`, `if`, and destructuring into a single, readable construct.

#### 6.1 The match Expression

The basic form:

```lisp
(match value
  (case pattern1 result1)
  (case pattern2 result2)
  (default fallback))
```

The value is evaluated once, then tested against each pattern in order. The first matching pattern has its result evaluated and returned. If no pattern matches and there is no `default`, an error is thrown.

#### 6.2 Literal Patterns

The simplest patterns match literal values using strict equality:

```lisp
(match x
  (case 1 "one")
  (case 2 "two")
  (case 3 "three")
  (default "something else"))
```

String, number, boolean, and `null` literals are all valid patterns:

```lisp
(match response.status
  (case 200 "OK")
  (case 404 "Not Found")
  (case 500 "Server Error")
  (default "Unknown"))
```

#### 6.3 Wildcard and Binding Patterns

The wildcard pattern `_` matches any value and ignores it:

```lisp
(match x
  (case 0 "zero")
  (case _ "not zero"))
```

A symbol pattern also matches any value but **binds** it to a variable:

```lisp
(match x
  (case 0 "zero")
  (case n (str "got: " n)))     ;; n is bound to x's value
```

Here, if `x` is 0, the result is `"zero"`. Otherwise, `n` is bound to whatever `x` is, and the body `(str "got: " n)` is evaluated with that binding.

#### 6.4 Array Patterns

Array patterns match arrays by shape and bind their elements:

```lisp
(match point
  (case [0, 0] "origin")
  (case [x, 0] (str "on x-axis at " x))
  (case [0, y] (str "on y-axis at " y))
  (case [x, y] (str "at (" x ", " y ")")))
```

The array pattern `[0, 0]` matches a two-element array where both elements are 0. The pattern `[x, 0]` matches a two-element array where the second element is 0, binding the first to `x`.

**Rest patterns** capture remaining elements:

```lisp
(match items
  (case [] "empty")
  (case [only] (str "just " only))
  (case [first, & rest] (str first " and " (count rest) " more")))
```

The `& rest` in `[first, & rest]` captures all elements after the first into a `rest` array.

#### 6.5 Object Patterns

Object patterns match objects by their keys:

```lisp
(match user
  (case {name: n, age: a} (str n " is " a " years old"))
  (default "Unknown user"))
```

The pattern `{name: n, age: a}` matches any object that has both `name` and `age` properties, binding their values to `n` and `a`.

#### 6.6 Or-Patterns

Or-patterns match any of several values:

```lisp
(match status-code
  (case (| 200 201 204) "success")
  (case (| 400 401 403 422) "client error")
  (case (| 500 502 503) "server error")
  (default "unknown"))
```

The `(| ...)` pattern matches if the value equals any of the listed alternatives. This is much more concise than writing separate cases for each value.

#### 6.7 Guard Clauses

Guards add an additional condition to a pattern:

```lisp
(match n
  (case x (if (> x 0)) "positive")
  (case x (if (< x 0)) "negative")
  (default "zero"))
```

The guard `(if (> x 0))` is checked after the pattern matches. If the guard fails, the match continues to the next clause.

Guards are useful for refining pattern matches:

```lisp
(match user
  (case {name: n, age: a} (if (>= a 18))
    (str n " is an adult"))
  (case {name: n, age: a}
    (str n " is a minor")))
```

#### 6.8 How Pattern Matching Compiles

Pattern matching compiles to an efficient chain of `if/else` statements with runtime type checks. The value is evaluated once and bound to a temporary variable. Each pattern generates appropriate checks:

| Pattern | Runtime Check |
|---------|--------------|
| Literal | `=== literal` |
| `null` | `=== null` |
| `_` | (always matches) |
| Symbol | (always matches, creates binding) |
| `[...]` | `Array.isArray(v) && v.length === n` |
| `[... & r]` | `Array.isArray(v) && v.length >= k` |
| `{...}` | `typeof v === "object" && v !== null && keys exist` |
| `(| ...)` | `v === p1 || v === p2 || ...` |

This compilation strategy means pattern matching has no runtime overhead beyond the equivalent hand-written conditionals.

---

### Chapter 7: Functions

Functions are the heart of HQL. Like all Lisps, HQL treats functions as first-class values: they can be passed as arguments, returned from other functions, stored in data structures, and created dynamically.

#### 7.1 Named Functions

A named function is declared with `fn`:

```lisp
(fn add [a b]
  (+ a b))

(add 3 4)    ;; => 7
```

The general form is `(fn name [params] body)`. The function body may contain multiple expressions; the value of the last expression is implicitly returned:

```lisp
(fn describe [name age]
  (let title (if (>= age 18) "Mr./Ms." "Young"))
  (str title " " name ", age " age))

(describe "Alice" 30)    ;; => "Mr./Ms. Alice, age 30"
```

#### 7.2 Anonymous Functions

Functions without names are useful as arguments to higher-order functions:

```lisp
(map (fn [x] (* x x)) [1 2 3 4])
;; => (1 4 9 16)

(filter (fn [x] (> x 3)) [1 2 3 4 5])
;; => (4 5)

(reduce (fn [acc x] (+ acc x)) 0 [1 2 3 4 5])
;; => 15
```

#### 7.3 Arrow Lambdas

The `=>` form creates concise anonymous functions for common patterns:

```lisp
;; Implicit parameters: $0, $1, $2...
(map (=> (* $0 2)) [1 2 3])        ;; => (2 4 6)
(filter (=> (> $0 3)) [1 2 3 4 5]) ;; => (4 5)
(reduce (=> (+ $0 $1)) 0 [1 2 3])  ;; => 6

;; Property access
(map (=> $0.name) users)            ;; extract name from each user

;; Explicit parameters
(map (=> [x] (* x x)) [1 2 3])     ;; => (1 4 9)
((=> [x y] (+ x y)) 5 7)           ;; => 12
```

The arrow lambda automatically determines the arity from the highest `$N` parameter used. `(=> (* $0 2))` takes one argument. `(=> (+ $0 $1))` takes two.

#### 7.4 Multi-Arity Functions

A function can have multiple implementations that dispatch based on argument count:

```lisp
(fn greet
  ([] "Hello!")
  ([name] (str "Hello, " name "!"))
  ([first last] (str "Hello, " first " " last "!")))

(greet)                ;; => "Hello!"
(greet "Alice")        ;; => "Hello, Alice!"
(greet "Alice" "Smith") ;; => "Hello, Alice Smith!"
```

Each clause is `([params] body)`. The runtime dispatches based on `arguments.length`. This is a powerful alternative to optional parameters when different arities require genuinely different logic.

Multi-arity works with all function types:

```lisp
;; Async multi-arity
(async fn fetch-data
  ([url] (await (fetch-data url {})))
  ([url opts] (await (js/fetch url opts))))

;; Generator multi-arity
(fn* range-gen
  ([end] (yield* (range-gen 0 end)))
  ([start end]
    (var i start)
    (while (< i end)
      (yield i)
      (= i (+ i 1)))))
```

#### 7.5 Positional Parameters

The standard parameter style uses square brackets for ordered parameters:

```lisp
(fn calculate [a b op]
  (cond
    ((=== op "add") (+ a b))
    ((=== op "sub") (- a b))
    ((=== op "mul") (* a b))
    (else (/ a b))))
```

#### 7.6 Map Parameters

For functions with many optional parameters, use map parameters with default values:

```lisp
(fn connect {host: "localhost" port: 8080 ssl: false}
  (let protocol (if ssl "https" "http"))
  (str protocol "://" host ":" port))

(connect)                              ;; => "http://localhost:8080"
(connect {port: 3000})                 ;; => "http://localhost:3000"
(connect {host: "api.com" ssl: true})  ;; => "https://api.com:8080"
```

All map parameters must have defaults. The caller passes a map to override specific values.

#### 7.7 Rest Parameters

The `&` symbol in a parameter list captures remaining arguments into an array:

```lisp
(fn sum [& nums]
  (reduce + 0 nums))

(sum 1 2 3 4 5)    ;; => 15

(fn log [level & messages]
  (print level ":" messages))

(log "INFO" "server" "started" "on" "port" 8080)
```

#### 7.8 Default Values

Parameters can have default values:

```lisp
(fn greet [name = "World"]
  (str "Hello, " name "!"))

(greet)          ;; => "Hello, World!"
(greet "Alice")  ;; => "Hello, Alice!"

(fn repeat-str [s = "x" n = 3]
  (let result "")
  (for [i 0 n]
    (= result (str result s)))
  result)

(repeat-str)           ;; => "xxx"
(repeat-str "ab")      ;; => "ababab"
(repeat-str "hi" 2)    ;; => "hihi"
```

#### 7.9 Destructuring in Parameters

Function parameters support the same destructuring as `let` bindings:

```lisp
;; Array destructuring
(fn swap [[a b]]
  [b a])

(swap [1 2])    ;; => [2 1]

;; Object destructuring
(fn greet-user [{name age}]
  (str name " is " age))

(greet-user {name: "Alice" age: 30})    ;; => "Alice is 30"

;; Nested destructuring
(fn process [[a [b c]]]
  (+ a b c))

(process [1 [2 3]])    ;; => 6
```

#### 7.10 Type Annotations

Functions can have TypeScript type annotations for parameters and return values:

```lisp
;; Parameter types (NO SPACE after colon)
(fn add [a:number b:number] :number
  (+ a b))

;; Union types
(fn handle [value:string|number] :void
  (print value))

;; Generic type parameters
(fn identity<T> [x:T] :T
  x)

;; Return type with arrow syntax
(fn parse [s:string] -> number
  (parseInt s 10))
```

Type annotations are optional and compile to TypeScript type annotations. They are checked at compile time but do not affect runtime behavior.

#### 7.11 defn

`defn` is an alias for `fn`, provided as a convenience for the REPL where it ensures the function is registered in the session:

```lisp
(defn add [a b]
  (+ a b))

;; identical to:
(fn add [a b]
  (+ a b))
```

#### 7.12 Pure Functions (fx)

The `fx` form declares a function as pure, with compile-time enforcement:

```lisp
(fx add [a b]
  (+ a b))          ;; OK: pure computation

(fx impure [x]
  (print x)       ;; ERROR: print is impure (I/O side effect)
  x)
```

Pure functions cannot perform I/O, mutate state, throw exceptions, or call impure functions. The compiler statically verifies these constraints. Pure functions enable safe optimizations like memoization and parallel execution.

Parameters can be annotated with `:pure` to require pure callbacks:

```lisp
(fx map-pure [f:pure items]
  (map f items))

(map-pure (fx [x] (* x 2)) [1 2 3])    ;; OK
(map-pure (fn [x] (print x)) [1 2 3]) ;; ERROR: impure callback
```

---

### Chapter 8: Loops and Recursion

HQL provides both imperative loops (familiar to JavaScript programmers) and functional recursion (from its Lisp heritage). The two styles can be mixed freely.

#### 8.1 loop/recur -- Tail-Call Optimized Recursion

The `loop`/`recur` construct is HQL's primary recursion mechanism, directly inspired by Clojure. It provides a way to write recursive algorithms that compile to efficient iterative loops:

```lisp
;; Sum numbers from 0 to n
(loop [i 0 sum 0]
  (if (> i 10)
    sum
    (recur (+ i 1) (+ sum i))))
;; => 55
```

`loop` establishes named bindings (here, `i` starts at 0 and `sum` starts at 0). `recur` jumps back to the top of the loop with new values for those bindings. This compiles to a `while(true)` loop with destructuring assignment -- no stack frames are consumed.

Here is factorial using `loop`/`recur`:

```lisp
(loop [n 5 acc 1]
  (if (<= n 1)
    acc
    (recur (- n 1) (* acc n))))
;; => 120
```

The compiled JavaScript is a clean `while` loop:

```javascript
let n = 5, acc = 1;
while (true) {
  if (n <= 1) return acc;
  [n, acc] = [n - 1, n * acc];
}
```

You can also use tail recursion in named functions. When HQL detects that all recursive calls are in tail position, it automatically optimizes them to a while loop:

```lisp
(fn factorial [n acc]
  (if (<= n 1)
    acc
    (factorial (- n 1) (* n acc))))
```

This compiles to the same efficient while loop. No explicit `loop`/`recur` is needed.

#### 8.2 Mutual Tail-Call Optimization

HQL can optimize mutually recursive functions -- functions that call each other in tail position. It uses a trampoline transformation:

```lisp
(fn is-even [n]
  (if (=== n 0) true (is-odd (- n 1))))

(fn is-odd [n]
  (if (=== n 0) false (is-even (- n 1))))

(is-even 10000)    ;; => true (no stack overflow)
```

Without optimization, this would overflow the stack for large `n`. HQL detects the mutual recursion using Tarjan's algorithm to find strongly connected components in the call graph, then transforms the functions to return thunks that are unwound by a trampoline at the call site.

#### 8.3 while

The `while` loop is the simplest imperative loop:

```lisp
(var count 0)
(while (< count 5)
  (print count)
  (= count (+ count 1)))
;; prints 0 1 2 3 4
```

#### 8.4 for

HQL's `for` loop is a range-based iteration construct:

```lisp
;; One argument: 0 to n-1
(for [i 3]
  (print i))
;; prints 0, 1, 2

;; Two arguments: start to end-1
(for [i 5 8]
  (print i))
;; prints 5, 6, 7

;; Three arguments: start to end-1 by step
(for [i 0 10 2]
  (print i))
;; prints 0, 2, 4, 6, 8
```

#### 8.5 for-of

`for-of` iterates over any iterable (arrays, strings, sets, generators, etc.):

```lisp
(for-of [item ["apple" "banana" "cherry"]]
  (print item))

(for-of [char "hello"]
  (print char))

(for-of [n (range 0 5)]
  (print n))
```

#### 8.6 repeat

`repeat` executes a body a fixed number of times:

```lisp
(repeat 5
  (print "hello"))
;; prints "hello" 5 times
```

For iteration with an index variable, use `for`:

```lisp
(for [i 5]
  (print "iteration" i))
```

#### 8.7 Labels, break, and continue

Labels provide targets for `break` and `continue` in nested loops:

```lisp
(label outer
  (for [i 0 10]
    (for [j 0 10]
      (when (=== (* i j) 42)
        (print "Found:" i j)
        (break outer)))))
```

Without a label, `break` and `continue` affect the innermost loop:

```lisp
(for [i 0 10]
  (when (=== (% i 2) 0)
    (continue))            ;; skip even numbers
  (when (> i 7)
    (break))               ;; stop at 7
  (print i))
;; prints 1, 3, 5, 7
```

---

### Chapter 9: Collections and Data Structures

HQL has three primary collection types that cover the vast majority of data modeling needs: vectors, hash-maps, and sets. All three have literal syntax and work uniformly with the standard library functions.

#### 9.1 Vectors (Arrays)

Vectors are ordered, indexed collections -- JavaScript arrays with HQL syntax:

```lisp
;; Literal syntax
[1 2 3 4 5]
["hello" "world"]
[true 42 "mixed" nil]

;; Constructor form
(vector 1 2 3)

;; Nested
[[1 2] [3 4] [5 6]]
```

Elements are separated by whitespace. Commas are optional and treated as whitespace:

```lisp
[1, 2, 3]    ;; same as [1 2 3]
```

**Accessing elements:**

```lisp
(let v [10 20 30 40 50])

(get v 0)        ;; => 10
(get v 2)        ;; => 30
(get v 10 "x")   ;; => "x" (default when out of bounds)

(first v)        ;; => 10
(rest v)         ;; => (20 30 40 50)  (lazy sequence)
(nth v 3)        ;; => 40
(last v)         ;; => 50
(count v)        ;; => 5
```

**Building vectors:**

```lisp
(conj [1 2 3] 4)       ;; => [1 2 3 4]
(concat [1 2] [3 4])   ;; => (1 2 3 4) (lazy sequence)
(vec (range 5))         ;; => [0 1 2 3 4] (realize to vector)
```

Note that `rest` and `concat` return lazy sequences (shown in parentheses), not vectors. Use `vec` to convert back to a vector when needed. This laziness is by design -- see Chapter 10.

#### 9.2 Hash-Maps (Objects)

Hash-maps are unordered key-value collections -- JavaScript objects with HQL syntax:

```lisp
;; Lisp-style (preferred)
{name: "Alice" age: 30 city: "Seoul"}

;; JSON-style
{"name": "Alice", "age": 30, "city": "Seoul"}

;; Constructor form
(hash-map "name" "Alice" "age" 30)

;; Nested
{user: {name: "Alice" address: {city: "Seoul" zip: "06100"}}}
```

**Accessing values:**

```lisp
(let person {name: "Alice" age: 30})

(get person "name")       ;; => "Alice"
(get person "missing")    ;; => undefined
(get person "missing" 0)  ;; => 0 (with default)

person.name               ;; => "Alice" (dot notation)
person.age                ;; => 30
```

**Modifying maps:**

```lisp
;; assoc adds or updates keys
(assoc person "job" "Engineer")
;; => {name: "Alice", age: 30, job: "Engineer"}

;; dissoc removes keys
(dissoc person "age")
;; => {name: "Alice"}

;; Extracting keys and values
(keys person)    ;; => ["name", "age"]
(vals person)    ;; => ["Alice", 30]
```

**Merging maps:**

```lisp
(let defaults {host: "localhost" port: 8080 debug: false})
(let overrides {port: 3000 debug: true})
(merge defaults overrides)
;; => {host: "localhost", port: 3000, debug: true}
```

#### 9.3 Sets

Sets are unordered collections of unique values:

```lisp
;; Literal syntax
#[1 2 3 4 5]
#["red" "green" "blue"]

;; Constructor form
(hash-set 1 2 3)

;; Duplicates are automatically removed
#[1 1 2 2 3 3]    ;; => #[1 2 3]
```

Sets support standard set operations and are useful for membership testing, deduplication, and set algebra.

```lisp
(let colors #["red" "green" "blue"])

;; Membership test
(colors.has "red")       ;; => true
(colors.has "yellow")    ;; => false

;; Set operations via standard library
(let a #[1 2 3 4])
(let b #[3 4 5 6])
;; Use filter/some for intersection-like operations
(filter (=> (b.has $0)) (vec a))    ;; => (3 4)
```

#### 9.4 Constructor Forms

Each collection type has a constructor function:

```lisp
(vector 1 2 3)              ;; => [1 2 3]
(hash-map "a" 1 "b" 2)      ;; => {a: 1, b: 2}
(hash-set 1 2 3)             ;; => #[1 2 3]
```

These are useful when building collections dynamically or from computed values.

#### 9.5 Collection Access

All collections support a uniform access interface:

```lisp
;; get works on vectors, maps, and sets
(get [10 20 30] 1)           ;; => 20
(get {a: 1 b: 2} "a")       ;; => 1
(get #[1 2 3] 2)             ;; => 2

;; first/rest work on any sequence
(first [1 2 3])              ;; => 1
(first {a: 1 b: 2})         ;; => ["a" 1] (first entry)
(rest [1 2 3])               ;; => (2 3)

;; nth for indexed access
(nth [10 20 30] 2)           ;; => 30
```

#### 9.6 Spread Operator

HQL supports the spread operator for merging and copying collections:

```lisp
;; Array spread
(let a [1 2 3])
(let b [0 ...a 4])          ;; => [0 1 2 3 4]

;; Object spread
(let base {x: 1 y: 2})
(let extended {...base z: 3})  ;; => {x: 1, y: 2, z: 3}

;; Combining arrays
(let combined [...arr1 ...arr2])

;; Override with spread
(let updated {...config port: 9090})
```

---

### Chapter 10: The Sequence Abstraction

The sequence abstraction is the most powerful idea in HQL -- and one of the most powerful in all of programming. Borrowed from Clojure, which in turn borrowed it from the deep tradition of Lisp, it unifies all collections under a single interface and enables lazy, composable data processing pipelines.

#### 10.1 The Lisp Trinity

Three operations form the foundation of all sequence processing:

```lisp
(first [1 2 3])        ;; => 1          the first element
(rest [1 2 3])         ;; => (2 3)      everything except the first
(cons 0 [1 2 3])       ;; => (0 1 2 3)  construct a new sequence
```

With just `first`, `rest`, and `cons`, you can build every sequence operation: `map`, `filter`, `reduce`, `take`, `drop`, `concat`, `flatten`, `distinct`, `partition`, and dozens more. This is not an exaggeration -- HQL's standard library is built this way, with most functions implemented in HQL itself.

Here is `map` expressed in terms of the trinity:

```lisp
(fn my-map [f coll]
  (lazy-seq
    (when-let [s (seq coll)]
      (cons (f (first s)) (my-map f (rest s))))))
```

And `filter`:

```lisp
(fn my-filter [pred coll]
  (lazy-seq
    (when-let [s (seq coll)]
      (if (pred (first s))
        (cons (first s) (my-filter pred (rest s)))
        (my-filter pred (rest s))))))
```

Both are recursive, both are lazy, and both work on any collection type. This is the power of the abstraction.

#### 10.2 The seq Protocol

Any collection can become a sequence by implementing the seq protocol. The `seq` function converts a collection to a sequence, or returns `nil` for empty collections (this behavior is called **nil-punning**):

```lisp
(seq [1 2 3])         ;; => sequence of 1, 2, 3
(seq [])              ;; => nil (empty)
(seq "hello")         ;; => sequence of "h", "e", "l", "l", "o"
(seq {a: 1 b: 2})    ;; => sequence of entries
(seq nil)             ;; => nil
```

Nil-punning is a crucial idiom: when a sequence is exhausted, `seq` returns `nil`, which is falsy. This allows elegant termination conditions:

```lisp
(when-let [s (seq coll)]
  ;; s is the non-empty sequence
  (process (first s))
  (recurse (rest s)))
```

#### 10.3 Lazy Sequences

Most sequence operations in HQL return lazy sequences -- sequences whose elements are computed on demand, not all at once. The `lazy-seq` form creates a lazy sequence:

```lisp
(lazy-seq
  (cons 1 (lazy-seq
    (cons 2 (lazy-seq
      (cons 3 nil))))))
;; => (1 2 3) -- but each element computed only when needed
```

Laziness is what makes infinite sequences possible and what makes operations like `map` and `filter` efficient when combined with `take`:

```lisp
;; Without laziness, this would be infinite:
(take 5 (map (=> (* $0 $0)) (range)))
;; => (0 1 4 9 16)

;; Only 5 elements are actually computed
```

Lazy sequences are memoized: once an element is computed, the result is cached. Subsequent access returns the cached value without re-computation.

#### 10.4 Delay and Force

`delay` wraps a computation that will be evaluated at most once, when `force` is called:

```lisp
(def expensive-result
  (delay
    (print "Computing...")
    (* 42 42)))

;; Nothing printed yet

(force expensive-result)
;; prints "Computing..."
;; => 1764

(force expensive-result)
;; nothing printed (cached)
;; => 1764
```

`delay` is the building block of lazy sequences. Each thunk in a lazy sequence is essentially a delayed computation.

#### 10.5 map, filter, and reduce

These three higher-order functions are the workhorses of data transformation:

**map** applies a function to each element:

```lisp
(map inc [1 2 3])              ;; => (2 3 4)
(map (=> (* $0 2)) [1 2 3])    ;; => (2 4 6)
(map str [1 2 3])              ;; => ("1" "2" "3")
```

**filter** selects elements matching a predicate:

```lisp
(filter even? [1 2 3 4 5 6])     ;; => (2 4 6)
(filter (=> (> $0 3)) [1 2 3 4 5]) ;; => (4 5)
```

**reduce** combines elements into a single value:

```lisp
(reduce + 0 [1 2 3 4 5])      ;; => 15
(reduce * 1 [1 2 3 4 5])      ;; => 120
(reduce str "" ["a" "b" "c"]) ;; => "abc"
```

`reduce` takes an initial accumulator value, a combining function, and a collection. The function is called with the accumulator and each element in turn:

```lisp
(reduce
  (fn [acc x] (assoc acc x (* x x)))
  {}
  [1 2 3 4])
;; => {1: 1, 2: 4, 3: 9, 4: 16}
```

Both `map` and `filter` return lazy sequences. `reduce` is eager -- it consumes the entire sequence.

#### 10.6 take, drop, concat, and flatten

These functions shape sequences:

```lisp
;; take: first n elements
(take 3 [1 2 3 4 5])          ;; => (1 2 3)
(take 3 (range))               ;; => (0 1 2) -- from infinite sequence!

;; drop: skip n elements
(drop 2 [1 2 3 4 5])          ;; => (3 4 5)

;; concat: join sequences
(concat [1 2] [3 4] [5 6])    ;; => (1 2 3 4 5 6)

;; flatten: remove nesting
(flatten [[1 2] [3 [4 5]]])   ;; => (1 2 3 4 5)
```

All are lazy -- they return lazy sequences and compose efficiently:

```lisp
(take 5 (drop 100 (range)))
;; => (100 101 102 103 104)
;; Only computes 105 values, not infinity
```

#### 10.7 Infinite Sequences

Because sequences are lazy, HQL can represent infinite data:

```lisp
;; range with no arguments: 0, 1, 2, 3, ...
(take 5 (range))             ;; => (0 1 2 3 4)

;; repeat: infinite repetition
(take 4 (repeat "hello"))    ;; => ("hello" "hello" "hello" "hello")

;; cycle: infinite cycling
(take 7 (cycle [1 2 3]))     ;; => (1 2 3 1 2 3 1)

;; iterate: apply function repeatedly
(take 5 (iterate inc 0))     ;; => (0 1 2 3 4)
(take 8 (iterate (=> (* $0 2)) 1)) ;; => (1 2 4 8 16 32 64 128)
```

These are building blocks for elegant algorithms:

```lisp
;; Fibonacci sequence
(fn fibs []
  (let [fib (fn [a b]
              (lazy-seq (cons a (fib b (+ a b)))))]
    (fib 0 1)))

(take 10 (fibs))
;; => (0 1 1 2 3 5 8 13 21 34)

;; Powers of two
(take 10 (iterate (=> (* $0 2)) 1))
;; => (1 2 4 8 16 32 64 128 256 512)
```

The key insight is that lazy sequences let you **separate the description of data from the consumption of data**. You define what the sequence looks like (potentially infinite), then use `take`, `filter`, or other operations to consume only what you need. This separation makes programs clearer and often faster.

#### 10.8 Transducers

Transducers are composable algorithmic transformations that are independent of the context of their input and output. They compose directly, without creating intermediate sequences:

```lisp
;; Without transducers: creates intermediate lazy sequences
(->> [1 2 3 4 5 6 7 8 9 10]
     (map inc)
     (filter even?)
     (take 3))
;; => (2 4 6)

;; With transducers: no intermediate allocations
(transduce
  (comp (map inc) (filter even?) (take 3))
  conj
  []
  [1 2 3 4 5 6 7 8 9 10])
;; => [2 4 6]
```

The `comp` function composes transducers left-to-right (opposite to normal function composition). Each transducer is a function that transforms a reducing function into another reducing function.

```lisp
;; Transducers are reusable
(def xform (comp (map inc) (filter even?)))

(transduce xform + 0 [1 2 3 4 5])       ;; => 12 (sum of 2, 4, 6)
(transduce xform conj [] [1 2 3 4 5])    ;; => [2 4 6]
```

Transducers are an advanced topic. For most programs, the lazy sequence operations (`map`, `filter`, `take`, etc.) are sufficient and more readable. Transducers become valuable in performance-critical code where you need to eliminate intermediate sequence allocations.

The standard library provides many more sequence operations beyond those shown here. A selection:

| Function | Description | Example |
|----------|-------------|---------|
| `map` | Transform each element | `(map inc [1 2 3])` => `(2 3 4)` |
| `filter` | Keep matching elements | `(filter even? [1 2 3 4])` => `(2 4)` |
| `reduce` | Fold into single value | `(reduce + 0 [1 2 3])` => `6` |
| `take` | First n elements | `(take 3 (range))` => `(0 1 2)` |
| `drop` | Skip first n elements | `(drop 2 [1 2 3 4])` => `(3 4)` |
| `take-while` | Take while predicate holds | `(take-while odd? [1 3 5 4 6])` => `(1 3 5)` |
| `drop-while` | Drop while predicate holds | `(drop-while odd? [1 3 5 4 6])` => `(4 6)` |
| `concat` | Join sequences | `(concat [1 2] [3 4])` => `(1 2 3 4)` |
| `flatten` | Remove nesting | `(flatten [[1] [2 3]])` => `(1 2 3)` |
| `distinct` | Remove duplicates | `(distinct [1 1 2 2 3])` => `(1 2 3)` |
| `interpose` | Insert between elements | `(interpose ", " ["a" "b" "c"])` => `("a" ", " "b" ", " "c")` |
| `interleave` | Interleave two sequences | `(interleave [1 2 3] ["a" "b" "c"])` => `(1 "a" 2 "b" 3 "c")` |
| `partition` | Group into fixed-size chunks | `(partition 2 [1 2 3 4])` => `((1 2) (3 4))` |
| `partition-by` | Group by predicate changes | `(partition-by even? [1 3 2 4 5])` => `((1 3) (2 4) (5))` |
| `mapcat` | Map then concatenate | `(mapcat (=> [$0 (* $0 $0)]) [1 2 3])` => `(1 1 2 4 3 9)` |
| `some` | First truthy predicate result | `(some even? [1 3 4 5])` => `true` |
| `every` | All elements match | `(every even? [2 4 6])` => `true` |
| `zipmap` | Combine keys and values | `(zipmap ["a" "b"] [1 2])` => `{a: 1, b: 2}` |
| `group-by` | Group by key function | `(group-by even? [1 2 3 4])` => `{false: [1 3], true: [2 4]}` |
| `sort-by` | Sort by key function | `(sort-by count ["bb" "a" "ccc"])` => `("a" "bb" "ccc")` |
| `reverse` | Reverse a sequence | `(reverse [1 2 3])` => `(3 2 1)` |

The power of the sequence abstraction lies in composition. Because every function takes a sequence and returns a sequence, they chain naturally:

```lisp
;; Find the top 3 most expensive items under $100
(->> inventory
     (filter (=> (< $0.price 100)))
     (sort-by (=> $0.price))
     (reverse)
     (take 3)
     (map (=> $0.name)))
```

The threading macro `->>` pipes the result of each expression into the last argument of the next. This reads top-to-bottom, left-to-right -- a natural data processing pipeline.

Each step is lazy (except `sort-by`), meaning the pipeline processes elements on demand. If the inventory has ten thousand items but we only need three, the pipeline stops early. This lazy, composable approach to data processing is one of the most important lessons from functional programming, and it is available in every HQL program.

---

*End of Part I.*

## Part II: Advanced Features

### Chapter 11: Classes and Object-Oriented Programming

HQL supports object-oriented programming through classes that compile directly to JavaScript ES6 class syntax. Classes provide constructors, methods, fields, static members, private fields, getters/setters, and single inheritance.

#### 11.1 Class Definition

A class is defined with the `class` form. The body contains field declarations, a constructor, and methods:

```clojure
(class Person
  (var name)
  (var age)

  (constructor [name age]
    (do
      (= this.name name)
      (= this.age age)))

  (fn greet []
    (+ "Hello, " this.name)))
```

This compiles to:

```javascript
class Person {
  name;
  age;
  constructor(name, age) {
    this.name = name;
    this.age = age;
  }
  greet() {
    return "Hello, " + this.name;
  }
}
```

#### 11.2 Fields and Constructors

Fields are declared with `var`, `let`, or `const` inside the class body. They may include default values:

```clojure
(class Config
  (var host "localhost")    ;; mutable field with default
  (var port 8080)           ;; mutable field with default
  (const protocol "https")  ;; immutable field with default

  (constructor [host port]
    (do
      (= this.host host)
      (= this.port port))))
```

Both `var` and `let` produce mutable fields. `const` produces a field tracked as immutable in the IR. The constructor uses `this.field` assignment to initialize fields, and its body may be a single expression, a `(do ...)` block, or multiple expressions.

#### 11.3 Methods

Methods are defined with `(fn name [params] body)` inside the class body. They have implicit return -- the last expression is the return value:

```clojure
(class Calculator
  (var value 0)

  (fn add [n]
    (= this.value (+ this.value n))
    this)

  (fn subtract [n]
    (= this.value (- this.value n))
    this)

  (fn result []
    this.value))

(let calc (new Calculator))
(calc.add 10)
(calc.subtract 3)
(calc.result)  ;; => 7
```

Methods support default parameter values and all parameter styles available to regular functions.

#### 11.4 Static Members

Static fields and methods use the `static` keyword prefix:

```clojure
(class Counter
  (static var count 0)

  (static fn increment []
    (= Counter.count (+ Counter.count 1)))

  (static fn getCount []
    Counter.count))

(Counter.increment)
(Counter.increment)
(Counter.getCount)  ;; => 2
```

Both `static var` and `static fn` are supported.

#### 11.5 Getters and Setters

Getters and setters use the `getter` and `setter` keywords (not `get`/`set`):

```clojure
(class Circle
  (var _radius 0)

  (constructor [r]
    (= this._radius r))

  (getter radius []
    this._radius)

  (setter radius [value]
    (if (< value 0)
      (throw (new Error "Radius must be non-negative"))
      (= this._radius value))))

(let c (new Circle 5))
c.radius          ;; => 5 (calls getter)
(= c.radius 10)   ;; calls setter
```

Getters take zero parameters and have implicit return. Setters take exactly one parameter.

#### 11.6 Private Fields

Private fields use the `#` prefix shorthand. They are always mutable and compile to JavaScript `#`-prefixed private class fields:

```clojure
(class BankAccount
  (#balance 0)

  (constructor [initial]
    (= this.#balance initial))

  (fn deposit [amount]
    (= this.#balance (+ this.#balance amount)))

  (fn getBalance []
    this.#balance))

(let acct (new BankAccount 100))
(acct.deposit 50)
(acct.getBalance)  ;; => 150
;; acct.#balance   ;; Error: private field
```

#### 11.7 Inheritance

Classes support single inheritance with `extends`. The child constructor must call `(super args...)` to invoke the parent constructor:

```clojure
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

(let d (new Dog "Rex" "Shepherd"))
(d.describe)  ;; => "Animal: Rex"
(d.bark)      ;; => "Woof!"
```

Method overriding works by redefining a method in the child class. Note that `super.method()` calls for delegating to parent methods are not yet supported -- only constructor delegation via `(super args...)`.

#### 11.8 Abstract Classes

Abstract classes are available via the `abstract-class` form:

```clojure
(abstract-class Shape
  (fn area [] 0))  ;; default implementation

(class Rectangle extends Shape
  (constructor [w h]
    (= this.width w)
    (= this.height h))

  (fn area []
    (* this.width this.height)))
```

Abstract classes compile to TypeScript `abstract class` declarations and are primarily useful for type system integration.

---

### Chapter 12: Modules

HQL provides a comprehensive module system that supports importing from HQL files, JavaScript, TypeScript, npm packages, JSR modules, and HTTP URLs.

#### 12.1 Import

The `import` form supports several styles:

**Named imports** use a vector of symbols:

```clojure
(import [map filter reduce] from "@hlvm/stdlib")
```

**Named imports with aliases** use the `as` keyword:

```clojure
(import [readFile as read, writeFile as write] from "node:fs")
```

**Namespace imports** use a bare symbol (not a vector):

```clojure
(import path from "node:path")
;; Compiles to: import * as path from "node:path";
```

**Side-effect-only imports** omit specifiers:

```clojure
(import "reflect-metadata")
;; Compiles to: import "reflect-metadata";
```

The `from` keyword is required for all named and namespace imports. Commas between symbols are optional (treated as whitespace by the parser).

#### 12.2 Dynamic Import

Dynamic imports use the separate `import-dynamic` form, which returns a Promise:

```clojure
(let module (await (import-dynamic "./heavy-module.hql")))
(module.process data)

;; With a variable path
(let path (+ "./plugins/" pluginName))
(let plugin (await (import-dynamic path)))
```

This compiles to JavaScript's `import()` expression.

#### 12.3 Export

**Declaration exports** wrap a declaration:

```clojure
(export (fn add [a b] (+ a b)))
(export (const PI 3.14159))
(export (class Point (constructor [x y] (= this.x x) (= this.y y))))
```

**Vector exports** export previously defined symbols:

```clojure
(fn add [a b] (+ a b))
(fn subtract [a b] (- a b))
(export [add subtract])
(export [add as sum])  ;; with alias
```

**Default exports:**

```clojure
(export default (fn [x] (* x x)))
```

Macros are automatically filtered from both import and export declarations. If all symbols in an import or export are macros, the entire declaration is omitted from the output.

#### 12.4 Module Resolution

HQL resolves modules from several sources:

| Source | Format | Example |
|--------|--------|---------|
| HQL files | `.hql` | `"./utils.hql"` |
| JavaScript | `.js`, `.mjs` | `"./lib.js"` |
| TypeScript | `.ts`, `.tsx` | `"./types.ts"` |
| NPM | `npm:package` | `"npm:lodash"` |
| JSR | `jsr:@scope/pkg` | `"jsr:@std/path"` |
| HTTP | URL | `"https://esm.sh/zod"` |
| Stdlib | `@hlvm/*` | `"@hlvm/stdlib"` |

Local paths are resolved relative to the importing file's directory. Path traversal is validated against the project base directory for security.

---

### Chapter 13: Error Handling

HQL provides structured error handling via `try`/`catch`/`finally`/`throw`. A distinctive feature is that `try` is an **expression** that returns a value, achieved through automatic IIFE wrapping.

#### 13.1 Try/Catch/Finally

The basic form supports all combinations of `catch` and `finally`:

```clojure
;; try + catch
(let result
  (try
    (parse-json input)
    (catch e
      (do
        (log.error "Parse failed:" e)
        "default"))))

;; try + finally (cleanup without error handling)
(try
  (open-resource)
  (process-data)
  (finally
    (close-resource)))

;; try + catch + finally
(try
  (let conn (open-connection))
  (query conn "SELECT *")
  (catch e
    (log.error "Query failed:" e)
    null)
  (finally
    (close-connection)))
```

Since `try` is an expression, it always returns a value. The IIFE wrapping is automatic:

```clojure
(let safe-value (try
  (dangerous-operation)
  (catch e "fallback")))
```

Compiles to:

```javascript
const safeValue = (() => {
  try {
    return dangerousOperation();
  } catch (e) {
    return "fallback";
  }
})();
```

The `catch` clause supports an optional parameter binding. Without a parameter, the error is simply discarded:

```clojure
(try
  (risky-operation)
  (catch              ;; no parameter
    (fallback-value)))
```

Only one `catch` and one `finally` clause are allowed per `try` block. The `finally` block does not contribute to the return value (standard JavaScript semantics).

**Async detection:** When the body contains `await`, the IIFE is automatically made `async`:

```clojure
(try
  (await (fetch-data url))
  (catch e
    (await (log-error e))))
```

**Generator detection:** When the body contains `yield`, the IIFE becomes a generator with `yield*`:

```clojure
(fn* producer [items]
  (try
    (for-of [item items]
      (yield item))
    (catch e
      (yield "error"))))
```

#### 13.2 Throw

The `throw` form raises an error:

```clojure
(throw (new Error "Something went wrong"))
(throw "string error")
(throw e)  ;; rethrow a caught error
```

#### 13.3 Error Patterns

A common pattern is using `try` as an expression for safe defaults:

```clojure
(let config
  (try
    (parse-json (read-file "config.json"))
    (catch e
      {port: 3000 host: "localhost"})))
```

For validation, throw early:

```clojure
(fn validate [input]
  (when (not input)
    (throw (new Error "Input required")))
  (when (< input.length 3)
    (throw (new Error "Input too short")))
  input)
```

#### 13.4 Nested Try

`try` blocks can be nested for fine-grained error handling:

```clojure
(try
  (let config (try
    (parse-json (read-file "config.json"))
    (catch e
      (log.warn "Config parse failed, trying backup")
      (parse-json (read-file "config.backup.json")))))
  (start-server config)
  (catch e
    (log.error "Fatal: cannot start server" e)
    (process.exit 1)))
```

Because `try` is an expression, nested try blocks compose naturally. Each level handles its own failure independently.

#### 13.5 Error Types

HQL supports all JavaScript error constructors:

```clojure
(throw (new TypeError "Expected a string"))
(throw (new RangeError "Index out of bounds"))
(throw (new ReferenceError "Variable not defined"))
(throw (new SyntaxError "Unexpected token"))
(throw (new URIError "Malformed URI"))
```

Custom error classes can be defined using class inheritance:

```clojure
(class AppError extends Error
  (constructor [message code]
    (super message)
    (= this.code code)
    (= this.name "AppError")))

(class NotFoundError extends AppError
  (constructor [resource]
    (super (+ resource " not found") 404)))

(try
  (throw (new NotFoundError "User"))
  (catch e
    (when (instanceof e NotFoundError)
      (respond {status: e.code message: e.message}))))
```

#### 13.6 Try as Expression Patterns

The expression nature of `try` enables several idiomatic patterns:

```clojure
;; Default value on failure
(let port (try (parseInt env.PORT) (catch e 3000)))

;; Conditional error handling
(let result
  (try
    (do-work)
    (catch e
      (cond
        ((instanceof e TypeError)  (handle-type-error e))
        ((instanceof e RangeError) (handle-range-error e))
        (else (throw e))))))  ;; rethrow unknown errors
```

---

### Chapter 14: Asynchronous Programming

HQL provides first-class support for asynchronous programming, mapping directly to JavaScript's `async`/`await`, generators, and async generators.

#### 14.1 Async Functions

The `async` keyword prefixes `fn` to create an async function:

```clojure
(async fn fetch-data [url]
  (let response (await (js/fetch url)))
  (let data (await (.json response)))
  data)

;; Anonymous async function
(let fetcher (async fn [url]
  (await (js/fetch url))))

;; Async with map parameters
(async fn connect {host: "localhost" port: 8080}
  (await (establish-connection host port)))
```

Async functions support all parameter styles: positional, map, multi-arity, destructuring, and type annotations.

#### 14.2 Await

The `await` form suspends execution until a Promise resolves:

```clojure
(let data (await (fetch-data "https://api.example.com")))
```

A special feature: `await` wraps its argument in `__hql_consume_async_iter()`, a runtime helper that automatically consumes async iterators if the awaited value is one. This means awaiting an async generator collects its values.

`await` requires exactly one argument.

#### 14.3 Generator Functions

Generator functions use `fn*` and produce values with `yield`:

```clojure
(fn* range-gen [start end]
  (var i start)
  (while (< i end)
    (yield i)
    (= i (+ i 1))))

;; Using the generator
(for-of [n (range-gen 1 5)]
  (print n))
;; Prints: 1 2 3 4
```

Generator functions compile to JavaScript `function*` declarations.

#### 14.4 Yield and Yield*

`yield` produces a value from a generator. Without an argument, it yields `undefined`:

```clojure
(fn* simple []
  (yield 1)
  (yield 2)
  (yield))    ;; yields undefined
```

`yield*` delegates to another iterable or generator:

```clojure
(fn* combined []
  (yield* [1 2 3])           ;; yield from array
  (yield* (range-gen 4 7)))  ;; yield from generator
;; Produces: 1 2 3 4 5 6
```

#### 14.5 Async Generators

Combining `async` with `fn*` creates async generators:

```clojure
(async fn* fetch-pages [urls]
  (for-of [url urls]
    (let response (await (js/fetch url)))
    (yield (await (.json response)))))
```

This compiles to `async function*` and supports both `await` and `yield`.

#### 14.6 For-Await-Of

Async iteration uses `for-await-of` with a binding vector:

```clojure
(for-await-of [page (fetch-pages urls)]
  (process-page page))
```

Compiles to:

```javascript
for await (const page of fetchPages(urls)) {
  processPage(page);
}
```

The binding vector takes `[variable iterable]` form, identical to `for-of`.

#### 14.7 Promise Combinators

JavaScript's Promise static methods are available through standard interop:

```clojure
;; Wait for all promises to resolve
(let results (await (Promise.all [
  (fetch-user id)
  (fetch-posts id)
  (fetch-settings id)])))

;; Race -- first to resolve wins
(let fastest (await (Promise.race [
  (fetch-from-cache key)
  (fetch-from-db key)])))

;; allSettled -- wait for all, regardless of success/failure
(let outcomes (await (Promise.allSettled [
  (risky-operation-1)
  (risky-operation-2)])))

;; any -- first to succeed (ignores rejections)
(let first-success (await (Promise.any [
  (try-server-a)
  (try-server-b)
  (try-server-c)])))
```

#### 14.8 Async Patterns

**Sequential async operations:**

```clojure
(async fn process-pipeline [data]
  (let step1 (await (validate data)))
  (let step2 (await (transform step1)))
  (let step3 (await (save step2)))
  step3)
```

**Concurrent async operations with destructuring:**

```clojure
(async fn load-dashboard [userId]
  (let [user posts settings]
    (await (Promise.all [
      (fetch-user userId)
      (fetch-posts userId)
      (fetch-settings userId)])))
  {user: user posts: posts settings: settings})
```

**Retry with exponential backoff:**

```clojure
(async fn retry [operation maxRetries]
  (var attempt 0)
  (loop []
    (try
      (await (operation))
      (catch e
        (= attempt (+ attempt 1))
        (if (>= attempt maxRetries)
          (throw e)
          (do
            (await (new Promise (fn [resolve]
              (js/setTimeout resolve (* 1000 (** 2 attempt))))))
            (recur)))))))
```

---

### Chapter 15: Macros

Macros are HQL's most powerful metaprogramming feature. They transform code at compile time, operating on S-expressions before they are transpiled to JavaScript.

#### 15.1 Macro Definition

A macro is defined with the `macro` form. Unlike functions, macros receive their arguments as unevaluated code (S-expressions) and return new code:

```clojure
(macro my-if [test then else]
  `(cond
     (~test ~then)
     (else ~else)))
```

The last expression in the macro body becomes the expansion result. Macros support rest parameters with `&`:

```clojure
(macro my-log [level & messages]
  `(js/console.log ~level ~@messages))
```

#### 15.2 Quoting

Quoting is the mechanism for treating code as data:

**Quote** prevents evaluation. Symbols become strings, lists become arrays:

```clojure
(quote (+ 1 2))     ;; => ["+" 1 2]
(quote foo)          ;; => "foo"
```

**Syntax-quote** (backtick) creates a hygienic template with selective evaluation:

```clojure
`(+ 1 ~x)           ;; x is evaluated, rest is quoted
`(list ~@items)      ;; items is evaluated and spliced in
```

Within a template quote:
- `~expr` (unquote) evaluates the expression
- `~@expr` (unquote-splicing) evaluates and splices elements into the enclosing list
- Everything else is quoted (preserved as data)

`quasiquote` remains available as the raw non-resolving template form. Outside template quote context, `~` is the bitwise NOT operator.

#### 15.3 Threading Macros

Threading macros provide a pipeline syntax for nested function calls:

**Thread-first** `->` inserts the value as the first argument:

```clojure
(-> 5
    (+ 3)      ;; (+ 5 3) => 8
    (* 2)      ;; (* 8 2) => 16
    (- 1))     ;; (- 16 1) => 15
```

**Thread-last** `->>` inserts the value as the last argument:

```clojure
(->> [1 2 3 4 5]
     (filter isEven)      ;; (filter isEven [1 2 3 4 5])
     (map (=> (* $0 10)))  ;; (map ... result)
     (reduce + 0))         ;; (reduce + 0 result)
```

**Thread-as** `as->` binds the threaded value to a named placeholder:

```clojure
(as-> [1 2 3] $
  (map inc $)       ;; $ is [1 2 3]
  (filter isEven $) ;; $ is (2 3 4)
  (reduce + 0 $))   ;; $ is (2 4)
```

#### 15.4 Doto

The `doto` macro executes side-effects on a value and returns it:

```clojure
(doto (new Map)
  (.set "a" 1)
  (.set "b" 2)
  (.set "c" 3))
;; Returns the Map with all three entries
```

Method calls (`.method`) are transformed to `(js-call obj method args...)`. The value is evaluated once and bound to a temporary variable.

#### 15.5 Built-in Utility Macros

HQL provides many built-in macros in three embedded libraries (`core.hql`, `utils.hql`, `loop.hql`):

| Macro | Expansion | Description |
|-------|-----------|-------------|
| `(inc x)` | `(+ x 1)` | Increment |
| `(dec x)` | `(- x 1)` | Decrement |
| `(str a b ...)` | String concatenation | Convert and join |
| `(print args...)` | `(js/console.log ...)` | Print to console |
| `(when test body...)` | `(if test (do body...) nil)` | Single-branch conditional |
| `(unless test body...)` | `(if test nil (do body...))` | Inverted when |
| `(if-let [x expr] then else)` | Bind and test | Conditional binding |
| `(when-let [x expr] body...)` | Bind and test | Single-branch conditional binding |
| `(if-not test then else)` | `(if test else then)` | Inverted if |
| `(when-not test body...)` | `(when (not test) body...)` | Inverted when |
| `(xor a b)` | Logical XOR | Exclusive or |
| `(min a b ...)` | `(Math.min ...)` | Minimum |
| `(max a b ...)` | `(Math.max ...)` | Maximum |

#### 15.6 Type Predicates

Type predicate macros expand to `typeof` or `instanceof` checks:

```clojure
(isNull x)      ;; (=== x null)
(isNumber x)    ;; (=== (typeof x) "number")
(isString x)    ;; (=== (typeof x) "string")
(isBoolean x)   ;; (=== (typeof x) "boolean")
(isFunction x)  ;; (=== (typeof x) "function")
(isArray x)     ;; (Array.isArray x)
(isObject x)    ;; complex check (not null, not array, typeof "object")
```

These are macros, not functions -- they expand inline at compile time for zero overhead.

#### 15.7 Macro Hygiene

HQL does not have automatic Scheme-style hygiene. Macro authors must manually avoid variable capture using `gensym` or auto-gensym:

**Manual gensym:**

```clojure
(macro swap [a b]
  (let [tmp (gensym "tmp")]
    `(let (~tmp ~a)
       (= ~a ~b)
       (= ~b ~tmp))))
```

**Auto-gensym** -- symbols ending with `#` inside `syntax-quote` or `quasiquote` automatically get unique names:

```clojure
(macro swap [a b]
  `(let (tmp# ~a)
     (= ~a ~b)
     (= ~b tmp#)))
;; Both tmp# occurrences resolve to the same unique symbol
```

**with-gensyms** -- a hygiene helper macro:

```clojure
(macro safe-swap [a b]
  (with-gensyms [tmp]
    `(let (~tmp ~a) (= ~a ~b) (= ~b ~tmp))))
```

#### 15.8 Macro Primitives

During macro expansion, special `%`-prefixed primitives are available for operating on code:

| Primitive | Description |
|-----------|-------------|
| `(%first coll)` | First element of a list |
| `(%rest coll)` | All but first element |
| `(%nth coll n)` | Element at index n |
| `(%length coll)` | Number of elements |
| `(%empty? coll)` | True if empty or null |

Additionally, `list?`, `symbol?`, and `name` are available for introspection.

#### 15.9 Writing Your Own Macros

Here is a step-by-step guide to writing a macro:

**Step 1: Identify the pattern.** Write what you want the code to look like:

```clojure
(unless condition body...)
;; should behave like
(if condition nil (do body...))
```

**Step 2: Write the template with quasiquote:**

```clojure
(macro unless [test & body]
  `(if ~test nil (do ~@body)))
```

**Step 3: Test expansion.** The macro transforms `(unless (isEmpty x) (process x))` into `(if (isEmpty x) nil (do (process x)))`.

**Step 4: Handle edge cases.** Use `%`-primitives for conditional logic:

```clojure
(macro dbg [expr]
  (let [name (if (symbol? expr) (name expr) "expr")]
    `(let (result# ~expr)
       (js/console.log ~(+ name " =>") result#)
       result#)))
```

Macros are expanded iteratively until a fixed point (no changes) or a maximum depth of 100 recursive expansions.

---

### Chapter 16: The Type System

HQL implements a complete TypeScript type system with two approaches: native S-expression syntax for common type operators, and string passthrough for 100% TypeScript coverage. Types are optional -- type errors produce warnings but code always compiles and runs.

#### 16.1 Type Annotations

**Critical rule: NO SPACE after the colon.** HQL's parser uses whitespace as a token delimiter, so `a:number` is one token but `a: number` is two separate tokens and breaks parsing.

```clojure
;; CORRECT
(fn add [a:number b:number] :number
  (+ a b))

;; WRONG -- space breaks parsing!
(fn add [a: number b: number]
  (+ a b))
```

Variable annotations:

```clojure
(let x:number 10)
(const name:string "hello")
(var count:number 0)
```

Return type annotations (three equivalent forms):

```clojure
(fn add [a b] :number (+ a b))     ;; colon after params
(fn add [a b] -> number (+ a b))   ;; arrow after params
(fn add:number [a b] (+ a b))      ;; on the function name
```

Inline type syntax supports unions (`x:number|string`), nullable (`x:?number`), arrays (`x:string[]`), generics (`x:Array<number>`), object types, tuple types, and function types.

#### 16.2 Type Aliases

The `type` form creates a type alias:

```clojure
(type ID number)
;; => type ID = number;

(type StringOrNumber (| string number))
;; => type StringOrNumber = string | number;
```

The backward-compatible `deftype` form also works:

```clojure
(deftype Complex "Record<string, number>")
```

#### 16.3 Union Types

```clojure
(type Result (| "success" "error" "pending"))
;; => type Result = "success" | "error" | "pending";

(type Primitive (| string number boolean))
;; => type Primitive = string | number | boolean;
```

#### 16.4 Intersection Types

```clojure
(type AdminUser (& User AdminPermissions))
;; => type AdminUser = User & AdminPermissions;
```

#### 16.5 Conditional Types

```clojure
(type IsString<T> (if-extends T string true false))
;; => type IsString<T> = T extends string ? true : false;

(type UnwrapPromise<T> (if-extends T (Promise (infer U)) U T))
;; => type UnwrapPromise<T> = T extends Promise<infer U> ? U : T;
```

#### 16.6 Mapped Types

```clojure
(type MyReadonly<T> (mapped K (keyof T) (indexed T K)))
;; => type MyReadonly<T> = { [K in keyof T]: T[K] };
```

#### 16.7 Tuple and Array Types

```clojure
(type Point (tuple number number))
;; => type Point = [number, number];

(type Numbers (array number))
;; => type Numbers = number[];

;; With rest elements
(type Args (tuple string (rest (array number))))
;; => type Args = [string, ...number[]];
```

#### 16.8 Keyof, Indexed Access, Typeof, Infer

```clojure
(type PersonKeys (keyof Person))
;; => type PersonKeys = keyof Person;

(type NameType (indexed Person "name"))
;; => type NameType = Person["name"];

(type ConfigType (typeof config))
;; => type ConfigType = typeof config;
```

The `infer` keyword is used within conditional types to introduce a type variable:

```clojure
(type ElementType<T> (if-extends T (array (infer E)) E never))
```

#### 16.9 Readonly Modifier

```clojure
(type ImmutablePoint (readonly Point))
;; => type ImmutablePoint = readonly Point;
```

#### 16.10 Utility Types

Any capitalized name is treated as a generic type application:

```clojure
(type PartialPerson (Partial Person))
;; => type PartialPerson = Partial<Person>;

(type PickedUser (Pick User (| "name" "email")))
;; => type PickedUser = Pick<User, "name" | "email">;

(type StringRecord (Record string number))
;; => type StringRecord = Record<string, number>;
```

#### 16.11 Generics

Generic type parameters use angle bracket syntax on the function or type name:

```clojure
(fn identity<T> [x:T] :T
  x)
;; => function identity<T>(x: T): T { return x; }

(fn pair<T,U> [a:T b:U]
  [a b])

(type Container<T> T)
;; => type Container<T> = T;
```

#### 16.12 Swift Collection Shorthand

HQL supports Swift-inspired shorthand for common collection types:

```clojure
(fn sum [numbers:[number]]    ;; Array type: number[]
  (reduce + 0 numbers))

(let scores:[string: number] {})  ;; Dictionary: Record<string, number>
```

| Shorthand | TypeScript Output |
|-----------|-------------------|
| `[Int]` | `Int[]` |
| `[String: Int]` | `Record<string, number>` |
| `(Int, String)` | `[Int, String]` |

#### 16.13 Interfaces

Interfaces use the `interface` form with a string body:

```clojure
(interface User "{ id: string; name: string }")
;; => interface User { id: string; name: string }

(interface Box<T> "{ value: T; getValue(): T }")

;; With extends
(interface Employee extends Person "{ salary: number }")
(interface Manager extends Person Serializable "{ department: string }")
```

#### 16.14 Namespaces

```clojure
(namespace Utils [
  (deftype ID "string")
])
;; => namespace Utils { type ID = string; }

(namespace Models [
  (interface User "{ id: string; name: string }")
])
```

#### 16.15 Enums

Regular and const enums:

```clojure
(enum Color Red Green Blue)
;; => enum Color { Red, Green, Blue }

(const-enum Direction [North South East West])
;; => const enum Direction { North, South, East, West }

;; With explicit values
(const-enum Status [(OK 200) (NotFound 404) (Error 500)])
;; => const enum Status { OK = 200, NotFound = 404, Error = 500 }

(const-enum Color [(Red "red") (Green "green") (Blue "blue")])
;; => const enum Color { Red = "red", Green = "green", Blue = "blue" }
```

#### 16.16 Function Overloads

```clojure
(fn-overload process "x: string" :string)
(fn-overload process "x: number" :number)
;; => function process(x: string): string;
;;    function process(x: number): number;
```

#### 16.17 Declare Statements

Ambient declarations for external code:

```clojure
(declare function "greet(name: string): string")
(declare var "globalCounter: number")
(declare const "PI: 3.14159")
(declare module "my-module")
```

#### 16.18 String Passthrough

For any TypeScript type expression not directly supported by native syntax, use string passthrough. This guarantees 100% TypeScript coverage:

```clojure
(deftype EventName "`on${string}`")
(deftype "KeyValue<K extends string, V>" "{ key: K; value: V }")
(deftype "Mutable<T>" "{ -readonly [K in keyof T]: T[K] }")
```

The compiler automatically handles operator precedence, adding parentheses where needed (e.g., intersection inside union, union inside array).

---

### Chapter 17: JavaScript Interop

HQL compiles to JavaScript and provides seamless interoperability at every level.

#### 17.1 The js/ Global Prefix

Access any JavaScript global with the `js/` prefix:

```clojure
(js/console.log "Hello")           ;; console.log("Hello")
(let pi js/Math.PI)                ;; Math.PI
(let doc js/document)              ;; document
(js/JSON.stringify data)           ;; JSON.stringify(data)
(js/setTimeout callback 1000)      ;; setTimeout(callback, 1000)
```

The `js/` prefix is preserved during compilation -- it is not treated as dot notation.

#### 17.2 Method Calls

The dot-method syntax calls methods on objects. HQL supports two equivalent styles:

**Spaced dot notation** (method chaining):

```clojure
(text .trim .toUpperCase)
;; => text.trim().toUpperCase()

(arr .filter (fn [x] (> x 3)) .map (fn [x] (* x 2)))
;; => arr.filter(x => x > 3).map(x => x * 2)
```

**Spaceless dot notation** (compact):

```clojure
(text.trim.toUpperCase)
(arr.filter (fn [x] (> x 3)))
```

Both generate identical JavaScript. Methods can be chained with arguments:

```clojure
(str .split "," .map parseInt .filter (fn [x] (> x 0)))
```

#### 17.3 Property Access

Properties are accessed with dot notation directly:

```clojure
arr.length              ;; arr.length
user.name               ;; user.name
data.users.0.name       ;; data.users[0].name
```

Or with explicit member access:

```clojure
(. obj prop)            ;; obj.prop
```

#### 17.4 Optional Chaining

Safe property and method access with `?.`:

```clojure
user?.name                        ;; user?.name
data?.user?.address?.city         ;; data?.user?.address?.city

;; Method calls
(obj?.greet "World")              ;; obj?.greet("World")

;; In spaced dot notation
(obj .?method arg1)               ;; obj?.method(arg1)

;; Combined with nullish coalescing
(?? user?.name "unknown")         ;; user?.name ?? "unknown"
```

#### 17.5 Low-Level Interop

For advanced scenarios, HQL provides explicit interop forms:

```clojure
;; Property access
(js-get obj "property")           ;; obj.property (or obj["property"])
(js-get arr 0)                    ;; arr[0]

;; Property mutation
(js-set obj "key" value)          ;; obj.key = value

;; Method invocation
(js-call obj "method" arg1 arg2)  ;; obj.method(arg1, arg2)
(js-call Array "from" [1 2 3])    ;; Array.from([1, 2, 3])

;; Constructor (args in list)
(js-new Date (2023 11 25))        ;; new Date(2023, 11, 25)
```

When the method name string is a valid JavaScript identifier, dot notation is used in the output. Otherwise bracket notation is used.

#### 17.6 Constructor Calls

The `new` form creates objects with flat arguments (preferred over `js-new`):

```clojure
(new Date 2023 11 25)             ;; new Date(2023, 11, 25)
(new Map)                         ;; new Map()
(new Error "Something failed")    ;; new Error("Something failed")
(new Array 5)                     ;; new Array(5)
```

#### 17.7 Template Literals

JavaScript template literals with interpolation are supported:

```clojure
(let name "World")
(let greeting `Hello, ${name}!`)
;; => "Hello, World!"

(let multiline `
  First line
  Second line with ${(+ 1 2)} value
  Third line`)
```

Template literals compile directly to JavaScript template literals.

#### 17.8 Spread and Rest in Interop

The spread operator `...` works in function calls and array/object literals:

```clojure
;; Spread in function call
(fn log-all [& args]
  (js/console.log ...args))

;; Spread in array literal
(let combined [...arr1 ...arr2])

;; Spread in object literal
(let merged {...defaults ...overrides})
```

#### 17.9 Real-World Interop Patterns

**Working with the DOM:**

```clojure
(let el (js/document.querySelector "#app"))
(= el.textContent "Hello from HQL")
(el .addEventListener "click"
  (fn [event]
    (event.preventDefault)
    (process-click event)))
```

**Using npm packages:**

```clojure
(import [z] from "npm:zod")

(let UserSchema
  (z.object {
    name: (z.string)
    age: (z.number .min 0 .max 150)
    email: (z.string .email)}))

(let result (UserSchema.safeParse input))
(if result.success
  (process result.data)
  (handle-errors result.error))
```

**Working with JSON:**

```clojure
;; Parse
(let data (js/JSON.parse jsonString))

;; Stringify with formatting
(let pretty (js/JSON.stringify data null 2))

;; Deep clone via JSON round-trip
(let clone (js/JSON.parse (js/JSON.stringify original)))
```

---

### Chapter 18: The Effect System

HQL includes a compile-time effect system that enforces function purity. This enables safe optimizations like memoization and parallelization while catching side-effect bugs early.

#### 18.1 Pure Functions (fx)

The `fx` form declares a function as pure. The compiler statically verifies that its body contains no impure operations:

```clojure
(fx add [a:number b:number]
  (+ a b))

(fx square [x]
  (* x x))

;; Pure functions can call other pure functions
(fx sum-of-squares [a b]
  (+ (square a) (square b)))
```

#### 18.2 Effect Types

HQL uses binary effect classification: **Pure** or **Impure**.

- **Pure** functions have no observable side effects -- they always return the same output for the same input, perform no I/O, and mutate no state.
- **Impure** functions may have side effects -- I/O, network calls, DOM manipulation, mutation, console output, etc.

The default for `fn` is untracked (no purity enforcement). Only `fx` triggers compile-time checking.

#### 18.3 ValueKind and Method Purity

Method purity depends on the receiver type. HQL tracks `ValueKind` for common types:

| ValueKind | Pure Methods | Impure Methods |
|-----------|-------------|----------------|
| Array | `.length`, `.includes()`, `.indexOf()`, `.slice()` | `.push()`, `.pop()`, `.splice()` |
| String | `.length`, `.charAt()`, `.includes()`, `.slice()` | (none -- strings are immutable) |
| Number | `.toFixed()`, `.toString()` | (none) |
| Map | `.size`, `.has()`, `.get()` | `.set()`, `.delete()`, `.clear()` |
| Set | `.size`, `.has()` | `.add()`, `.delete()`, `.clear()` |

This means calling `.push()` on an array inside an `fx` function is a compile-time error, while calling `.length` is allowed.

#### 18.4 Compile-Time Enforcement

The following are forbidden inside `fx` functions:

```clojure
;; ERROR: Calling impure functions
(fx bad1 [x]
  (js/console.log x)    ;; I/O is impure
  x)

;; ERROR: Mutation
(fx bad2 [arr]
  (arr.push 42)          ;; mutates the array
  arr)

;; ERROR: Generators
(fx bad3 []
  (yield 1))             ;; generators are impure

;; ERROR: Calling unknown/impure functions
(fx bad4 [x]
  (fetch x))             ;; network I/O is impure
```

Callback purity can be annotated:

```clojure
(fx map-pure [f:pure items]
  (map f items))

(map-pure (fx [x] (* x 2)) [1 2 3])    ;; OK
(map-pure (fn [x] (print x)) [1 2 3])  ;; ERROR: fn is not pure
```

Violations produce compile-time errors, not runtime exceptions.

#### 18.5 Static Method and Constructor Effects

The effect system classifies static methods and constructors:

**Pure static methods** -- safe to call from `fx`:

```clojure
(fx compute [x]
  (Math.floor (* x 100)))       ;; Math.floor is pure

(fx serialize [data]
  (js/JSON.stringify data))     ;; JSON.stringify is pure

(fx check-array [x]
  (Array.isArray x))            ;; Array.isArray is pure
```

**Impure static methods:**

```clojure
;; ERROR: Math.random is impure
(fx bad-random []
  (Math.random))

;; ERROR: console methods are impure
(fx bad-log [x]
  (js/console.log x))
```

**Pure constructors** -- creating new instances without side effects:

```clojure
(fx make-pattern [str]
  (new RegExp str))              ;; RegExp constructor is pure

(fx make-error [msg]
  (new Error msg))               ;; Error constructor is pure

(fx make-date [y m d]
  (new Date y m d))              ;; Date constructor is pure
```

**Impure constructors:**

```clojure
;; ERROR: WebSocket constructor has side effects
(fx bad-socket [url]
  (new WebSocket url))

;; ERROR: Worker constructor has side effects
(fx bad-worker [script]
  (new Worker script))
```

#### 18.6 Known Pure and Impure Functions

The effect checker maintains tables of known function effects:

**Known pure functions:** `parseInt`, `parseFloat`, `isNaN`, `isFinite`, `encodeURI`, `encodeURIComponent`, `decodeURI`, `decodeURIComponent`, `String`, `Number`, `Boolean`

**Known impure functions:** `fetch`, `alert`, `confirm`, `prompt`, `setTimeout`, `setInterval`, `clearTimeout`, `clearInterval`, `requestAnimationFrame`, `queueMicrotask`

Unknown functions (not in any table) default to **impure** -- the system is conservative. A pure function calling an unknown function is always an error.

#### 18.7 Compilation Output

`fx` compiles identically to `fn` in the output JavaScript. Purity is enforced entirely at compile time with zero runtime overhead:

```clojure
(fx add [x y] (+ x y))
```

Compiles to:

```javascript
function add(x, y) {
  return x + y;
}
```

There is no wrapper, no annotation, no runtime check. The `fx` keyword is purely a compile-time contract.

---

## Part III: The Standard Library

### Chapter 19: Standard Library Reference

HQL's standard library provides functional programming utilities inspired by Clojure. All sequence operations are lazy by default and support both arrays and lazy sequences. Approximately 96% of the standard library is self-hosted -- written in HQL itself.

#### 19.1 Sequence Primitives

The fundamental building blocks of sequence processing, borrowed from Lisp's trinity:

```clojure
(first [1 2 3])          ;; => 1
(first "hello")          ;; => "h"
(first [])               ;; => undefined

(rest [1 2 3])           ;; => (2 3)  -- lazy
(rest [1])               ;; => ()
(rest [])                ;; => ()

(cons 0 [1 2 3])         ;; => (0 1 2 3)  -- lazy

(seq [1 2 3])            ;; => (1 2 3)
(seq [])                 ;; => nil

(next [1 2 3])           ;; => (2 3)
(next [1])               ;; => nil  -- unlike rest which returns ()
```

#### 19.2 Collection Operations

```clojure
;; Taking and dropping
(take 3 [1 2 3 4 5])    ;; => (1 2 3)  -- lazy
(drop 2 [1 2 3 4 5])    ;; => (3 4 5)  -- lazy

;; Transformations
(map (fn [x] (* x 2)) [1 2 3])     ;; => (2 4 6)  -- lazy
(filter isEven [1 2 3 4])           ;; => (2 4)  -- lazy
(reduce + 0 [1 2 3 4])              ;; => 10

;; Combining
(concat [1 2] [3 4])    ;; => (1 2 3 4)  -- lazy
(flatten [[1 2] [3 4]]) ;; => (1 2 3 4)  -- one level deep, lazy
(distinct [1 2 2 3 1])  ;; => (1 2 3)  -- lazy

;; Counting and access
(count [1 2 3])          ;; => 3  -- O(1) for arrays
(last [1 2 3])           ;; => 3  -- O(1) for arrays
(nth [10 20 30] 1)       ;; => 20
(second [1 2 3])         ;; => 2
```

#### 19.3 Higher-Order Functions

```clojure
(mapIndexed (fn [i x] [i x]) ["a" "b" "c"])
;; => ([0 "a"] [1 "b"] [2 "c"])

(keepIndexed (fn [i x] (if (isEven i) x nil)) ["a" "b" "c" "d"])
;; => ("a" "c")

(mapcat (fn [x] [x x]) [1 2 3])
;; => (1 1 2 2 3 3)

(keep (fn [x] (if (> x 0) x nil)) [-1 0 1 2])
;; => (1 2)

(comp (fn [x] (* x 2)) (fn [x] (+ x 1)))  ;; compose right-to-left
(partial + 10)                               ;; partially apply
(apply + [1 2 3 4])                          ;; => 10
```

#### 19.4 Lazy Constructors

```clojure
;; Numeric ranges
(range 5)                ;; => (0 1 2 3 4)
(range 2 5)              ;; => (2 3 4)
(range 0 10 2)           ;; => (0 2 4 6 8)

;; Infinite sequences (always use take!)
(take 5 (repeat 42))             ;; => (42 42 42 42 42)
(take 5 (cycle [1 2 3]))         ;; => (1 2 3 1 2)
(take 5 (iterate inc 0))         ;; => (0 1 2 3 4)
(take 3 (repeatedly Math.random)) ;; => (0.12 0.45 0.78)

;; Custom lazy sequence
(fn fib []
  (lazy-seq
    (let [helper (fn [a b]
                   (cons a (lazy-seq (helper b (+ a b)))))]
      (helper 0 1))))

(take 8 (fib))  ;; => (0 1 1 2 3 5 8 13)
```

#### 19.5 Delay and Force

Deferred computation allows values to be computed only when needed:

```clojure
;; Create a delayed computation
(let d (delay (do
  (print "Computing...")
  (* 42 42))))

;; Not yet computed
(realized d)  ;; => false

;; Force evaluation -- computes and caches
(force d)     ;; prints "Computing...", => 1764

;; Second force returns cached value
(force d)     ;; => 1764 (no recomputation)
(realized d)  ;; => true
```

`delay` wraps an expression in a thunk. `force` evaluates the thunk once and caches the result. Subsequent `force` calls return the cached value. This is the foundation for lazy evaluation in HQL.

#### 19.6 Collection Conversion

```clojure
;; Convert to vector (eager array)
(vec (range 5))              ;; => [0 1 2 3 4]
(vec (filter isEven (range 10))) ;; => [0 2 4 6 8]

;; Convert to set (removes duplicates)
(set [1 2 2 3 1])            ;; => Set {1, 2, 3}

;; Build a collection from a transducer
(into [] (filter isEven) [1 2 3 4 5])  ;; => [2 4]
(into {} (map (fn [x] [x (* x x)])) [1 2 3])
;; => {1: 1, 2: 4, 3: 9}

;; Realize a lazy sequence into an array
(doall (map inc [1 2 3]))    ;; => [2 3 4]
```

#### 19.7 Partitioning and Interleaving

```clojure
;; Fixed-size chunks
(partition 2 [1 2 3 4 5 6])      ;; => ((1 2) (3 4) (5 6))
(partition 3 [1 2 3 4 5])        ;; => ((1 2 3))  -- incomplete chunk dropped

;; Partition by predicate change
(partitionBy isEven [1 3 2 4 5])
;; => ((1 3) (2 4) (5))

;; Interleave two sequences
(interleave [1 2 3] ["a" "b" "c"])
;; => (1 "a" 2 "b" 3 "c")

;; Insert separator between elements
(interpose ", " ["a" "b" "c"])
;; => ("a" ", " "b" ", " "c")

;; Zip two sequences into a map
(zipmap ["name" "age" "city"] ["Alice" 30 "NYC"])
;; => {name: "Alice", age: 30, city: "NYC"}
```

#### 19.8 Predicates and Type Checks

```clojure
;; Collection predicates
(isEmpty [])             ;; => true
(some isEven [1 3 5])    ;; => nil
(some isEven [1 2 3])    ;; => 2 (first truthy result)
(every isEven [2 4 6])   ;; => true
(notAny isEven [1 3 5])  ;; => true
(notEvery isEven [2 3])  ;; => true

;; Nil checking
(isSome 0)               ;; => true (not nil)
(isSome nil)             ;; => false
(isNil null)             ;; => true

;; Numeric predicates
(isEven 4)               ;; => true
(isOdd 3)                ;; => true
(isZero 0)               ;; => true
(isPositive 5)           ;; => true
(isNegative -3)          ;; => true

;; Type predicates (macros)
(isNumber 42)            ;; => true
(isString "hi")          ;; => true
(isBoolean true)         ;; => true
(isFunction +)           ;; => true
(isArray [1 2])          ;; => true
```

#### 19.9 Arithmetic and Comparison

All arithmetic operators are variadic and can be used as first-class values:

```clojure
(+ 1 2 3 4 5)           ;; => 15
(- 10 3)                 ;; => 7
(* 2 3 4)                ;; => 24
(/ 100 5)                ;; => 20

(inc 5)                  ;; => 6  (macro: (+ x 1))
(dec 5)                  ;; => 4  (macro: (- x 1))

;; First-class operator usage
(reduce + 0 [1 2 3])    ;; => 6
(reduce * 1 [1 2 3 4])  ;; => 24
(map inc [1 2 3])        ;; => (2 3 4)

;; Stdlib also provides named function wrappers for operators:
;; add, sub, mul, div, mod, abs, lt, gt, lte, gte, deepEq
(reduce add 0 [1 2 3])  ;; => 6  (equivalent to reduce +)
(abs -5)                 ;; => 5
(deepEq [1 [2 3]] [1 [2 3]])  ;; => true
```

#### 19.10 Map/Object Operations

All map operations are immutable -- they return new maps:

```clojure
(keys {a: 1 b: 2})                      ;; => ["a" "b"]
(vals {a: 1 b: 2})                      ;; => [1 2]
(get {a: 1 b: 2} "a")                   ;; => 1
(get {a: 1} "c" "default")              ;; => "default"

(assoc {a: 1} "b" 2)                    ;; => {a: 1, b: 2}
(dissoc {a: 1 b: 2} "b")               ;; => {a: 1}
(merge {a: 1} {b: 2} {c: 3})           ;; => {a: 1, b: 2, c: 3}

;; Nested operations
(getIn {a: {b: {c: 42}}} ["a" "b" "c"]) ;; => 42
(assocIn {} ["a" "b"] 1)                ;; => {a: {b: 1}}
(updateIn {a: {b: 1}} ["a" "b"] inc)    ;; => {a: {b: 2}}

;; update -- apply function to value at key
(update {a: 1 b: 2} "a" inc)            ;; => {a: 2, b: 2}

;; zipmap -- create map from keys and values
(zipmap ["a" "b"] [1 2])                ;; => {a: 1, b: 2}
```

#### 19.11 Sorting and Grouping

```clojure
(sort [3 1 4 1 5])                       ;; => [1 1 3 4 5]
(sortBy (fn [x] (- x)) [3 1 4])         ;; => [4 3 1]

(groupBy isEven [1 2 3 4 5])
;; => {true: [2 4], false: [1 3 5]}

```

#### 19.12 Transducers

Transducers are composable algorithmic transformations that are independent of their input and output sources:

```clojure
;; Basic transducer composition
(let xf (comp
           (filter isEven)
           (map (fn [x] (* x 10)))))

(transduce xf + 0 [1 2 3 4 5])
;; => 60  (2*10 + 4*10)

(into [] xf [1 2 3 4 5])
;; => [20 40]
```

The `reduced` sentinel allows early termination:

```clojure
(transduce
  (fn [rf]
    (fn
      ([] (rf))
      ([result] (rf result))
      ([result input]
        (if (> input 3)
          (reduced result)
          (rf result input)))))
  + 0 [1 2 3 4 5])
;; => 6  (1 + 2 + 3, stops at 4)
```

#### 19.13 Self-Hosting Architecture

Approximately 96% of the standard library is written in HQL itself (the `stdlib.hql` file). Only true primitives that require direct JavaScript interop remain in JavaScript:

- `first`, `rest`, `cons` -- fundamental sequence protocol
- `seq`, `lazy-seq` -- lazy sequence creation
- `reduce` -- requires direct iteration control
- Operator functions via `__hql_get_op` -- runtime operator wrapping

Self-hosted functions are transpiled to JavaScript at build time via `scripts/build-stdlib.ts`. The resulting `self-hosted.js` is merged with `core.js` into the final `index.js` bundle.

---

## Part IV: Reference

### Appendix A: Complete Syntax Table

| Form | Category | Example |
|------|----------|---------|
| `fn` | Function | `(fn add [a b] (+ a b))` |
| `defn` | Function | `(defn add [a b] (+ a b))` |
| `fx` | Function (pure) | `(fx pure [x] (* x x))` |
| `=>` | Function (arrow) | `(=> (* $0 2))` |
| `fn*` | Generator | `(fn* gen [] (yield 1))` |
| `async fn` | Async | `(async fn f [] (await x))` |
| `async fn*` | Async generator | `(async fn* g [] (yield (await x)))` |
| `let` | Binding | `(let x 10)` |
| `const` | Binding (frozen) | `(const PI 3.14)` |
| `def` | Binding (frozen) | `(def PI 3.14)` |
| `var` | Binding (fn-scope) | `(var x 10)` |
| `=` | Assignment | `(= x 20)` |
| `+=` `-=` `*=` `/=` `%=` `**=` | Compound assign | `(+= x 5)` |
| `&=` `\|=` `^=` `<<=` `>>=` `>>>=` | Bitwise assign | `(&= flags 0xFF)` |
| `??=` `&&=` `\|\|=` | Logical assign | `(??= x "default")` |
| `if` | Control flow | `(if cond then else)` |
| `cond` | Control flow | `(cond ((test1) r1) (else r2))` |
| `when` | Control flow | `(when cond body...)` |
| `unless` | Control flow | `(unless cond body...)` |
| `when-let` | Control flow | `(when-let [x expr] body...)` |
| `if-let` | Control flow | `(if-let [x expr] then else)` |
| `when-not` | Control flow | `(when-not cond body...)` |
| `if-not` | Control flow | `(if-not cond then else)` |
| `?` | Ternary | `(? cond then else)` |
| `switch` | Control flow | `(switch x (case 1 a) (default b))` |
| `case` | Control flow | `(case x v1 r1 v2 r2 default)` |
| `match` | Pattern match | `(match v (case p r) (default d))` |
| `do` | Sequencing | `(do expr1 expr2 expr3)` |
| `loop` | Iteration | `(loop [i 0] (recur (+ i 1)))` |
| `recur` | Iteration | `(recur new-bindings...)` |
| `while` | Iteration | `(while cond body...)` |
| `for` | Iteration | `(for [i 10] body)` |
| `for-of` | Iteration | `(for-of [x arr] body)` |
| `for-await-of` | Iteration | `(for-await-of [x iter] body)` |
| `repeat` | Iteration | `(repeat n body...)` |
| `break` | Loop control | `(break)` or `(break label)` |
| `continue` | Loop control | `(continue)` or `(continue label)` |
| `label` | Loop control | `(label name body)` |
| `class` | OOP | `(class Name body...)` |
| `abstract-class` | OOP | `(abstract-class Name body...)` |
| `constructor` | OOP | `(constructor [params] body)` |
| `super` | OOP | `(super args...)` |
| `extends` | OOP | `(class Child extends Parent ...)` |
| `static` | OOP modifier | `(static fn name [] ...)` |
| `getter` | OOP | `(getter name [] body)` |
| `setter` | OOP | `(setter name [v] body)` |
| `new` | Constructor | `(new ClassName args...)` |
| `js-new` | Constructor | `(js-new Class (args...))` |
| `import` | Module | `(import [a b] from "mod")` |
| `import-dynamic` | Module | `(import-dynamic "mod")` |
| `export` | Module | `(export (fn f [] ...))` |
| `export default` | Module | `(export default expr)` |
| `try` | Error | `(try body (catch e handler))` |
| `catch` | Error | `(catch e body...)` |
| `finally` | Error | `(finally body...)` |
| `throw` | Error | `(throw (new Error "msg"))` |
| `return` | Control | `(return expr)` |
| `await` | Async | `(await promise)` |
| `yield` | Generator | `(yield value)` |
| `yield*` | Generator | `(yield* iterable)` |
| `macro` | Metaprog | `(macro name [params] body)` |
| `quote` | Metaprog | `(quote expr)` |
| `syntax-quote` | Metaprog | `` `(expr ~val ~@list) `` |
| `quasiquote` | Metaprog | `(quasiquote expr)` |
| `unquote` | Metaprog | `~expr` |
| `unquote-splicing` | Metaprog | `~@expr` |
| `gensym` | Metaprog | `(gensym "prefix")` |
| `with-gensyms` | Metaprog | `(with-gensyms [names] body)` |
| `->` | Threading | `(-> x (f a) (g b))` |
| `->>` | Threading | `(->> x (f a) (g b))` |
| `as->` | Threading | `(as-> x $ (f $ a))` |
| `doto` | Threading | `(doto x (.m1) (.m2))` |
| `type` | Type system | `(type Name TypeExpr)` |
| `deftype` | Type system | `(deftype Name "TS type")` |
| `\|` | Type (union) | `(\| A B C)` |
| `&` | Type (intersect) | `(& A B)` |
| `keyof` | Type | `(keyof T)` |
| `indexed` | Type | `(indexed T K)` |
| `if-extends` | Type | `(if-extends T U X Y)` |
| `mapped` | Type | `(mapped K Keys V)` |
| `tuple` | Type | `(tuple A B)` |
| `array` | Type | `(array T)` |
| `readonly` | Type | `(readonly T)` |
| `typeof` | Type/operator | `(typeof x)` |
| `infer` | Type | `(infer T)` |
| `interface` | Type | `(interface Name "body")` |
| `namespace` | Type | `(namespace Name [...])` |
| `enum` | Type | `(enum Color Red Green Blue)` |
| `const-enum` | Type | `(const-enum Dir [...])` |
| `fn-overload` | Type | `(fn-overload f "params" :ret)` |
| `declare` | Type | `(declare var "x: number")` |
| `instanceof` | Operator | `(instanceof x Type)` |
| `in` | Operator | `(in "key" obj)` |
| `delete` | Operator | `(delete obj.prop)` |
| `void` | Operator | `(void 0)` |
| `+` `-` `*` `/` `%` `**` | Arithmetic | `(+ 1 2 3)` |
| `<` `>` `<=` `>=` | Comparison | `(< a b)` |
| `===` `==` `!==` `!=` | Equality | `(=== a b)` |
| `and` `or` `not` | Logical (macro) | `(and a b)` |
| `&&` `\|\|` `!` | Logical (direct) | `(&& a b)` |
| `??` | Nullish coalesce | `(?? a "default")` |
| `&` `\|` `^` `~` | Bitwise | `(& 5 3)` |
| `<<` `>>` `>>>` | Shift | `(<< 5 2)` |
| `js-get` | JS interop | `(js-get obj "prop")` |
| `js-set` | JS interop | `(js-set obj "key" val)` |
| `js-call` | JS interop | `(js-call obj "method" arg)` |
| `.method` | JS interop | `(obj .method arg)` |
| `.?method` | JS interop | `(obj .?method arg)` |
| `lazy-seq` | Lazy evaluation | `(lazy-seq (cons 1 more))` |
| `delay` | Lazy evaluation | `(delay expensive-expr)` |
| `decorator` | TypeScript | `(decorator @Name)` |
| `str` | Utility (macro) | `(str a b c)` |
| `print` | Utility (macro) | `(print "hello")` |
| `inc` | Utility (macro) | `(inc x)` |
| `dec` | Utility (macro) | `(dec x)` |

---

### Appendix B: Operator Precedence

HQL uses explicit prefix notation -- there is no implicit operator precedence since parentheses make grouping unambiguous:

```clojure
(+ 2 (* 3 4))  ;; 2 + (3 * 4) = 14, explicit
(* (+ 2 3) 4)  ;; (2 + 3) * 4 = 20, explicit
```

However, the compiler uses an internal precedence table for correct JavaScript parenthesization in the output. From highest to lowest:

| Precedence | Operators |
|-----------|-----------|
| 20 | Grouping `()` |
| 19 | Member access `.`, computed `[]`, `new` with args, function call `()` |
| 18 | `new` without args |
| 17 | Postfix `++` `--` |
| 16 | Prefix `!` `~` `+` `-` `typeof` `void` `delete` `await` |
| 15 | `**` (right-associative) |
| 14 | `*` `/` `%` |
| 13 | `+` `-` |
| 12 | `<<` `>>` `>>>` |
| 11 | `<` `<=` `>` `>=` `in` `instanceof` |
| 10 | `==` `!=` `===` `!==` |
| 9 | `&` (bitwise AND) |
| 8 | `^` (bitwise XOR) |
| 7 | `\|` (bitwise OR) |
| 6 | `&&` |
| 5 | `\|\|` |
| 4 | `??` |
| 3 | `? :` (ternary) |
| 2 | `=` `+=` `-=` etc. (assignment) |
| 1 | `,` (comma/sequence) |

In HQL, you never need to memorize this table. Parentheses are always explicit.

---

### Appendix C: Reserved Words

The following identifiers are reserved and cannot be used as variable names:

**JavaScript reserved words:**
`break`, `case`, `catch`, `continue`, `debugger`, `default`, `delete`, `do`, `else`, `finally`, `for`, `function`, `if`, `in`, `instanceof`, `new`, `return`, `switch`, `this`, `throw`, `try`, `typeof`, `var`, `void`, `while`, `with`

**JavaScript strict mode reserved words:**
`class`, `const`, `enum`, `export`, `extends`, `import`, `super`, `implements`, `interface`, `let`, `package`, `private`, `protected`, `public`, `static`, `yield`

**HQL-specific keywords:**
`fn`, `defn`, `fx`, `def`, `loop`, `recur`, `macro`, `quote`, `quasiquote`, `unquote`, `unquote-splicing`, `async`, `await`, `fn*`, `yield*`, `cond`, `when`, `unless`, `match`, `and`, `or`, `not`, `repeat`, `for-of`, `for-await-of`, `label`, `import-dynamic`, `export`, `type`, `deftype`, `interface`, `namespace`, `enum`, `const-enum`, `declare`, `fn-overload`, `abstract-class`, `getter`, `setter`, `constructor`

---

### Appendix D: CLI Reference

#### hlvm run

Execute an HQL program:

```bash
hlvm run program.hql
hlvm run src/main.hql --verbose
```

The file is parsed, macro-expanded, transpiled to JavaScript, and executed.

#### hlvm compile

Compile HQL to JavaScript without executing:

```bash
hlvm compile program.hql              # outputs to stdout
hlvm compile program.hql -o output.js  # outputs to file
hlvm compile program.hql --ts          # TypeScript output
```

#### hlvm repl

Start an interactive read-eval-print loop:

```bash
hlvm repl
```

The REPL supports:
- Persistent definitions across expressions (`def`, `defn`)
- Tab completion for symbols
- Paredit structural editing (see Appendix E)
- Multi-line input with balanced parentheses detection
- History with up/down arrow keys

#### hlvm init

Initialize a new HQL project:

```bash
hlvm init my-project
cd my-project
hlvm run src/main.hql
```

Creates a project skeleton with `src/main.hql`, configuration files, and directory structure.

#### hlvm upgrade

Upgrade the HQL toolchain to the latest version:

```bash
hlvm upgrade
```

This downloads and installs the latest release, preserving your existing projects and configuration.

#### Global Options

| Option | Description |
|--------|-------------|
| `--help`, `-h` | Show help for a command |
| `--version`, `-V` | Print version information |
| `--verbose` | Enable verbose output |
| `--debug` | Enable debug-level logging |

#### Compile Options

| Option | Description |
|--------|-------------|
| `-o <file>` | Output file path |
| `--ts` | Emit TypeScript instead of JavaScript |
| `--release` | Enable optimizations (minification, tree-shaking) |
| `--target native` | Compile to native executable via Deno |

---

### Appendix E: Structural Editing (Paredit)

HQL's REPL includes paredit-style structural editing that operates on S-expressions as complete units, ensuring parentheses always remain balanced.

**Key operations:**

| Operation | Shortcut | Effect |
|-----------|----------|--------|
| Slurp Forward | `Ctrl+]` | Pull next sexp into list |
| Slurp Backward | `Ctrl+O` | Pull previous sexp into list |
| Barf Forward | `Ctrl+\` | Push last sexp out of list |
| Barf Backward | `Ctrl+P` | Push first sexp out of list |
| Wrap | `Ctrl+Y` | Surround with parentheses |
| Splice | `Ctrl+G` | Remove enclosing parentheses |
| Raise | `Ctrl+^` | Replace parent with current sexp |
| Kill Sexp | `Ctrl+X` | Delete sexp at cursor |
| Transpose | `Ctrl+T` | Swap with previous sexp |

**Example workflow** -- building an expression:

```
;; Start with values
+ 1 2 3

;; Wrap the operator (Ctrl+Y at +)
(+) 1 2 3

;; Slurp all arguments (Ctrl+] three times)
(+ 1 2 3)    ;; Done!
```

Paredit never leaves you with unbalanced delimiters -- operations that would break structure are silently ignored.

---

### Appendix F: Comparison -- HQL vs Clojure vs JavaScript

| Operation | HQL | Clojure | JavaScript |
|-----------|-----|---------|------------|
| Variable | `(let x 10)` | `(let [x 10] ...)` | `let x = 10` |
| Constant | `(const x 10)` | `(def x 10)` | `const x = Object.freeze(10)` |
| Function | `(fn add [a b] (+ a b))` | `(defn add [a b] (+ a b))` | `function add(a, b) { return a + b }` |
| Lambda | `(=> (* $0 2))` | `#(* % 2)` | `x => x * 2` |
| If | `(if cond t e)` | `(if cond t e)` | `cond ? t : e` |
| Cond | `(cond ...)` | `(cond ...)` | `if/else if/else` |
| Loop | `(loop [i 0] (recur ...))` | `(loop [i 0] (recur ...))` | `while (true) { ... }` |
| For-each | `(for-of [x arr] ...)` | `(doseq [x arr] ...)` | `for (const x of arr)` |
| Map | `(map f coll)` | `(map f coll)` | `arr.map(f)` |
| Filter | `(filter pred coll)` | `(filter pred coll)` | `arr.filter(pred)` |
| Reduce | `(reduce f init coll)` | `(reduce f init coll)` | `arr.reduce(f, init)` |
| Class | `(class Name ...)` | `(defrecord Name ...)` | `class Name { ... }` |
| Import | `(import [a] from "m")` | `(require '[m :as a])` | `import { a } from "m"` |
| Interop | `(.method obj arg)` | `(.method obj arg)` | `obj.method(arg)` |
| Pipeline | `(-> x (f) (g))` | `(-> x (f) (g))` | `g(f(x))` (or pipeline `\|>`) |
| Pattern Match | `(match v (case p r))` | `(match v p r)` | `switch` (limited) |
| Macro | `(macro name [p] ...)` | `(defmacro name [p] ...)` | N/A |
| Async | `(async fn f [] ...)` | `(go ...)` | `async function f() { ... }` |
| Generator | `(fn* g [] (yield v))` | N/A (lazy-seq) | `function* g() { yield v }` |

Key differences from Clojure:
- HQL's `let` is mutable (JavaScript `let`); use `const`/`def` for immutability
- HQL compiles to JavaScript, not JVM bytecode
- HQL supports TypeScript types natively
- HQL uses `fn` where Clojure uses `defn`, and `fn*` for generators (Clojure uses `fn*` differently)

Key differences from JavaScript:
- S-expression syntax with prefix notation
- Expressions everywhere (no statement/expression distinction)
- Compile-time macro system
- Lazy sequences by default in the standard library
- Built-in pattern matching
- Effect system for purity enforcement

---

### Appendix G: Grammar (Informal BNF)

```
program        ::= form*

form           ::= atom | list | vector | hash-map | set-literal | quoted-form

atom           ::= symbol | number | string | boolean | nil | keyword | bigint

symbol         ::= identifier ('.' identifier)* ('?' | '!')?
                  | operator
                  | 'js/' identifier ('.' identifier)*

number         ::= integer | float
integer        ::= '-'? digit+
float          ::= '-'? digit+ '.' digit+
bigint         ::= digit+ 'n'

string         ::= '"' char* '"'
                  | '`' (char | '${' form '}')* '`'

boolean        ::= 'true' | 'false'
nil            ::= 'null' | 'undefined' | 'nil'

list           ::= '(' form* ')'
vector         ::= '[' form* ']'
hash-map       ::= '{' (form ':' form ','?)* '}'
set-literal    ::= '#[' form* ']'

quoted-form    ::= "'" form           ;; quote
                 | '`' form           ;; quasiquote
                 | '~' form           ;; unquote
                 | '~@' form          ;; unquote-splicing

operator       ::= '+' | '-' | '*' | '/' | '%' | '**'
                 | '<' | '>' | '<=' | '>=' | '===' | '==' | '!==' | '!='
                 | '&&' | '||' | '!' | '??' | '?'
                 | '&' | '|' | '^' | '~' | '<<' | '>>' | '>>>'
                 | '=' | '+=' | '-=' | '*=' | '/=' | '%=' | '**='
                 | '&=' | '|=' | '^=' | '<<=' | '>>=' | '>>>='
                 | '??=' | '&&=' | '||='

comment        ::= '//' char-until-eol
                 | ';' char-until-eol
                 | ';;' char-until-eol

binding-form   ::= '(' ('let' | 'const' | 'var' | 'def') pattern value ')'

pattern        ::= symbol
                 | '[' pattern* ('&' symbol)? ']'
                 | '{' (symbol ':' pattern)* '}'

fn-form        ::= '(' 'fn' name? params body+ ')'
                 | '(' 'fn' name? clause+ ')'

params         ::= '[' (param-elem)* ']'
                 | '{' (key ':' value ','?)* '}'

param-elem     ::= symbol (':' type)?
                 | symbol '=' default-value
                 | '&' symbol
                 | '[' param-elem* ']'

clause         ::= '(' params body+ ')'

type-annotation ::= symbol ':' type-expr
type-expr       ::= simple-type | generic-type | inline-union
                   | inline-nullable | inline-array
                   | inline-object | inline-tuple | inline-function
```

This grammar is intentionally informal and simplified. The actual parser handles additional edge cases including:
- Type annotations with no spaces after colons
- Optional chaining with `?.`
- Spread operator `...`
- Template literals with interpolation
- Reader macros for quote/unquote
- Nested quasiquote depth tracking
