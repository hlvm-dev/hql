;; Arrow Lambda Examples - Swift-style $N parameters

(import [assert, assertEqual] from "@hlvm/assert")

;; ============================================================================
;; Section 1: Implicit Parameters
;; ============================================================================

;; Single parameter
(let double (=> (* $0 2)))
(let double5 (double 5))
(assert (=== double5 10) "implicit param $0")
(print "double 5 =" double5)  ;; → 10

;; Multiple parameters
(let add (=> (+ $0 $1)))
(let add37 (add 3 7))
(assert (=== add37 10) "implicit params $0 $1")
(print "add 3 7 =" add37)    ;; → 10

;; With map
(let nums [1 2 3 4 5])
(let doubled (doall (map (=> (* $0 2)) nums)))
(assertEqual doubled [2, 4, 6, 8, 10] "map with arrow lambda")
(print "doubled:" doubled)  ;; → [2 4 6 8 10]

;; With filter
(let filtered (doall (filter (=> (> $0 5)) [1 3 6 8 2 9])))
(assertEqual filtered [6, 8, 9] "filter with arrow lambda")
(print "filtered:" filtered)  ;; → [6 8 9]

;; With reduce
(let sum (reduce (=> (+ $0 $1)) 0 [1 2 3 4 5]))
(assert (=== sum 15) "reduce with arrow lambda")
(print "sum:" sum)  ;; → 15

;; ============================================================================
;; Section 2: Explicit Parameters
;; ============================================================================

;; Named parameter - uses [] for explicit params
(let square (=> [x] (* x x)))
(let square7 (square 7))
(assert (=== square7 49) "explicit param")
(print "square 7 =" square7)  ;; → 49

;; Multiple named parameters
(let multiply (=> [x y] (* x y)))
(let multiply67 (multiply 6 7))
(assert (=== multiply67 42) "multiple explicit params")
(print "multiply 6 7 =" multiply67)  ;; → 42

;; Zero parameters
(let get-constant (=> [] 42))
(let constant (get-constant))
(assert (=== constant 42) "zero-arg lambda")
(print "constant =" constant)  ;; → 42

;; ============================================================================
;; Section 3: Member Access
;; ============================================================================

;; Simple property access
(let users [{name: "Alice", age: 30}, {name: "Bob", age: 25}])
(let names (doall (map (=> ($0.name)) users)))
(assertEqual names ["Alice", "Bob"] "member access")
(print "names:" names)  ;; → ["Alice", "Bob"]

;; ============================================================================
;; Section 4: Chaining
;; ============================================================================

;; Complex pipeline
(let result
  (take 3
    (filter (=> (> $0 0))
      (map (=> (* $0 2))
        [-1 1 -2 2 3]))))
(let chained (doall result))
(assertEqual chained [2, 4, 6] "chained pipeline")
(print "chained:" chained)  ;; → [2 4 6]

;; ============================================================================
;; Section 5: Real-World Examples
;; ============================================================================

;; Sort array
(let nums-to-sort [5 2 8 1 9 3])
(let sorted ((nums-to-sort.slice 0).sort (=> (- $0 $1))))
(assertEqual sorted [1, 2, 3, 5, 8, 9] "sort comparator")
(print "sorted:" sorted)  ;; → [1 2 3 5 8 9]

;; Transform data
(let data [{x: 1, y: 2}, {x: 3, y: 4}])
(let sums (doall (map (=> (+ $0.x $0.y)) data)))
(assertEqual sums [3, 7] "map with member access")
(print "sums:" sums)  ;; → [3 7]

;; Find in array
(let found (users.find (=> (=== $0.name "Bob"))))
(assert (=== found.age 25) "find with arrow lambda")
(print "found age:" found.age)  ;; → 25

(print "All arrow lambda examples completed!")
