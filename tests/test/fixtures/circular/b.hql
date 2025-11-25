;; test/fixtures/circular/b.hql
;; Basic circular dependency test - Module B

(import [circularValue] from "./a.hql")

(fn incrementCircular (value)
  (+ value circularValue))

(export [incrementCircular])
