;; Example class with fn methods
(import [assert] from "@hlvm/assert")

(class Calculator
  ;; Class fields
  (var baseValue)

  ;; Constructor
  (constructor [baseValue]
    (do
      (= this.baseValue baseValue)))

  ;; fn method with JSON map parameters (defaults)
  (fn multiply {"x": 100, "y": 2}
    (* x y))
)

;; Create an instance
(let calc (new Calculator 10))
(assert (=== calc.baseValue 10) "constructor sets field")

;; Test with no arguments - should use both defaults (100 * 2 = 200)
(let defaults-result (calc.multiply))
(assert (=== defaults-result 200) "fn defaults for both params")
(print "fn method with both defaults: calc.multiply() =>" defaults-result)

;; Test with one argument - should use second default (5 * 2 = 10)
(let one-arg-result (calc.multiply {"x": 5}))
(assert (=== one-arg-result 10) "fn default for y")
(print "fn method with one arg: calc.multiply({\"x\": 5}) =>" one-arg-result)

;; Test with both arguments - no defaults used (7 * 3 = 21)
(let two-arg-result (calc.multiply {"x": 7, "y": 3}))
(assert (=== two-arg-result 21) "fn uses explicit params")
(print "fn method with two args: calc.multiply({\"x\": 7, \"y\": 3}) =>" two-arg-result)
