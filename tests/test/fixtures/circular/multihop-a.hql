;; test/fixtures/circular/multihop-a.hql
;; Multi-hop circular dependency - Module A

(var aBase 1)
(import [bFunc] from "./multihop-b.hql")

(fn aFunc ()
  (+ aBase (bFunc)))

(export [aBase])
(export [aFunc])
