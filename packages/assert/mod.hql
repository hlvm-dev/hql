(fn assert [condition message]
  (if condition
    true
    (throw (new Error (if message message "Assertion failed")))))

(fn assertEqual [actual expected message]
  (let isEqual
    (if (&& (|| (Array.isArray actual) (=== (typeof actual) "object"))
            (|| (Array.isArray expected) (=== (typeof expected) "object")))
      (=== (JSON.stringify actual) (JSON.stringify expected))
      (=== actual expected)))
  (assert isEqual message))

(export [assert, assertEqual])
