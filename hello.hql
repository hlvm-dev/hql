; hello.hql - Showcases the "keyword" function that yields a symbol like :a

; We no longer define (def keyword...) ourselves. Instead, we rely on the
; built-in "keyword" function that returns a symbol named :something.

; Functions with type annotations:

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

; Data structure constructors:

(def myvec (vector 10 20 30 40))
(println myvec)  ; => (vector 10 20 30 40)

; Use the new built-in (keyword) to produce symbols like :a
(def mymap (hash-map (keyword "a") 100 (keyword "b") 200))
(println mymap)
; => (hash-map :a 100 :b 200)

(def myset (set 1 2 3 4 5))
(println myset)
; => (set 1 2 3 4 5)


;; (def add
;;   (fn ((x Number) (y Number))
;;     (+ x y)))

;; (def minus
;;   (fn ((x Number) (y Number))
;;     (+ x (* -1 y))))

;; ; Export them so JS can import
;; (export "add" add)
;; (export "minus" minus)