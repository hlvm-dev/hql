; hello.hql - Demo: Using deno_std modules and JS-friendly "new"

;; Import and log using chalk.
(def chalk (import "https://deno.land/x/chalk_deno@v4.1.1-deno/source/index.js"))
(log ((get chalk "blue") "hello hql!"))

;; Import lodash and use its chunk function.
(def lodash (import "npm:lodash"))
(log ((get lodash "chunk") (list 1 2 3 4 5 6) 2))

; ====== Arithmetic Operations ======
(print "====== Arithmetic Operations ======")
(def add
  (fn ((x Int) (y Int))
      (return Int)
      (+ x y)))
(print (add 3 4))   ; should print 7

(def inc
  (fn ((n Int))
      (return Int)
      (+ n 1)))
(print (inc 10))    ; should print 11

(def mult
  (fn ((a Int) (b Int))
      (return Int)
      (* a b)))
(print (mult 5 6))  ; should print 30

; ====== Data Structure Constructors ======
(print "====== Data Structures ======")
(def myvec (vector 10 20 30 40))
(print myvec)  ; expected: (vector 10 20 30 40)

(def mymap (hash-map (keyword "a") 100 (keyword "b") 200))
(print mymap)
; expected: (hash-map :a 100 :b 200)

(def myset (set 1 2 3 4 5))
(print myset)
; expected: (set 1 2 3 4 5)

; ====== Standard Library Demo ======
(print "====== Standard Library Demo ======")
;; Import the path module from deno_std.
(def pathModule (import "https://deno.land/std@0.170.0/path/mod.ts"))
(def join (get pathModule "join"))
(print (join "foo" "bar" "baz.txt"))
; Expected: "foo/bar/baz.txt"

;; Import the datetime module from deno_std.
(def datetime (import "https://deno.land/std@0.170.0/datetime/mod.ts"))
(def format (get datetime "format"))
(print (format (new Date) "yyyy-MM-dd HH:mm:ss"))
; Expected: the current date/time in the given format

;; Import the uuid module from deno_std.
(def uuidModule (import "https://deno.land/std@0.170.0/uuid/mod.ts"))
(def generate (get uuidModule "v4"))
(print generate)
; Expected: a new UUID string

; ====== New Special Form Test ======
(print "====== New Special Form Test ======")
(def arr (new Array 1 2 3))
(print arr)  ; Expected: [1,2,3]
(def m (new Map))
(print (get m "size"))  ; Expected: 0

; ====== Sync/Async Exports ======
(print "====== Sync/Async Exports ======")
(defsync add
  (fn ((x Number) (y Number))
      (return Number)
      (+ x y)))
(def minus
  (fn ((x Number) (y Number))
      (return Number)
      (- x y)))
(export "add" add)
(export "minus" minus)
(def add2
  (fn ((x) (y))
    (+ x y)))
(def minus2
  (fn ((x) (y))
    (- x y)))
(export "add2" add2)
(export "minus2" minus2)
