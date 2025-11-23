;; @hql/math - Math utilities for HQL
;; Version: 0.1.0
;;
;; Usage:
;;   (import [abs, floor, ceil] from "@hql/math")
;;   (abs -5)      ;; => 5
;;   (floor 3.7)   ;; => 3

(fn abs [x]
  "Return absolute value of number.

  Args:
    x - Number

  Returns:
    Absolute value

  Example:
    (abs -5)   ;; => 5
    (abs 3.2)  ;; => 3.2"
  (js/Math.abs x))

(fn floor [x]
  "Round number down to nearest integer.

  Args:
    x - Number to round down

  Returns:
    Floored number

  Example:
    (floor 3.7)  ;; => 3
    (floor -2.3) ;; => -3"
  (js/Math.floor x))

(fn ceil [x]
  "Round number up to nearest integer.

  Args:
    x - Number to round up

  Returns:
    Ceiled number

  Example:
    (ceil 3.2)  ;; => 4
    (ceil -2.7) ;; => -2"
  (js/Math.ceil x))

(fn round [x]
  "Round number to nearest integer.

  Args:
    x - Number to round

  Returns:
    Rounded number

  Example:
    (round 3.7)  ;; => 4
    (round 3.2)  ;; => 3"
  (js/Math.round x))

(fn min [& args]
  "Return minimum value from arguments.

  Args:
    args - Numbers to compare

  Returns:
    Minimum value

  Example:
    (min 1 5 3 9 2)  ;; => 1"
  (js/Math.min.apply nil args))

(fn max [& args]
  "Return maximum value from arguments.

  Args:
    args - Numbers to compare

  Returns:
    Maximum value

  Example:
    (max 1 5 3 9 2)  ;; => 9"
  (js/Math.max.apply nil args))

;; Export all math utilities
(export [abs, floor, ceil, round, min, max])
