; hello.hql - Showcases various HQL features with clear log markers

; ====== Arithmetic Operations ======
(println "====== Arithmetic Operations ======")
(def add
  (fn ((x Int) (y Int))
      (-> Int)
      (+ x y)))
(println (add 3 4))   ; should print 7

(def inc
  (fn ((n Int))
      (-> Int)
      (+ n 1)))
(println (inc 10))    ; should print 11

(def mult
  (fn ((a Int) (b Int))
      (ret Int)
      (* a b)))
(println (mult 5 6))  ; should print 30

; ====== Data Structure Constructors ======
(println "====== Data Structures ======")
(def myvec (vector 10 20 30 40))
(println myvec)  ; expected: (vector 10 20 30 40)

(def mymap (hash-map (keyword "a") 100 (keyword "b") 200))
(println mymap)
; expected: (hash-map :a 100 :b 200)

(def myset (set 1 2 3 4 5))
(println myset)
; expected: (set 1 2 3 4 5)

; ====== Sync/Async Exports ======
(println "====== Sync/Async Exports ======")
; defsync guarantees synchronous behavior (if no async sneaks in)
(defsync add
  (fn ((x Number) (y Number))
      (-> Number)
      (+ x y)))
; def yields an async function (to be awaited when called)
(def minus
  (fn ((x Number) (y Number))
      (-> Number)
      (- x y)))
(export "add" add)
(export "minus" minus)

; Additional functions (async style)
(def add2
  (fn ((x) (y))
    (+ x y)))
(def minus2
  (fn ((x) (y))
    (- x y)))
(export "add2" add2)
(export "minus2" minus2)
