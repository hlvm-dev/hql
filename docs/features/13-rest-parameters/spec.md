# Rest Parameters Feature Documentation

**Implementation:** Built-in syntax (transpiler core) **Test Count:** 18 tests **Coverage:** ✅ 100% **Version:** v2.0

## Overview

Rest parameters provide JavaScript-style variadic function parameters using the `...` prefix syntax. This feature allows functions to accept an indefinite number of arguments collected into an array.

**Key Features:**
- JavaScript `...rest` syntax
- Collects remaining arguments into an array
- Works with regular positional parameters
- Zero or more arguments collected
- Native JavaScript spread semantics

## Syntax

### Basic Rest Parameters

```lisp
; Only rest parameter
(fn sum [...nums]
  (.reduce nums (fn [acc val] (+ acc val)) 0))

(sum 1 2 3 4 5)  ; => 15
```

### Rest with Regular Parameters

```lisp
; Rest with single regular param
(fn sum [x ...rest]
  (+ x (.reduce rest (fn [acc val] (+ acc val)) 0)))

(sum 10 1 2 3)  ; => 16

; Rest with multiple regular params
(fn sum [x y ...rest]
  (+ x y (.reduce rest (fn [acc val] (+ acc val)) 0)))

(sum 10 20 1 2 3)  ; => 36
```

### Empty Rest Arrays

```lisp
; Rest parameter with no arguments
(fn getLength [...items]
  (get items "length"))

(getLength)      ; => 0 (empty array)
(getLength 1 2)  ; => 2 (two items)

; Rest with required params, no extra args
(fn sum [x y ...rest]
  (+ x y (get rest "length")))

(sum 10 20)  ; => 30 (rest is empty array)
```

## Features

### Array Operations

Rest parameters are real JavaScript arrays with all array methods:

```lisp
; Array indexing
(fn getSecond [...items]
  (get items 1))

(getSecond 10 20 30)  ; => 20

; Array length
(fn count [...items]
  (get items "length"))

(count 1 2 3 4 5)  ; => 5

; Array methods
(fn sumAll [...nums]
  (.reduce nums (fn [a b] (+ a b)) 0))

(sumAll 1 2 3 4)  ; => 10
```

### Type Safety

Rest parameters collect any type of argument:

```lisp
; Mixed types
(fn collectAll [...items]
  items)

(collectAll 1 "hello" true [1 2])
; => [1, "hello", true, [1, 2]]
```

## Implementation Details

### Compilation Target

```lisp
; HQL rest parameter
(fn sum [...nums]
  (.reduce nums (fn [a b] (+ a b)) 0))

; Compiles to JavaScript
function sum(...nums) {
  return nums.reduce((a, b) => a + b, 0);
}
```

### Position Requirements

- Rest parameter must be the **last** parameter
- Only one rest parameter allowed per function
- Can follow zero or more regular parameters

```lisp
; ✅ Valid
(fn f [...rest])           ; Only rest
(fn f [a ...rest])         ; One regular + rest
(fn f [a b ...rest])       ; Two regular + rest

; ❌ Invalid (would cause transpiler error)
; (fn f [...rest a])       ; Rest must be last
; (fn f [...rest1 ...rest2])  ; Only one rest allowed
```

## Features Covered

✅ Rest parameters alone (no regular params)
✅ Rest with single regular parameter
✅ Rest with multiple regular parameters
✅ Empty rest arrays (no arguments provided)
✅ Array indexing on rest parameters
✅ Array length property
✅ Array methods (.reduce, .map, .filter, etc.)
✅ Mixed type collection
✅ Iteration over rest parameters
✅ Nested function calls with rest
✅ Method calls on rest arrays

## Test Coverage

**Total Tests:** 18

### Section 1: Basic Rest Parameters (3 tests)
- Only rest parameter
- Rest with single regular param
- Rest with multiple regular params

### Section 2: Empty Rest Arrays (2 tests)
- Empty rest array with only rest param
- Empty rest array with regular params

### Section 3: Rest Parameter Access (3 tests)
- Array indexing
- Array length property
- Array methods (.reduce)

### Section 4: Type Handling (3 tests)
- String collection
- Mixed types
- Object collection

### Section 5: Array Methods (4 tests)
- .map on rest parameters
- .filter on rest parameters
- .reduce for sums
- .join for strings

### Section 6: Real-world Patterns (3 tests)
- Logging with variable arguments
- Math operations (min, max, average)
- Function composition with rest

## Use Cases

### Variadic Functions

```lisp
; Sum any number of values
(fn sum [...numbers]
  (.reduce numbers (fn [acc n] (+ acc n)) 0))

(sum 1 2 3)     ; => 6
(sum 10 20)     ; => 30
(sum 5)         ; => 5

; Find maximum
(fn max [...numbers]
  (.reduce numbers
    (fn [acc n] (? (> n acc) n acc))
    (get numbers 0)))

(max 3 7 2 9 1)  ; => 9
```

### Required + Optional Parameters

