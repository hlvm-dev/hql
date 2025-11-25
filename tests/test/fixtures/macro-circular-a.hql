;; Circular A: defines macro-a, imports macro-b
(macro macro-a (x) `(+ ~x 10))
(fn func-a (x) (+ x 1))

(export [macro-a, func-a])

;; Import from B (creates circular dependency)
(import [macro-b, func-b] from "./macro-circular-b.hql")

;; Use B's exports
(var test-b-macro (macro-b 5))
(var test-b-func (func-b 5))
