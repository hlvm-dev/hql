; ============================================
; COMPREHENSIVE v2.0 FEATURE TEST
; Testing ALL operators and syntax features
; ============================================

; === ARITHMETIC OPERATORS ===
(+ 1 2)
(+ 1 2 3 4)
(- 10 3)
(- 20 5 2)
(* 3 4)
(* 2 3 4)
(/ 20 4)
(/ 100 10 2)
(% 7 3)
(** 2 3)
(** 2 10)

; === COMPARISON OPERATORS ===
(== 5 5)
(== 5 3)
(!= 5 3)
(!= 5 5)
(< 3 5)
(< 5 3)
(> 5 3)
(> 3 5)
(<= 5 5)
(<= 5 3)
(>= 5 5)
(>= 3 5)

; === LOGICAL OPERATORS ===
(and true true)
(and true false)
(and false false)
(or true true)
(or true false)
(or false false)
(not true)
(not false)

; === BITWISE OPERATORS ===
(& 12 10)
(| 12 10)
(^ 12 10)
(<< 5 2)
(>> 20 2)
(>>> 20 2)

; === TYPEOF & INSTANCEOF ===
(typeof 42)
(typeof "string")
(typeof true)

; === STRING OPERATIONS ===
"Hello, World!"
(+ "Hello" " " "World")
(+ "v" "2" "." "0")

; === VARIABLES ===
(let x 10)
x
(var y 20)
y
(let z (+ x y))
z

; === FUNCTION DEFINITIONS ===
(fn add [a b] (+ a b))
(add 5 7)
(add 10 20)

(fn multiply [x y] (* x y))
(multiply 6 7)

(fn factorial [n]
  (if (<= n 1)
    1
    (* n (factorial (- n 1)))))
(factorial 5)
(factorial 10)

; === ARROW LAMBDAS ===
(map (=> (* $0 2)) [1 2 3])
(map (=> (+ $0 10)) [5 10 15])
(filter (=> (> $0 5)) [1 3 5 7 9])

; === ARRAYS ===
[1 2 3 4 5]
[10 20 30]
(map (=> (* $0 2)) [1 2 3 4 5])

; === OBJECTS ===
{"name": "HQL", "version": "2.0"}
{"x": 10, "y": 20, "sum": 30}
{"features": ["operators", "functions", "lambdas"]}

; === CONDITIONALS ===
(if true 1 2)
(if false 1 2)
(if (> 10 5) "yes" "no")
(if (< 10 5) "yes" "no")

; === TERNARY ===
(? true "yes" "no")
(? false "yes" "no")
(? (== 5 5) 100 200)

; === LOGICAL CHAINING ===
(&& true true)
(&& true false)
(|| false true)
(|| false false)

; === VOID OPERATOR ===
(void 0)
(void (+ 1 2))

; === DELETE OPERATOR ===
(let obj {"a": 1, "b": 2})
(delete obj "a")

; === IN OPERATOR ===
(in "length" [1 2 3])
(in "x" {"x": 10})

; === SPREAD IN ARRAYS ===
[1 ...[2 3] 4]
[...[1 2] ...[3 4]]

; === OPTIONAL CHAINING ===
(let obj {"a": {"b": 10}})
(?. obj "a" "b")
(?. obj "x" "y")

; === NULLISH COALESCING ===
(?? null 42)
(?? undefined 42)
(?? 10 42)

; === COMPLEX EXPRESSIONS ===
(+ (* 2 3) (/ 10 2))
(+ (+ 1 2) (* 3 4))
(let result (+ (* 6 7) 10))
result

; === RECURSION ===
(fn fibonacci [n]
  (if (<= n 1)
    n
    (+ (fibonacci (- n 1)) (fibonacci (- n 2)))))
(fibonacci 10)

; === CLOSURES ===
(fn makeCounter []
  (let count 0)
  (fn [] (var count (+ count 1)) count))
(let counter (makeCounter))
(counter)
(counter)
(counter)

; === ALL DONE ===
close()
