;; Import mixed: macro + function + constant
(import [double, triple, constant] from "./edge-case-mixed.hql")

;; Use macro
(var macro-result (double 5))

;; Use function
(var func-result (triple 5))

;; Use constant
(var const-result constant)

;; Return all results
[macro-result, func-result, const-result]
