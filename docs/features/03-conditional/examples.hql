;; cond.hql - Comprehensive tests for the cond special form
;; This file tests various scenarios for the cond special form to ensure it works correctly

(import [assert] from "@hlvm/assert")

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
(let cn150 (classify-number 150))
(assert (=== cn150 "large") "classify-number 150")
(print "classify-number(150):" cn150)  ;; Should be "large"
(let cn100 (classify-number 100))
(assert (=== cn100 "medium") "classify-number 100")
(print "classify-number(100):" cn100)  ;; Should be "medium"
(let cn75 (classify-number 75))
(assert (=== cn75 "medium") "classify-number 75")
(print "classify-number(75):" cn75)   ;; Should be "medium"
(let cn50 (classify-number 50))
(assert (=== cn50 "small") "classify-number 50")
(print "classify-number(50):" cn50)  ;; Should be "small"
(let cn25 (classify-number 25))
(assert (=== cn25 "small") "classify-number 25")
(print "classify-number(25):" cn25)  ;; Should be "small"
(let cn10 (classify-number 10))
(assert (=== cn10 "tiny") "classify-number 10")
(print "classify-number(10):" cn10)  ;; Should be "tiny"
(let cn5 (classify-number 5))
(assert (=== cn5 "tiny") "classify-number 5")
(print "classify-number(5):" cn5)    ;; Should be "tiny"
(let cn0 (classify-number 0))
(assert (=== cn0 "zero") "classify-number 0")
(print "classify-number(0):" cn0)    ;; Should be "zero"
(let cnNeg10 (classify-number -10))
(assert (=== cnNeg10 "negative") "classify-number -10")
(print "classify-number(-10):" cnNeg10)  ;; Should be "negative"

(print "\n=== Testing check-value ===")
(let cv20 (check-value 20))
(assert (=== cv20 "greater") "check-value 20")
(print "check-value(20):" cv20)   ;; Should be "greater"
(let cv10 (check-value 10))
(assert (=== cv10 "equal") "check-value 10")
(print "check-value(10):" cv10)   ;; Should be "equal"
(let cv5 (check-value 5))
(assert (=== cv5 "less") "check-value 5")
(print "check-value(5):" cv5)    ;; Should be "less"

(print "\n=== Testing check-point ===")
(let cp55 (check-point 5 5))
(assert (=== cp55 "first quadrant") "check-point 5,5")
(print "check-point(5, 5):" cp55)      ;; Should be "first quadrant"
(let cpNeg55 (check-point -5 5))
(assert (=== cpNeg55 "second quadrant") "check-point -5,5")
(print "check-point(-5, 5):" cpNeg55)     ;; Should be "second quadrant"
(let cpNegNeg55 (check-point -5 -5))
(assert (=== cpNegNeg55 "third quadrant") "check-point -5,-5")
(print "check-point(-5, -5):" cpNegNeg55)    ;; Should be "third quadrant"
(let cp5Neg5 (check-point 5 -5))
(assert (=== cp5Neg5 "fourth quadrant") "check-point 5,-5")
(print "check-point(5, -5):" cp5Neg5)     ;; Should be "fourth quadrant"
(let cp00 (check-point 0 0))
(assert (=== cp00 "origin") "check-point 0,0")
(print "check-point(0, 0):" cp00)      ;; Should be "origin"
(let cp05 (check-point 0 5))
(assert (=== cp05 "positive y-axis") "check-point 0,5")
(print "check-point(0, 5):" cp05)      ;; Should be "positive y-axis"
(let cp0Neg5 (check-point 0 -5))
(assert (=== cp0Neg5 "negative y-axis") "check-point 0,-5")
(print "check-point(0, -5):" cp0Neg5)     ;; Should be "negative y-axis"

(print "\n=== Testing check-boolean ===")
(let cbTrue (check-boolean true))
(assert (=== cbTrue "Value is true") "check-boolean true")
(print "check-boolean(true):" cbTrue)   ;; Should be "Value is true"
(let cbFalse (check-boolean false))
(assert (=== cbFalse "Value is false") "check-boolean false")
(print "check-boolean(false):" cbFalse)  ;; Should be "Value is false"

(print "\n=== Testing grade-score ===")
(let gs95 (grade-score 95))
(assert (=== gs95 "A") "grade-score 95")
(print "grade-score(95):" gs95)  ;; Should be "A"
(let gs85 (grade-score 85))
(assert (=== gs85 "B") "grade-score 85")
(print "grade-score(85):" gs85)  ;; Should be "B"
(let gs75 (grade-score 75))
(assert (=== gs75 "C") "grade-score 75")
(print "grade-score(75):" gs75)  ;; Should be "C"
(let gs65 (grade-score 65))
(assert (=== gs65 "D") "grade-score 65")
(print "grade-score(65):" gs65)  ;; Should be "D"
(let gs55 (grade-score 55))
(assert (=== gs55 "F") "grade-score 55")
(print "grade-score(55):" gs55)  ;; Should be "F"
