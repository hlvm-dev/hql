; ============================================================================
; Operator Examples - Executable Specification
; ============================================================================
; These examples serve as both documentation and executable tests
; Run with: hlvm examples.hql

; ============================================================================
; SECTION 1: ARITHMETIC OPERATORS
; ============================================================================

; Addition with integers
(assert (= (+ 10 20) 30) "Integer addition")
(assert (= (+ 5 7) 12) "Addition should work")

; Addition with floats
(assert (= (+ 10.5 20.3) 30.8) "Float addition")
(assert (= (+ 1.1 2.2) 3.3) "Float precision")

; Addition with multiple operands
(assert (= (+ 1 2 3 4 5) 15) "Multi-operand addition")
(assert (= (+ 10 20 30) 60) "Three operand addition")

; Subtraction
(assert (= (- 50 30) 20) "Integer subtraction")
(assert (= (- 100.5 50.25) 50.25) "Float subtraction")
(assert (= (- 0 10) -10) "Subtraction to negative")

; Multiplication
(assert (= (* 6 7) 42) "Integer multiplication")
(assert (= (* 2.5 4.0) 10.0) "Float multiplication")
(assert (= (* 3 3) 9) "Squaring")

; Division
(assert (= (/ 100 5) 20) "Integer division")
(assert (= (/ 10.0 4.0) 2.5) "Float division")
(assert (= (/ 20 4) 5) "Exact division")

; Modulo
(assert (= (% 17 5) 2) "Modulo operation")
(assert (= (% 10 3) 1) "Remainder")
(assert (= (% 20 5) 0) "No remainder")

; Nested arithmetic
(let nested (+ (* 2 3) (- 10 5)))
(assert (= nested 11) "Nested arithmetic: (2*3) + (10-5)")

; Complex expression
(let complex (+ (* 2 (+ 3 4)) (/ 20 4)))
(assert (= complex 19) "Complex: 2*(3+4) + 20/4 = 14 + 5")

; ============================================================================
; SECTION 2: COMPARISON OPERATORS
; ============================================================================

; Less than
(assert (< 5 10) "5 is less than 10")
(assert (not (< 10 5)) "10 is not less than 5")
(assert (< -5 0) "Negative less than zero")

; Greater than
(assert (> 10 5) "10 is greater than 5")
(assert (not (> 5 10)) "5 is not greater than 10")
(assert (> 0 -5) "Zero greater than negative")

; Less than or equal
(assert (<= 10 10) "Equal case for <=")
(assert (<= 5 10) "Less case for <=")
(assert (not (<= 10 5)) "Not less or equal")

; Greater than or equal
(assert (>= 10 10) "Equal case for >=")
(assert (>= 15 10) "Greater case for >=")
(assert (not (>= 5 10)) "Not greater or equal")

; Equality
(assert (= 42 42) "Number equality")
(assert (= "hello" "hello") "String equality")
(assert (= true true) "Boolean equality")
(assert (= null null) "Null equality")

; Inequality
(assert (!= 10 20) "Numbers are not equal")
(assert (!= "foo" "bar") "Strings are not equal")
(assert (not (!= 10 10)) "Same numbers are equal")

; Comparison chains (using and)
(assert (and (> 10 5) (< 10 15)) "10 is between 5 and 15")
(assert (and (>= 10 10) (<= 10 10)) "Range includes 10")

; ============================================================================
; SECTION 3: LOGICAL OPERATORS
; ============================================================================

; Logical AND
(assert (and true true) "AND with both true")
(assert (not (and true false)) "AND with one false")
(assert (not (and false false)) "AND with both false")

; Logical OR
(assert (or true true) "OR with both true")
(assert (or true false) "OR with one true")
(assert (not (or false false)) "OR with both false")

; Logical NOT
(assert (not false) "NOT false is true")
(assert (not (not true)) "Double negation")

; Combined logical operations
(assert (and (or true false) (not false)) "Combined logic 1")
(assert (or (and false true) (not false)) "Combined logic 2")

; Short-circuit evaluation (implicitly tested)
(let condition (or true (/ 1 0)))  ; Second arg not evaluated
(assert condition "OR short-circuits")

; Complex logical expression
(assert (and (> 10 5) (or (= 10 10) (< 10 5))) "Complex boolean logic")

; ============================================================================
; SECTION 4: PRIMITIVE TYPES
; ============================================================================

; Integer numbers
(assert (= 42 42) "Integer 42")
(assert (= 0 0) "Zero")
(assert (= -42 -42) "Negative integer")

; Floating-point numbers
(assert (= 3.14159 3.14159) "Pi approximation")
(assert (= 0.5 0.5) "Half")
(assert (= -1.5 -1.5) "Negative float")

; Strings
(assert (= "Hello, HQL!" "Hello, HQL!") "String literal")
(assert (= "" "") "Empty string")
(assert (= "123" "123") "Numeric string")

; Booleans
(assert (= true true) "Boolean true")
(assert (= false false) "Boolean false")
(assert (!= true false) "True is not false")

; Null and undefined
(assert (= null null) "Null value")
(assert (= undefined undefined) "Undefined value")
(assert (!= null undefined) "Null is not undefined")

