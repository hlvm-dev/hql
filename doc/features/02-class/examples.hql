;; Example class with fn methods
(class Calculator
  ;; Class fields
  (var baseValue)

  ;; Constructor
  (constructor [baseValue]
    (do
      (set! this.baseValue baseValue)))

  ;; fn method with JSON map parameters (defaults)
  (fn multiply {"x": 100, "y": 2}
    (* x y))
)

;; Create an instance
(let calc (new Calculator 10))

;; Test with no arguments - should use both defaults (100 * 2 = 200)
(print "fn method with both defaults: calc.multiply() =>" (calc.multiply))

;; Test with one argument - should use second default (5 * 2 = 10)
(print "fn method with one arg: calc.multiply({\"x\": 5}) =>" (calc.multiply {"x": 5}))

;; Test with both arguments - no defaults used (7 * 3 = 21)
(print "fn method with two args: calc.multiply({\"x\": 7, \"y\": 3}) =>" (calc.multiply {"x": 7, "y": 3}))