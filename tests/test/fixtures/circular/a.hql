;; test/fixtures/circular/a.hql
;; Basic circular dependency test - Module A

(var circularValue 10)

(import [incrementCircular] from "./b.hql")

(fn circularFunction []
  (var result (incrementCircular circularValue))
  result)

(export [circularValue])
(export [circularFunction])
