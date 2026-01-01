;; ============================================
;; TCO Examples - Tail Call Optimization
;; ============================================

;; All these functions are automatically optimized
;; to use while loops instead of recursive calls.

;; --------------------------------------------
;; Example 1: Factorial with Accumulator
;; --------------------------------------------

(fn factorial [n acc]
  (if (<= n 1)
    acc
    (factorial (- n 1) (* n acc))))

(print "factorial 5:" (factorial 5 1))    ;; => 120
(print "factorial 10:" (factorial 10 1))  ;; => 3628800

;; --------------------------------------------
;; Example 2: Sum of 1 to N
;; --------------------------------------------

(fn sum [n acc]
  (if (<= n 0)
    acc
    (sum (- n 1) (+ acc n))))

(print "sum 100:" (sum 100 0))    ;; => 5050
(print "sum 1000:" (sum 1000 0))  ;; => 500500

;; --------------------------------------------
;; Example 3: Fibonacci (Tail-Recursive)
;; --------------------------------------------

(fn fib [n a b]
  (if (=== n 0)
    a
    (fib (- n 1) b (+ a b))))

(print "fib 10:" (fib 10 0 1))  ;; => 55
(print "fib 20:" (fib 20 0 1))  ;; => 6765
(print "fib 40:" (fib 40 0 1))  ;; => 102334155

;; --------------------------------------------
;; Example 4: GCD (Euclidean Algorithm)
;; --------------------------------------------

(fn gcd [a b]
  (if (=== b 0)
    a
    (gcd b (% a b))))

(print "gcd 48 18:" (gcd 48 18))    ;; => 6
(print "gcd 100 25:" (gcd 100 25))  ;; => 25
(print "gcd 17 13:" (gcd 17 13))    ;; => 1

;; --------------------------------------------
;; Example 5: Power Function
;; --------------------------------------------

(fn power [base exp acc]
  (if (<= exp 0)
    acc
    (power base (- exp 1) (* acc base))))

(print "2^10:" (power 2 10 1))  ;; => 1024
(print "3^5:" (power 3 5 1))    ;; => 243

;; --------------------------------------------
;; Example 6: Count Digits
;; --------------------------------------------

(fn count-digits [n acc]
  (if (< n 10)
    (+ acc 1)
    (count-digits (/ n 10) (+ acc 1))))

(print "digits in 12345:" (count-digits 12345 0))  ;; => 5
(print "digits in 1000000:" (count-digits 1000000 0))  ;; => 7

;; --------------------------------------------
;; Example 7: String Repeat
;; --------------------------------------------

(fn repeat-str [n s acc]
  (if (<= n 0)
    acc
    (repeat-str (- n 1) s (+ acc s))))

(print "repeat 'x' 5 times:" (repeat-str 5 "x" ""))  ;; => "xxxxx"

;; --------------------------------------------
;; Example 8: Deep Recursion Test
;; --------------------------------------------

(fn countdown [n]
  (if (<= n 0)
    0
    (countdown (- n 1))))

;; This would stack overflow without TCO
(print "countdown 50000:" (countdown 50000))  ;; => 0

;; --------------------------------------------
;; Example 9: Collatz Sequence Length
;; --------------------------------------------

(fn collatz-length [n steps]
  (if (=== n 1)
    steps
    (if (=== (% n 2) 0)
      (collatz-length (/ n 2) (+ steps 1))
      (collatz-length (+ (* n 3) 1) (+ steps 1)))))

(print "collatz length of 27:" (collatz-length 27 0))  ;; => 111

;; --------------------------------------------
;; Example 10: Binary Search (Tail-Recursive)
;; --------------------------------------------

(fn binary-search [arr target low high]
  (if (> low high)
    -1
    (let (mid (Math.floor (/ (+ low high) 2))
          mid-val (get arr mid))
      (if (=== mid-val target)
        mid
        (if (< mid-val target)
          (binary-search arr target (+ mid 1) high)
          (binary-search arr target low (- mid 1)))))))

(let (sorted-arr [1 3 5 7 9 11 13 15 17 19])
  (print "search for 7:" (binary-search sorted-arr 7 0 9))    ;; => 3
  (print "search for 15:" (binary-search sorted-arr 15 0 9))  ;; => 7
  (print "search for 4:" (binary-search sorted-arr 4 0 9)))   ;; => -1

;; --------------------------------------------
;; Comparison: Non-Tail vs Tail
;; --------------------------------------------

;; NON-TAIL (not optimized, will stack overflow for large n)
(fn factorial-naive [n]
  (if (<= n 1)
    1
    (* n (factorial-naive (- n 1)))))

;; TAIL (optimized, works for any n)
(fn factorial-tail [n acc]
  (if (<= n 1)
    acc
    (factorial-tail (- n 1) (* n acc))))

(print "naive factorial 5:" (factorial-naive 5))   ;; => 120
(print "tail factorial 5:" (factorial-tail 5 1))   ;; => 120
