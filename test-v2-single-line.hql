; === ARITHMETIC ===
(+ 1 2 3)
(- 10 3)
(* 3 4)
(/ 20 4)
(% 7 3)
(** 2 8)
; === COMPARISONS ===
(== 5 5)
(!= 5 3)
(< 3 5)
(> 5 3)
(<= 5 5)
(>= 5 5)
; === LOGICAL ===
(and true true)
(or true false)
(not false)
; === BITWISE ===
(& 12 10)
(| 12 10)
(^ 12 10)
(<< 5 2)
(>> 20 2)
; === STRINGS ===
"Hello v2.0"
(+ "Hello" " " "World")
; === VARIABLES ===
(let x 42)
x
(var y 100)
y
; === SIMPLE FUNCTION ===
(fn add [a b] (+ a b))
(add 10 20)
; === ARROW LAMBDA ===
(map (=> (* $0 2)) [1 2 3 4 5])
; === ARRAYS ===
[1 2 3 4 5]
; === OBJECTS ===
{"name": "HQL", "version": 2.0, "working": true}
; === CONDITIONALS ===
(if true 100 200)
(if false 100 200)
; === TYPEOF ===
(typeof 42)
(typeof "string")
; === TERNARY ===
(? true "yes" "no")
; === LOGICAL CHAINING ===
(&& true true)
(|| false true)
; === NULLISH COALESCING ===
(?? null 999)
; === VOID ===
(void 0)
; === COMPLEX ===
(+ (* 2 3) (/ 20 4))
close()
