;; @hql/test - Testing utilities for HQL
;; Version: 0.1.0
;;
;; Usage:
;;   (import [assert, assert-eq, assert-throws] from "@hql/test")
;;   (assert true "should be true")

(fn assert [condition message]
  "Assert that a condition is truthy.

  Args:
    condition - Value to test (should be truthy)
    message - Error message if assertion fails (optional)

  Throws:
    Error if condition is falsy

  Example:
    (assert (=== 1 1) \"1 should equal 1\")
    (assert (> 5 3) \"5 should be greater than 3\")"
  (if condition
    true
    (throw (new js/Error (if message message "Assertion failed")))))

(fn assert-eq [actual expected message]
  "Assert that two values are equal using deep equality.

  Args:
    actual - Actual value
    expected - Expected value
    message - Error message if assertion fails (optional)

  Throws:
    Error if values are not equal

  Example:
    (assert-eq (+ 1 2) 3 \"1 + 2 should equal 3\")
    (assert-eq {\"a\" 1} {\"a\" 1} \"objects should be equal\")"
  (var actualStr (js/JSON.stringify actual))
  (var expectedStr (js/JSON.stringify expected))
  (var isEqual (=== actualStr expectedStr))
  (if isEqual
    true
    (do
      (var errorMsg
        (if message
          (str message " - Expected: " expectedStr ", Actual: " actualStr)
          (str "Assertion failed - Expected: " expectedStr ", Actual: " actualStr)))
      (throw (new js/Error errorMsg)))))

(fn assert-throws [testFn expectedMessage]
  "Assert that a function throws an error.

  Args:
    testFn - Function that should throw
    expectedMessage - Expected error message substring (not yet implemented)

  Throws:
    Error if function doesn't throw

  Returns:
    true if assertion passes

  Example:
    (assert-throws (fn [] (throw (new js/Error \"oops\"))) nil)
    (assert-throws (fn [] (/ 1 0)) nil)"
  (var didThrow false)
  (try
    (testFn)
    (catch err (= didThrow true)))
  (if didThrow
    true
    (throw (new js/Error "Expected function to throw an error, but it didn't"))))

;; Export all test utilities
(export [assert, assert-eq, assert-throws])
