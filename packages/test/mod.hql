(fn assert [condition message]
  (if (not condition)
      (throw (or message "Assertion failed"))
      true))

(fn assert-eq [actual expected message]
  (if (not (= actual expected))
      (throw (+ (or message "Assertion failed") " - Expected: " expected ", Actual: " actual))
      true))

(fn assert-throws [fn message]
  (try
    (fn)
    (throw (or message "Expected function to throw an error, but it didn't"))
    (catch e true)))

(export [assert, assert-eq, assert-throws])
