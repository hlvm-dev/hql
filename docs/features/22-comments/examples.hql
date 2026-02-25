;; ============================================
;; HQL Comment Examples
;; ============================================

;; --- Line Comments ---
// JavaScript-style line comment
;; Lisp-style line comment (preferred in .hql files)

(let x 10) ;; Inline comment after code
(let y 20) // Also works with //

;; --- Block Comments ---
/* This is a
   multi-line block comment
   spanning several lines */

(let result (+ x y))

;; --- Documentation Convention ---
;; Function: add
;; Adds two numbers together.
(fn add [a b]
  ;; Add two numbers
  (+ a b))
