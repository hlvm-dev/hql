;; test/fixtures/calculator.hql
;; Class for import testing

(class Calculator
  (var value 0)

  (constructor (initial)
    (set! this.value initial))

  (fn add (x)
    (set! this.value (+ this.value x))
    this.value)

  (fn multiply (x)
    (set! this.value (* this.value x))
    this.value))

(export [Calculator])
