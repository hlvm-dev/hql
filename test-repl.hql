; HQL REPL Test Script
; This script tests all major v2.0 features

; === Arithmetic Operations ===
(+ 1 2)
(- 10 5)
(* 3 4)
(/ 20 4)
(% 7 3)
(** 2 3)

; === Comparison Operators ===
(== 5 5)
(!= 5 3)
(< 3 5)
(> 5 3)
(<= 5 5)
(>= 6 5)

; === Logical Operators ===
(and true false)
(or true false)
(not true)

; === String Operations ===
"Hello, World!"
(+ "Hello" " " "World")

; === Variables ===
(let x 10)
x
(var y 20)
y

; === Functions ===
(fn add [a b] (+ a b))
(add 5 7)

(fn multiply [x y] (* x y))
(multiply 6 7)

; === Arrow Lambda ===
(map (=> (* $0 2)) [1 2 3])

; === Arrays ===
[1 2 3 4 5]
(map (=> (+ $0 1)) [1 2 3])

; === Objects ===
{"name": "HQL", "version": "2.0"}

; === Conditionals ===
(if true 1 2)
(if false 1 2)

; === Exit ===
close()
