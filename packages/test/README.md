# @hql/test

Testing utilities for HQL.

> **Note**: This package is embedded in HQL. No installation required - just import and use.

## Usage

**In HQL:**
```hql
(import [assert, assert-eq, assert-throws] from "@hql/test")

;; Basic assertion
(assert (= 1 1) "1 should equal 1")

;; Equality assertion
(assert-eq (+ 2 2) 4 "2 + 2 should equal 4")

;; Assert that function throws
(assert-throws (fn () (throw (js/Error. "error"))) "error")
```

## API

### `assert`

Assert that a condition is truthy.

**Arguments:**
- `condition` - Value to test (should be truthy)
- `message` - Optional error message if assertion fails

**Throws:** Error if condition is falsy

**Returns:** `true` if assertion passes

### `assert-eq`

Assert that two values are equal using deep equality (JSON comparison).

**Arguments:**
- `actual` - Actual value
- `expected` - Expected value
- `message` - Optional error message prefix if assertion fails

**Throws:** Error if values are not equal

**Returns:** `true` if assertion passes

### `assert-throws`

Assert that a function throws an error.

**Arguments:**
- `fn` - Function that should throw
- `expectedMessage` - Optional substring that should appear in error message

**Throws:** Error if function doesn't throw or message doesn't match

**Returns:** `true` if assertion passes

## Examples

### Basic Assertions

```hql
(import [assert] from "@hql/test")

;; Assert truthy values
(assert true "should be true")
(assert 1 "1 is truthy")
(assert "hello" "non-empty strings are truthy")

;; Assert conditions
(assert (= 1 1) "equality check")
(assert (> 5 3) "comparison check")
(assert (not false) "negation check")
```

### Equality Assertions

```hql
(import [assert-eq] from "@hql/test")

;; Numbers
(assert-eq (+ 1 2) 3 "addition")
(assert-eq (* 4 5) 20 "multiplication")

;; Strings
(assert-eq "hello" "hello" "string equality")

;; Objects
(assert-eq {"a": 1, "b": 2} {"a": 1, "b": 2} "object equality")

;; Arrays
(assert-eq [1, 2, 3] [1, 2, 3] "array equality")
```

### Exception Assertions

```hql
(import [assert-throws] from "@hql/test")

;; Assert any error is thrown
(assert-throws (fn () (throw (js/Error. "boom"))))

;; Assert specific error message
(assert-throws
  (fn () (throw (js/Error. "file not found")))
  "file not found")

;; Assert error from division by zero
(assert-throws (fn () (/ 1 0)))
```

### Complete Test Example

```hql
(import [assert, assert-eq, assert-throws] from "@hql/test")

;; Define function to test
(fn add (a b)
  (if (or (not (number? a)) (not (number? b)))
    (throw (js/Error. "arguments must be numbers"))
    (+ a b)))

;; Test normal cases
(assert-eq (add 1 2) 3 "should add two numbers")
(assert-eq (add 0 0) 0 "should handle zeros")
(assert-eq (add -1 1) 0 "should handle negative numbers")

;; Test error cases
(assert-throws (fn () (add "1" 2)) "arguments must be numbers")
(assert-throws (fn () (add nil 2)) "arguments must be numbers")

(console.log "All tests passed!")
```

## License

MIT

## Version

0.1.0
