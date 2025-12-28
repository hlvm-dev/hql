;; cond.hql - Comprehensive tests for the cond special form
;; This file tests various scenarios for the cond special form to ensure it works correctly

;; Test function 1: Number classification
(fn classify-number [n]
  (cond
    ((> n 100) "large")     ;; Greater than 100: "large"
    ((> n 50) "medium")     ;; Between 51-100: "medium"
    ((> n 10) "small")      ;; Between 11-50: "small"
    ((> n 0) "tiny")        ;; Between 1-10: "tiny"
    ((=== n 0) "zero")      ;; Exactly 0: "zero"
    (else "negative")))     ;; Less than 0: "negative"

;; Test function 2: Simple test with few clauses
(fn check-value [val]
  (cond
    ((> val 10) "greater")
    ((=== val 10) "equal")
    (else "less")))

;; Test function 3: Testing nested conditions
(fn check-point [x y]
  (cond
    ((< x 0) (cond
              ((< y 0) "third quadrant")
              (else "second quadrant")))
    ((> x 0) (cond
              ((< y 0) "fourth quadrant")
              (else "first quadrant")))
    (else (cond
           ((=== y 0) "origin")
           ((> y 0) "positive y-axis")
           (else "negative y-axis")))))

;; Test function 4: Test with boolean conditions and true-false values
(fn check-boolean [val]
  (cond
    (val "Value is true")
    (else "Value is false")))

;; Test function 5: Multiple predicates with same result
(fn grade-score [score]
  (cond
    ((>= score 90) "A")
    ((>= score 80) "B")
    ((>= score 70) "C")
    ((>= score 60) "D")
    (else "F")))

;; Run the tests with various inputs to verify all conditions

(print "=== Testing classify-number ===")
(print "classify-number(150):" (classify-number 150))  ;; Should be "large"
(print "classify-number(100):" (classify-number 100))  ;; Should be "medium"
(print "classify-number(75):"  (classify-number 75))   ;; Should be "medium"
(print "classify-number(50):"  (classify-number 50))   ;; Should be "small"
(print "classify-number(25):"  (classify-number 25))   ;; Should be "small"
(print "classify-number(10):"  (classify-number 10))   ;; Should be "tiny"
(print "classify-number(5):"   (classify-number 5))    ;; Should be "tiny"
(print "classify-number(0):"   (classify-number 0))    ;; Should be "zero"
(print "classify-number(-10):" (classify-number -10))  ;; Should be "negative"

(print "\n=== Testing check-value ===")
(print "check-value(20):" (check-value 20))   ;; Should be "greater"
(print "check-value(10):" (check-value 10))   ;; Should be "equal"
(print "check-value(5):"  (check-value 5))    ;; Should be "less"

(print "\n=== Testing check-point ===")
(print "check-point(5, 5):"   (check-point 5 5))      ;; Should be "first quadrant"
(print "check-point(-5, 5):"  (check-point -5 5))     ;; Should be "second quadrant"
(print "check-point(-5, -5):" (check-point -5 -5))    ;; Should be "third quadrant"
(print "check-point(5, -5):"  (check-point 5 -5))     ;; Should be "fourth quadrant"
(print "check-point(0, 0):"   (check-point 0 0))      ;; Should be "origin"
(print "check-point(0, 5):"   (check-point 0 5))      ;; Should be "positive y-axis"
(print "check-point(0, -5):"  (check-point 0 -5))     ;; Should be "negative y-axis"

(print "\n=== Testing check-boolean ===")
(print "check-boolean(true):"  (check-boolean true))   ;; Should be "Value is true"
(print "check-boolean(false):" (check-boolean false))  ;; Should be "Value is false"

(print "\n=== Testing grade-score ===")
(print "grade-score(95):" (grade-score 95))  ;; Should be "A"
(print "grade-score(85):" (grade-score 85))  ;; Should be "B"
(print "grade-score(75):" (grade-score 75))  ;; Should be "C"
(print "grade-score(65):" (grade-score 65))  ;; Should be "D"
(print "grade-score(55):" (grade-score 55))  ;; Should be "F"
