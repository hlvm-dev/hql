;; test/fixtures/math.hql
;; Basic math functions for import testing

(fn add (a b)
  (+ a b))

(fn subtract (a b)
  (- a b))

(fn multiply (a b)
  (* a b))

(fn divide (a b)
  (/ a b))

(export [add, subtract, multiply, divide])
