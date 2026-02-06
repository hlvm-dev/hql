# Template Literals

Template literals provide ES6-style string interpolation using backticks and `${}` syntax.

## Syntax

### Basic Template Literals

```lisp
;; Plain string with backticks
`hello world`                    ;; => "hello world"

;; Empty template
``                               ;; => ""

;; String with spaces
`  spaces around  `              ;; => "  spaces around  "
```

### Single Interpolation

```lisp
;; At beginning
`${10} apples`                   ;; => "10 apples"

;; In middle
`I have ${5} apples`             ;; => "I have 5 apples"

;; At end
`Total: ${42}`                   ;; => "Total: 42"

;; Only interpolation
`${100}`                         ;; => "100"
```

### Multiple Interpolations

```lisp
;; Two interpolations
`${1} + ${2} = 3`                ;; => "1 + 2 = 3"

;; Three interpolations
`${1}, ${2}, ${3}`               ;; => "1, 2, 3"

;; Consecutive interpolations
`${10}${20}`                     ;; => "1020"
```

### Expressions in Interpolations

```lisp
;; Arithmetic
`Sum: ${(+ 2 3)}`                ;; => "Sum: 5"

;; Variables
(let name "Alice")
`Hello, ${name}!`                ;; => "Hello, Alice!"

;; Function calls
(fn double [x] (* x 2))
`Doubled: ${(double 5)}`         ;; => "Doubled: 10"

;; Nested expressions
`Result: ${(* (+ 2 3) 4)}`       ;; => "Result: 20"

;; Boolean expressions
`Is true: ${(> 5 3)}`            ;; => "Is true: true"

;; String expressions
`Message: ${(+ "Hello" " " "World")}` ;; => "Message: Hello World"
```

### Escape Sequences

```lisp
;; Escaped backtick
`This is a \` backtick`          ;; => "This is a ` backtick"

;; Escaped dollar sign
`Price: \$100`                   ;; => "Price: $100"

;; Newline
`Line 1\nLine 2`                 ;; => "Line 1\nLine 2"

;; Tab
`Col1\tCol2`                     ;; => "Col1\tCol2"

;; Backslash
`Path: C:\\Users`                ;; => "Path: C:\Users"
```

### Complex Expressions

```lisp
;; Ternary in interpolation
`Status: ${(? true "active" "inactive")}` ;; => "Status: active"

;; Array access
(let arr [10 20 30])
`Second element: ${(get arr 1)}`  ;; => "Second element: 20"

;; Object property access
(let obj {"name": "Bob" "age": 25})
`Name: ${(get obj "name")}`       ;; => "Name: Bob"
```

## Integration with Other Features

```lisp
;; In function return
(fn greet [name] `Hello, ${name}!`)
(greet "World")                   ;; => "Hello, World!"

;; In variable assignment
(let x 10)
(let message `Value is ${x}`)

;; In arrays
(let arr [`first` `second ${2}` `third`])

;; Multiline templates
`Line 1
Line 2
Line 3`                           ;; preserves newlines
```

## Type Coercion

Template literals follow JavaScript's `toString()` coercion rules:

```lisp
`Number: ${42}`                  ;; => "Number: 42"
`Boolean: ${true}`               ;; => "Boolean: true"
`Null: ${null}`                  ;; => "Null: null"
```

## Implementation Details

Template literals compile directly to JavaScript template literals:

```lisp
;; HQL
`Hello ${name}, you are ${age} years old`

;; Compiles to JavaScript
`Hello ${name}, you are ${age} years old`
```

Interpolated expressions are fully parsed as HQL expressions, then transpiled to their JavaScript equivalents inside `${}`.

If a template literal has no interpolations, the parser optimizes it to a plain string literal.

## Limitations

- No tagged template literals
- No raw template strings (`String.raw`)
- Backtick immediately followed by `(` or `[` is not a template literal (reserved for quasiquote syntax)

## Implementation Location

- Parser: `src/hql/transpiler/pipeline/parser.ts` (tokenizer regex + `parseTemplateLiteral`)
- AST-to-IR transform: `src/hql/transpiler/pipeline/transform/literals.ts` (`transformTemplateLiteral`)
- Code generation: `src/hql/transpiler/pipeline/ir-to-typescript.ts` (`generateTemplateLiteral`)
- Test suite: `tests/unit/syntax-template-literals.test.ts`
