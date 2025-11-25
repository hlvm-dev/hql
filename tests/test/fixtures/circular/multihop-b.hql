;; test/fixtures/circular/multihop-b.hql
;; Multi-hop circular dependency - Module B

(import [cFunc] from "./multihop-c.hql")

(fn bFunc ()
  (+ 2 (cFunc)))

(export [bFunc])
