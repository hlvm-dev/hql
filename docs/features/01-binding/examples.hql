(let number 0)
(= number 10) ; Allowed: let is mutable
(print "number: " number)

(var number2 0)
(= number2 10) ; Allowed: var is mutable
(print "number2: " number2)

(const PI 3.14159)
;; (= PI 3.0) ; ERROR: Cannot assign to "PI" because it is a constant
(print "PI: " PI)

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
    (= z 99) ; Allowed: let is mutable
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
