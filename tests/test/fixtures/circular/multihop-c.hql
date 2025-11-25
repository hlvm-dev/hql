;; test/fixtures/circular/multihop-c.hql
;; Multi-hop circular dependency - Module C

(import [aBase] from "./multihop-a.hql")

(fn cFunc ()
  (+ 3 aBase))

(export [cFunc])
