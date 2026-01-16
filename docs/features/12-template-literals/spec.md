# Template Literals Feature Documentation

**Implementation:** Built-in syntax (transpiler core) **Coverage:** ✅ 100% **Version:** v2.0

## Overview

Template literals provide ES6-style string interpolation using backticks and `${}` syntax. This feature enables cleaner, more readable string composition with embedded expressions.

**Key Features:**
- ES6 backtick syntax: `` `string` ``
- Expression interpolation: `` `${expression}` ``
- Multiple interpolations in a single string
- Nested expressions support
- Maintains JavaScript string semantics

## Syntax

### Basic Template Literals

```lisp
; Plain string with backticks
`hello world`                    ; => "hello world"

; Empty template
``                               ; => ""

; String with spaces
`  spaces around  `              ; => "  spaces around  "
```

### Single Interpolation

```lisp
; At beginning
`${10} apples`                   ; => "10 apples"

; In middle
`I have ${5} apples`             ; => "I have 5 apples"

; At end
`Total: ${42}`                   ; => "Total: 42"

; Only interpolation
`${100}`                         ; => "100"
```

### Multiple Interpolations

```lisp
; Two interpolations
`${1} + ${2} = 3`                ; => "1 + 2 = 3"

; Three interpolations
`${1}, ${2}, ${3}`               ; => "1, 2, 3"

; Consecutive interpolations
`${10}${20}`                     ; => "1020"

; Complex pattern
`Result: ${x} and ${y} = ${(+ x y)}`
```

### Expressions in Interpolations

```lisp
; Arithmetic
`Sum: ${(+ 2 3)}`                ; => "Sum: 5"

; Variables
(let name "Alice")
`Hello, ${name}!`                ; => "Hello, Alice!"

; Function calls
(fn double [x] (* x 2))
`Doubled: ${(double 5)}`         ; => "Doubled: 10"

; Nested expressions
`Result: ${(* (+ 2 3) 4)}`       ; => "Result: 20"
```

## Implementation Details

### Compilation Target

```lisp
; HQL template literal
`Hello ${name}, you are ${age} years old`

; Compiles to JavaScript
`Hello ${name}, you are ${age} years old`
```

Template literals compile directly to JavaScript template literals, maintaining identical semantics.

### Expression Parsing

Interpolated expressions are fully parsed HQL expressions:

```lisp
; Nested function calls work
`Value: ${(get (filter data predicate) 0)}`

; Complex arithmetic works
`Calculated: ${(/ (+ (* a b) c) d)}`
```

### Type Coercion

Template literals follow JavaScript's `toString()` coercion rules:

```lisp
`Number: ${42}`                  ; => "Number: 42"
`Boolean: ${true}`               ; => "Boolean: true"
`Array: ${[1 2 3]}`              ; => "Array: 1,2,3"
`Object: ${{x: 10}}`             ; => "Object: [object Object]"
`Null: ${null}`                  ; => "Null: null"
`Undefined: ${undefined}`        ; => "Undefined: undefined"
```

## Features Covered

✅ Plain template literals (no interpolation)
✅ Single interpolation (beginning, middle, end)
✅ Multiple interpolations
✅ Consecutive interpolations
✅ Arithmetic expressions in interpolations
✅ Variable access in interpolations
✅ Function calls in interpolations
✅ Nested expressions
✅ Type coercion (numbers, booleans, arrays, objects)
✅ Special values (null, undefined)

## Test Coverage



### Section 1: Basic Template Literals
- Plain string
- Empty string
- String with spaces

### Section 2: Single Interpolation
- Interpolation at beginning
- Interpolation in middle
- Interpolation at end
- Only interpolation (no surrounding text)

### Section 3: Multiple Interpolations
- Two interpolations
- Three interpolations
- Consecutive interpolations (no text between)

### Section 4: Expressions in Interpolations
- Arithmetic expressions
- Variable references
- Function calls
- Nested expressions
- Complex calculations
- Method calls

### Section 5: Type Coercion
- Numbers to strings
- Booleans to strings
- Arrays to strings
- Objects to strings
- Null to string
- Undefined to string
- Mixed types

### Section 6: Edge Cases
- Empty interpolations
- Whitespace handling
- Escape sequences
- Unicode characters
- Nested function calls
- Array/object access
- Real-world patterns

## Comparison with Regular Strings

### Before (String Concatenation)

```lisp
; Verbose and error-prone
(+ "Hello, " name "! You are " (toString age) " years old.")

; Hard to read with many values
(+ "Result: " (toString (+ x y)) " (sum of " (toString x) " and " (toString y) ")")
```

### After (Template Literals)

```lisp
; Clean and readable
`Hello, ${name}! You are ${age} years old.`

; Easy to understand
`Result: ${(+ x y)} (sum of ${x} and ${y})`
```

## Real-World Examples

### Logging and Debugging

```lisp
(fn logDebug [variable value]
  (print `DEBUG: ${variable} = ${value}`))

(logDebug "userId" 12345)
; => "DEBUG: userId = 12345"
```

### HTML/Template Generation

```lisp
(fn renderUser [user]
  `<div class="user">
     <h2>${user.name}</h2>
     <p>Email: ${user.email}</p>
   </div>`)

(renderUser {name: "Alice" email: "alice@example.com"})
```

### URL Construction

```lisp
(fn buildApiUrl [endpoint params]
  `/api/${endpoint}?id=${params.id}&type=${params.type}`)

(buildApiUrl "users" {id: 123 type: "admin"})
; => "/api/users?id=123&type=admin"
```

### Error Messages

```lisp
(fn validateAge [age]
  (if (< age 0)
    (throw (new Error `Invalid age: ${age}. Age must be non-negative.`))
    age))
```

## Best Practices

### Use Template Literals for String Composition

```lisp
; ✅ Good: Clear and maintainable
`User ${userId} completed ${taskCount} tasks`

; ❌ Avoid: Harder to read and maintain
(+ "User " (toString userId) " completed " (toString taskCount) " tasks")
```

### Keep Interpolations Simple

```lisp
; ✅ Good: Simple expression
`Total: ${total}`

; ✅ Acceptable: Short calculation
`Price: ${(* quantity price)}`

; ⚠️ Consider refactoring: Too complex
`Result: ${(reduce (map (filter data predicate) transform) combiner initial)}`

; ✅ Better: Extract to variable
(let result (reduce (map (filter data predicate) transform) combiner initial))
`Result: ${result}`
```

### Multiline Templates

```lisp
; Template literals support multiline strings
`This is a long message
 that spans multiple lines
 and includes ${variable}
 for dynamic content.`
```

## Performance Notes

- Template literals compile directly to JavaScript template literals
- No runtime overhead compared to native JavaScript
- Interpolation expressions are evaluated each time the template is evaluated
- For frequently-used templates, consider caching the result

## Limitations

- No raw template strings (JavaScript's `String.raw`)
- No tagged template literals (custom template processors)
- Escape sequences follow JavaScript rules

## Future Enhancements

Potential future additions:
- Tagged template literals for custom processing
- Raw string literals (preserve escape sequences)
- Template literal utilities (dedent, trim, etc.)

## Related Features

- **String concatenation** - `(+ str1 str2)` for simple cases
- **String formatting** - Future feature for printf-style formatting
- **Interpolation macros** - Potential macro-based string builders

## Examples

See `examples.hql` for executable examples demonstrating all template literal features.

## Implementation Location

- Parser: `src/hql/transpiler/pipeline/parser.ts`
- Template literal parsing: Line 537-600
- Test suite: `test/syntax-template-literals.test.ts`
