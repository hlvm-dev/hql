; Testing Expression Everywhere Limits

; 1. Try/Catch as expression
; Expected: Should return the value of the executed block
(print "Test 1: Try/Catch")
(try
  (let res1 (try
             (throw "error")
             (catch e "caught")))
  (print "res1:" res1)
  (catch e (print "Failed to compile/run try as expression:" e)))

; 2. While as expression
; Expected: while usually returns nil/undefined, but should be valid syntax
(print "Test 2: While")
(try
  (let i 0)
  (let res2 (while (< i 3)
              (= i (+ i 1))
              i)) ; last value?
  (print "res2:" res2)
  (catch e (print "Failed to compile/run while as expression:" e)))

; 3. Cond as expression (should work as it expands to if)
(print "Test 3: Cond")
(let res3 (cond
            (false 1)
            (true 2)
            (else 3)))
(print "res3:" res3)

; 4. Do as expression
(print "Test 4: Do")
(try
  (let res4 (do
              (print "side effect")
              42))
  (print "res4:" res4)
  (catch e (print "Failed to compile/run do as expression:" e)))

; 5. Throw as expression
(print "Test 5: Throw as expression")
(try
  (let res5 (throw "oops"))
  (print "res5:" res5)
  (catch e (print "Caught expected throw:" e)))
