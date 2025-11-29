;; Mixed exports: macro + function
(macro double [x] `(* 2 ~x))
(fn triple [x] (* 3 x))
(var constant 42)

(export [double, triple, constant])
