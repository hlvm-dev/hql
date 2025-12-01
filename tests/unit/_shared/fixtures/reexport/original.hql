;; test/fixtures/reexport/original.hql
;; Original module with functions to be re-exported

(fn greet [name]
  (+ "Hello, " name "!"))

(fn farewell [name]
  (+ "Goodbye, " name "!"))

(var secretValue 42)

(export [greet, farewell, secretValue])
