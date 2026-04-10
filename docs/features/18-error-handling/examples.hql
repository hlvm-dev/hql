// ============================================
// Error Handling Examples
// ============================================

(import [assert] from "@hlvm/assert")

// --------------------------------------------
// Example 1: Basic try/catch
// --------------------------------------------

(fn safe-parse [json-str]
  (try
    (JSON.parse json-str)
    (catch e
      null)))

(let parsed (safe-parse "{\"a\": 1}"))
(assert (=== (get parsed "a") 1) "valid JSON parsed")

(let failed (safe-parse "not json"))
(assert (=== failed null) "invalid JSON returns null")
(print "safe-parse valid:" parsed)     // => {a: 1}
(print "safe-parse invalid:" failed)   // => null

// --------------------------------------------
// Example 2: Try/catch/finally
// --------------------------------------------

(var cleanup-called false)

(fn process-with-cleanup [value]
  (try
    (do
      (when (=== value null)
        (throw (new Error "null value")))
      (* value 2))
    (catch e
      -1)
    (finally
      (= cleanup-called true))))

(let result1 (process-with-cleanup 5))
(assert (=== result1 10) "successful processing")
(assert (=== cleanup-called true) "finally ran on success")

(= cleanup-called false)
(let result2 (process-with-cleanup null))
(assert (=== result2 -1) "catch returned fallback")
(assert (=== cleanup-called true) "finally ran on error")
(print "process 5:" result1)   // => 10
(print "process null:" result2)  // => -1

// --------------------------------------------
// Example 3: Catch without parameter
// --------------------------------------------

(fn safe-divide [a b]
  (try
    (if (=== b 0)
      (throw (new Error "division by zero"))
      (/ a b))
    (catch e
      Infinity)))

(let div-result (safe-divide 10 0))
(assert (=== div-result Infinity) "catch without param")
(print "10/0:" div-result)  // => Infinity

// --------------------------------------------
// Example 4: Try as expression in let binding
// --------------------------------------------

(let config (try
  (JSON.parse (or (js/globalThis.CONFIG_JSON) "{}"))
  (catch e
    {})))

(print "config:" config)  // => {}

// --------------------------------------------
// Example 5: Throw and rethrow
// --------------------------------------------

(fn validate [x]
  (if (< x 0)
    (throw (new Error "negative value"))
    x))

(fn safe-validate [x]
  (try
    (validate x)
    (catch e
      (let message (js-get e "message"))
      (when (!== message "negative value")
        (throw e))
      0)))  // rethrow unknown errors

(let validated (safe-validate -5))
(assert (=== validated 0) "negative handled")
(print "validate -5:" validated)  // => 0

// --------------------------------------------
// Example 6: Nested try blocks
// --------------------------------------------

(fn nested-error-handling [input]
  (try
    (try
      (JSON.parse input)
      (catch inner-e
        (throw (new Error (+ "Parse failed: " (js-get inner-e "message"))))))
    (catch outer-e
      (+ "Error: " (js-get outer-e "message")))))

(let nested-result (nested-error-handling "bad"))
(assert (=== (typeof nested-result) "string") "nested catch returns string")
(print "nested:" nested-result)

// --------------------------------------------
// Example 7: Try with multiple body expressions
// --------------------------------------------

(fn multi-step [data]
  (try
    (let parsed (JSON.parse data))
    (let value (get parsed "value"))
    (* value 10)
    (catch e
      0)))

(let multi-result (multi-step "{\"value\": 5}"))
(assert (=== multi-result 50) "multi-step success")
(print "multi-step:" multi-result)  // => 50

// --------------------------------------------
// Example 8: Try with only finally
// --------------------------------------------

(var side-effect false)

(let try-result (try
  42
  (finally
    (= side-effect true))))

(assert (=== try-result 42) "try-finally returns body value")
(assert (=== side-effect true) "finally executed")
(print "try-finally:" try-result)  // => 42

// --------------------------------------------
// Example 9: Error types
// --------------------------------------------

(fn check-type-error []
  (try
    (let x null)
    (x.toString)
    (catch e
      (if (instanceof e TypeError)
        "type-error"
        "other-error"))))

(print "error type:" (check-type-error))

// --------------------------------------------
// Example 10: Practical - File-like resource management
// --------------------------------------------

(fn with-resource [resource-fn action-fn]
  (let resource (resource-fn))
  (try
    (action-fn resource)
    (finally
      (when resource.close
        (resource.close)))))

(print "All error handling examples passed!")