; Type consistency
(var num 42)
(assert (= num 42) "Variable holds integer")

(var str "test")
(assert (= str "test") "Variable holds string")

(var bool true)
(assert bool "Variable holds boolean")

; ============================================================================
; SECTION 5: STRING OPERATIONS
; ============================================================================

; String concatenation with +
(let greeting (+ "Hello, " "World!"))
(assert (= greeting "Hello, World!") "String concatenation")

(let fullName (+ "John" " " "Doe"))
(assert (= fullName "John Doe") "Multiple string concat")

; String length property
(var message "Hello")
(assert (= message.length 5) "String length property")

(var empty "")
(assert (= empty.length 0) "Empty string length")

; String charAt method
(var word "Hello")
(assert (= (word.charAt 0) "H") "First character")
(assert (= (word.charAt 1) "e") "Second character")
(assert (= (word.charAt 4) "o") "Last character")

; String concatenation with numbers (type coercion)
(let mixed (+ "Count: " 42))
(assert (= mixed "Count: 42") "String + number concatenation")

; ============================================================================
; SECTION 6: COMBINED EXPRESSIONS
; ============================================================================

; Arithmetic with comparison
(assert (> (+ 10 20) 25) "30 is greater than 25")
(assert (< (- 10 5) 10) "5 is less than 10")
(assert (= (* 5 4) 20) "5 times 4 equals 20")

; Comparison with logical operators
(assert (and (> 10 5) (< 3 7)) "Both comparisons true")
(assert (or (> 5 10) (< 3 7)) "One comparison true")
(assert (not (and (> 5 10) (< 10 3))) "Both comparisons false")

; Complex nested expression with variables
(var x 10)
(var y 20)
(assert (and (> x 5) (or (= y 20) (< y 10))) "Complex with vars")

; Arithmetic in variable assignment
(var a 5)
(var b 10)
(var c (+ (* a 2) b))
(assert (= c 20) "Computed value: (5*2) + 10")

; Chained operations
(var start 0)
(var step1 (+ start 10))
(var step2 (* step1 2))
(var result (- step2 5))
(assert (= result 15) "Chained: ((0+10)*2)-5 = 15")

; Conditional logic with operators
(fn isPositive [n]
  (> n 0))

(assert (isPositive 10) "10 is positive")
(assert (not (isPositive -5)) "-5 is not positive")

; Range check function
(fn inRange [value min max]
  (and (>= value min) (<= value max)))

(assert (inRange 50 0 100) "50 in range [0,100]")
(assert (not (inRange 150 0 100)) "150 not in range")

; ============================================================================
; REAL-WORLD EXAMPLE: CALCULATOR
; ============================================================================

; Simple calculator functions
(fn add [a b]
  (+ a b))

(fn subtract [a b]
  (- a b))

(fn multiply [a b]
  (* a b))

(fn divide [a b]
  (/ a b))

; Test calculator
(assert (= (add 10 20) 30) "Calculator add")
(assert (= (subtract 50 30) 20) "Calculator subtract")
(assert (= (multiply 6 7) 42) "Calculator multiply")
(assert (= (divide 100 5) 20) "Calculator divide")

; ============================================================================
; REAL-WORLD EXAMPLE: VALIDATION
; ============================================================================

; Validate age is in valid range
(fn isValidAge [age]
  (and (>= age 0) (<= age 150)))

(assert (isValidAge 25) "25 is valid age")
(assert (isValidAge 0) "0 is valid age")
(assert (not (isValidAge -5)) "-5 is invalid age")
(assert (not (isValidAge 200)) "200 is invalid age")

; Validate score is passing
(fn isPassing [score]
  (>= score 60))

(assert (isPassing 85) "85 is passing")
(assert (isPassing 60) "60 is passing")
(assert (not (isPassing 59)) "59 is not passing")

; Validate string is not empty
(fn isNonEmpty [str]
  (> str.length 0))

(assert (isNonEmpty "hello") "Non-empty string")
(assert (not (isNonEmpty "")) "Empty string fails")

; ============================================================================
; REAL-WORLD EXAMPLE: MATH UTILITIES
; ============================================================================

; Calculate average
(fn average [a b c]
  (/ (+ a b c) 3))

(assert (= (average 10 20 30) 20) "Average of 10,20,30")

; Check if even
(fn isEven [n]
  (= (% n 2) 0))

(assert (isEven 10) "10 is even")
(assert (not (isEven 11)) "11 is odd")

; Check if in range
(fn clamp [value min max]
  (if (< value min)
    min
    (if (> value max)
      max
      value)))

(assert (= (clamp 5 0 100) 5) "5 within range")
(assert (= (clamp -5 0 100) 0) "-5 clamped to 0")
(assert (= (clamp 150 0 100) 100) "150 clamped to 100")

; ============================================================================
; SUMMARY
; ============================================================================

(print "✅ All operator examples passed!")
(print "   - Arithmetic operators: ✓")
(print "   - Comparison operators: ✓")
(print "   - Logical operators: ✓")
(print "   - Primitive types: ✓")
(print "   - String operations: ✓")
(print "   - Combined expressions: ✓")
(print "   - Real-world examples: ✓")
