;; Arrow Lambda Examples - Swift-style $N parameters

;; ============================================================================
;; Section 1: Implicit Parameters
;; ============================================================================

;; Single parameter
(let double (=> (* $0 2)))
(print "double 5 =" (double 5))  ;; → 10

;; Multiple parameters
(let add (=> (+ $0 $1)))
(print "add 3 7 =" (add 3 7))    ;; → 10

;; With map
(let nums [1 2 3 4 5])
(print "doubled:" (doall (map (=> (* $0 2)) nums)))  ;; → [2 4 6 8 10]

;; With filter
(print "filtered:" (doall (filter (=> (> $0 5)) [1 3 6 8 2 9])))  ;; → [6 8 9]

;; With reduce
(print "sum:" (reduce (=> (+ $0 $1)) 0 [1 2 3 4 5]))  ;; → 15

;; ============================================================================
;; Section 2: Explicit Parameters
;; ============================================================================

;; Named parameter
(let square (=> (x) (* x x)))
(print "square 7 =" (square 7))  ;; → 49

;; Multiple named parameters
(let multiply (=> (x y) (* x y)))
(print "multiply 6 7 =" (multiply 6 7))  ;; → 42

;; Zero parameters
(let get-constant (=> () 42))
(print "constant =" (get-constant))  ;; → 42

;; ============================================================================
;; Section 3: Member Access
;; ============================================================================

;; Simple property access
(let users [{name: "Alice", age: 30}, {name: "Bob", age: 25}])
(print "names:" (doall (map (=> ($0.name)) users)))  ;; → ["Alice", "Bob"]

;; ============================================================================
;; Section 4: Chaining
;; ============================================================================

;; Complex pipeline
(let result
  (take 3
    (filter (=> (> $0 0))
      (map (=> (* $0 2))
        [-1 1 -2 2 3]))))
(print "chained:" (doall result))  ;; → [2 4 6]

;; ============================================================================
;; Section 5: Real-World Examples
;; ============================================================================

;; Sort array
(let nums [5 2 8 1 9 3])
(print "sorted:" ((nums.slice 0).sort (=> (- $0 $1))))  ;; → [1 2 3 5 8 9]

;; Transform data
(let data [{x: 1, y: 2}, {x: 3, y: 4}])
(print "sums:" (doall (map (=> (+ $0.x $0.y)) data)))  ;; → [3 7]

;; Find in array
(let found (users.find (=> (= $0.name "Bob"))))
(print "found age:" (found.age))  ;; → 25

print "All arrow lambda examples completed!"
