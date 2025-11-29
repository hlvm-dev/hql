(let number 0)
;; (= number 10) => ERROR: Cannot assign to "number" because it is a constant
(print "number: " number)

(var number2 0)
(= number2 10)
(print "number2: " number2)

(let (x 1000 y 20 z 30)
    (print x)
)

(var (x 100 y 20 z 30)
  (print x)
  (= x 10)
  (print x)
)

(let (x 10
        y 20
        z (+ x y))
    (print "Multiple bindings test:")
    (print "x =" x)
    (print "y =" y)
    ;; (= z 99) => not allowed
    (print "z =" z)
    (print "x + y + z =" (+ x (+ y z))))

(var (x 10
      y 20
      z (+ x y))
    (print "Multiple bindings test:")
    (print "x =" x)
    (print "y =" y)
    (= z 99)
    (print "z =" z)
    (print "x + y + z =" (+ x (+ y z))))