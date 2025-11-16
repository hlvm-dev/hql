;; Test file for compile-time error reporting
;; This file has intentional syntax errors

(let valid-var 10)

(let another-valid 20)

;; This line has an unclosed parenthesis
(let broken-var (+ 10 20

(let after-error 30)
