; hello.hql - Demo: Using deno_std modules, JS-friendly "new", and new caller syntax

;; Import and log using chalk.
(def chalk (import "https://deno.land/x/chalk_deno@v4.1.1-deno/source/index.js"))
(log ((get chalk "blue") "hello hql!"))

;; Import lodash and use its chunk function.
(def lodash (import "npm:lodash"))
(log ((get lodash "chunk") (list 1 2 3 4 5 6) 2))

; ====== Data Structure Constructors ======
(print "====== Data Structures ======")
(def myvec (vector 10 20 30 40))
(print myvec)  ; expected: (vector 10 20 30 40)

(def mymap (hash-map (keyword "a") 100 (keyword "b") 200))
(print mymap)
; expected: (hash-map :a 100 :b 200)

(def myset (new Set (list 1 2 3)))
(print (get myset "size"))  ; expected: 3

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

; ====== Arithmetic Operations ======
(print "====== Arithmetic Operations ======")
(def add
  (fn (a b)
    (+ a b)))
(print (add 3 4))   ; should print 7

(def inc
  (fn (n)
    (+ n 1)))
(print (inc 10))    ; should print 11

; ====== New Syntax Demonstrations ======
(print "====== New Syntax (fx, defn, defx) Demo ======")

; Untyped function using defn (positional call)
(defn addN (x y)
  (+ x y))
(print (addN 2 3))  ; Expected: 5

; Typed function using defn (labeled call)
(defn minus (x: Number y: Number) (-> Number)
  (- x y))
(print (minus x: 100 y: 20))  ; Expected: 80

; Using fx to define a pure function (typed, labeled call)
(def pureMultiply (fx (a: Number b: Number) (-> Number)
  (* a b)))
(print (pureMultiply x: 4 y: 5))  ; Expected: 20

; ====== Sync/Async Exports ======
(print "====== Sync/Async Exports ======")

(defsync addSync
  (fn (x: Number y: Number) (-> Number)
    (+ x y)))

(def minusSync
  (fn (x: Number y: Number) (-> Number)
    (- x y)))

(export "addSync" addSync)
(export "minusSync" minusSync)

(def addDynamic
  (fn (x y)
    (+ x y)))

(def minusDynamic
  (fn (x y)
    (- x y)))

(export "addDynamic" addDynamic)
(export "minusDynamic" minusDynamic)