```lisp
; First param required, rest optional
(fn greet [name ...titles]
  (let titleStr (.join titles ", "))
  (? (> (get titles "length") 0)
     `${name}, ${titleStr}`
     name))

(greet "Alice")                    ; => "Alice"
(greet "Bob" "Dr." "PhD")          ; => "Bob, Dr., PhD"
```

### Logging and Debugging

```lisp
(fn log [level ...messages]
  (let combined (.join messages " "))
  `[${level}] ${combined}`)

(log "INFO" "Server" "started" "successfully")
; => "[INFO] Server started successfully"

(log "ERROR" "Connection" "failed" "after" "3" "retries")
; => "[ERROR] Connection failed after 3 retries"
```

### Function Composition

```lisp
; Apply function to all arguments
(fn applyToAll [fn ...args]
  (.map args fn))

(fn double [x] (* x 2))
(applyToAll double 1 2 3 4)  ; => [2, 4, 6, 8]
```

## Real-World Examples

### Calculator Functions

```lisp
(fn add [...nums]
  (.reduce nums (fn [a b] (+ a b)) 0))

(fn multiply [...nums]
  (.reduce nums (fn [a b] (* a b)) 1))

(fn average [...nums]
  (/ (add ...nums) (get nums "length")))

(add 1 2 3 4)        ; => 10
(multiply 2 3 4)     ; => 24
(average 10 20 30)   ; => 20
```

### String Building

```lisp
(fn concat [...strings]
  (.join strings ""))

(fn concatWithSep [sep ...strings]
  (.join strings sep))

(concat "Hello" " " "World")           ; => "Hello World"
(concatWithSep ", " "apple" "banana")  ; => "apple, banana"
```

### Data Collection

```lisp
(fn collectUsers [...userData]
  (.map userData (fn [data]
    {id: (get data 0)
     :name (get data 1)})))

(collectUsers [1 "Alice"] [2 "Bob"] [3 "Charlie"])
; => [{id: 1 :name: "Alice"} {id: 2 :name: "Bob"} {id: 3 :name: "Charlie"}]
```

## Best Practices

### Use Rest for True Variadic Functions

```lisp
; ✅ Good: Truly variable number of arguments
(fn sum [...numbers]
  (.reduce numbers + 0))

; ❌ Avoid: Use array parameter instead
; (fn sumArray [...numbers]  ; Caller must spread array
;   ...)
; Better:
(fn sumArray [numbers]  ; Direct array parameter
  (.reduce numbers + 0))
```

### Name Rest Parameters Descriptively

```lisp
; ✅ Good: Clear plural names
(fn sum [...numbers])
(fn concat [...strings])
(fn log [...messages])

; ❌ Avoid: Generic or confusing names
; (fn sum [...args])
; (fn concat [...rest])
```

### Combine with Regular Parameters

```lisp
; ✅ Good: Required param + optional rest
(fn formatList [title ...items]
  `${title}: ${(.join items ", ")}`)

(formatList "Colors" "red" "green" "blue")
; => "Colors: red, green, blue"
```

### Validate Rest Parameter Count

```lisp
(fn requireAtLeastTwo [first ...rest]
  (if (< (get rest "length") 1)
    (throw (new Error "At least 2 arguments required"))
    (+ first (.reduce rest + 0))))

(requireAtLeastTwo 1 2)    ; => 3 ✓
(requireAtLeastTwo 1)      ; => Error ✗
```

## Performance Notes

- Rest parameters create a new array on each call
- Performance identical to JavaScript rest parameters
- For high-frequency calls with many arguments, consider array parameter
- Array methods on rest parameters are native JavaScript (fast)

## Comparison with Array Parameters

### Rest Parameters

```lisp
; Caller provides individual arguments
(fn sum [...nums]
  (.reduce nums + 0))

(sum 1 2 3 4)  ; Natural call syntax
```

### Array Parameters

```lisp
; Caller provides array
(fn sumArray [nums]
  (.reduce nums + 0))

(sumArray [1 2 3 4])  ; Must construct array
```

**When to use rest:**
- Function naturally accepts variable arguments
- Caller has individual values
- API feels more natural with separate arguments

**When to use array:**
- Caller already has an array
- Need to pass array to multiple functions
- Working with array transformations

## Limitations

- Only one rest parameter per function
- Must be the last parameter
- Cannot use with map-style `{}` parameter syntax
- No destructuring in rest parameters

## Future Enhancements

Potential future additions:
- Rest parameter destructuring: `(fn f [...[first second ...rest]])`
- Rest parameters in method definitions
- Rest parameters with default values

## Related Features

- **Spread operator** - Use `...array` to expand arrays into arguments
- **Function arity** - Functions with rest parameters have variable arity
- **Array methods** - All JavaScript array methods work on rest parameters

## Examples

See `examples.hql` for executable examples demonstrating all rest parameter patterns.

## Implementation Location

- Parser: `src/transpiler/syntax/function.ts`
- Rest parameter handling: Lines handling `...` prefix in parameters
- Test suite: `test/syntax-rest-params.test.ts`
