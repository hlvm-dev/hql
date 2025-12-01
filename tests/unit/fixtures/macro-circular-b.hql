;; Circular B: defines macro-b, imports macro-a
(macro macro-b [x] `(* ~x 2))
(fn func-b [x] (* x 2))

(export [macro-b, func-b])

;; Import from A (completes circular dependency)
(import [macro-a, func-a] from "./macro-circular-a.hql")

;; Use A's exports
(var test-a-macro (macro-a 5))
(var test-a-func (func-a 5))
