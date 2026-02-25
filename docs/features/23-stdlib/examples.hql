;; ============================================
;; HQL Standard Library Examples
;; ============================================

;; --- Sequence Primitives ---
(first [1 2 3])         ;; => 1
(rest [1 2 3])          ;; => (2 3)
(cons 0 [1 2 3])        ;; => (0 1 2 3)

;; --- Collection Operations ---
(map inc [1 2 3])                ;; => (2 3 4)
(filter even? [1 2 3 4 5 6])    ;; => (2 4 6)
(reduce + 0 [1 2 3 4])          ;; => 10
(take 3 (range 10))             ;; => (0 1 2)
(drop 2 [1 2 3 4 5])            ;; => (3 4 5)

;; --- Infinite Sequences ---
(take 5 (range))                ;; => (0 1 2 3 4)
(take 3 (repeat "hello"))       ;; => ("hello" "hello" "hello")
(take 6 (cycle [1 2 3]))        ;; => (1 2 3 1 2 3)
(take 5 (iterate inc 0))        ;; => (0 1 2 3 4)

;; --- Lazy Fibonacci ---
(fn fibs []
  (let fib-seq (fn fib-seq [a b]
    (lazy-seq (cons a (fib-seq b (+ a b)))))]
    (fib-seq 0 1)))
(take 10 (fibs))  ;; => (0 1 1 2 3 5 8 13 21 34)

;; --- Predicates ---
(some even? [1 3 4 5])          ;; => true
(every odd? [1 3 5 7])          ;; => true
(isEmpty [])                     ;; => true

;; --- Transducers ---
(transduce
  (comp (map inc) (filter even?))
  + 0
  [1 2 3 4 5])                  ;; => 12

;; --- Map Operations ---
(def person {name: "Alice" age: 30})
(keys person)                    ;; => ("name" "age")
(vals person)                    ;; => ("Alice" 30)
(assoc person "email" "a@b.com") ;; => {name: "Alice" age: 30 email: "a@b.com"}
