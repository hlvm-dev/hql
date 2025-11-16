;; Source file with mixed exports
(macro double (x) `(* 2 ~x))
(fn triple (x) (* 3 x))
(var magic-number 42)

(export [double, triple, magic-number])
