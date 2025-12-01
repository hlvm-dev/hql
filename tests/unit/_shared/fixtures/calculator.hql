;; test/fixtures/calculator.hql
;; Class for import testing (v2.0)

(class Calculator
  (var value 0)

  (constructor (initial)
    (= this.value initial))

  (fn add [x]
    (= this.value (+ this.value x))
    this.value)

  (fn multiply [x]
    (= this.value (* this.value x))
    this.value))

(export [Calculator])
