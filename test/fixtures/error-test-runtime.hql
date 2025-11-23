;; Test file for runtime error reporting
;; This file contains intentional errors to test error messages

(fn divide (a b)
  "Divides two numbers"
  (/ a b))

(fn get-property (obj prop)
  "Gets a property from an object"
  (. obj prop))

(fn call-with-undefined ()
  "This will fail because 'undefined-var' doesn't exist"
  (+ 10 undefined-var))

(fn nested-error-outer (x)
  "Outer function that calls middle"
  (nested-error-middle x))

(fn nested-error-middle (x)
  "Middle function that calls inner"
  (nested-error-inner x))

(fn nested-error-inner (x)
  "Inner function that causes the error"
  (. x nonexistent-property))

;; Main execution
(export divide)
(export get-property)
(export call-with-undefined)
(export nested-error-outer)
