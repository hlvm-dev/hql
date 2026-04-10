(import [assert] from "@hlvm/assert")

(var count 0)
(= count 10)
(assert (=== count 10) "var binding is mutable")
(print "count: " count)

(var total 0)
(= total 10)
(assert (=== total 10) "second var binding is mutable")
(print "total: " total)

(const PI 3.14159)
// (= PI 3.0) ERROR: Cannot assign to "PI" because it is a constant
(assert (=== PI 3.14159) "const binding holds value")
(print "PI: " PI)

(let (x 1000 y 20 z 30)
    (assert (=== x 1000) "let binds x")
    (assert (=== y 20) "let binds y")
    (assert (=== z 30) "let binds z")
    (print x)
)

(var (x 100 y 20 z 30)
  (assert (=== x 100) "var binds x")
  (assert (=== y 20) "var binds y")
  (assert (=== z 30) "var binds z")
  (print x)
  (= x 10)
  (assert (=== x 10) "var allows reassignment")
  (print x)
)

(let (x 10
        y 20
        z (+ x y))
    (print "Multiple bindings test:")
    (print "x =" x)
    (print "y =" y)
    (assert (=== z 30) "let derived binding")
    (print "z =" z)
    (assert (=== (+ x (+ y z)) 60) "let binding sum")
    (print "x + y + z =" (+ x (+ y z))))

(var (x 10
      y 20
      z (+ x y))
    (print "Multiple bindings test:")
    (print "x =" x)
    (print "y =" y)
    (assert (=== z 30) "var derived binding")
    (= z 99)
    (assert (=== z 99) "var allows reassignment")
    (print "z =" z)
    (assert (=== (+ x (+ y z)) 129) "var binding sum")
    (print "x + y + z =" (+ x (+ y z))))
