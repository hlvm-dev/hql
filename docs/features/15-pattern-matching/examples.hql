;; ============================================
;; Pattern Matching Examples
;; ============================================
;; Run with: hlvm run examples.hql

(import [assert, assertEqual] from "@hlvm/assert")

;; --------------------------------------------
;; 1. Literal Matching
;; --------------------------------------------

(print "=== Literal Matching ===")

;; Match numbers
(let result (match 42
              (case 0 "zero")
              (case 42 "the answer")
              (default "other")))
(assert (=== result "the answer") "literal match number")
(print "match 42:" result)  ; => "the answer"

;; Match strings
(let greeting (match "hello"
                (case "hello" "Hi there!")
                (case "bye" "Goodbye!")
                (default "What?")))
(assert (=== greeting "Hi there!") "literal match string")
(print "match hello:" greeting)  ; => "Hi there!"

;; Match booleans
(let flag (match true
            (case true "yes")
            (case false "no")))
(assert (=== flag "yes") "literal match boolean")
(print "match true:" flag)  ; => "yes"

;; Match null
(let nullable (match null
                (case null "nothing")
                (default "something")))
(assert (=== nullable "nothing") "literal match null")
(print "match null:" nullable)  ; => "nothing"

;; --------------------------------------------
;; 2. Symbol Binding
;; --------------------------------------------

(print "\n=== Symbol Binding ===")

;; Bind and use value
(let doubled (match 21
               (case x (* x 2))))
(assert (=== doubled 42) "symbol binding")
(print "21 doubled:" doubled)  ; => 42

;; Fallback binding
(let description (match "test"
                   (case 42 "is a number")
                   (case s (+ "is a string: " s))))
(assert (=== description "is a string: test") "fallback binding")
(print "description:" description)  ; => "is a string: test"

;; --------------------------------------------
;; 3. Wildcard Pattern
;; --------------------------------------------

(print "\n=== Wildcard Pattern ===")

;; Wildcard as catch-all
(let status (match 999
              (case 200 "OK")
              (case 404 "Not Found")
              (case _ "Unknown")))
(assert (=== status "Unknown") "wildcard match")
(print "status 999:" status)  ; => "Unknown"

;; --------------------------------------------
;; 4. Array Patterns
;; --------------------------------------------

(print "\n=== Array Patterns ===")

;; Empty array
(let empty-check (match []
                   (case [] "empty")
                   (default "not empty")))
(assert (=== empty-check "empty") "array empty")
(print "[] is:" empty-check)  ; => "empty"

;; Single element
(let single (match [42]
              (case [] "empty")
              (case [x] (+ "single: " x))
              (default "multiple")))
(assert (=== single "single: 42") "array single")
(print "[42] is:" single)  ; => "single: 42"

;; Two elements with sum
(let sum-pair (match [3, 7]
                (case [a, b] (+ a b))
                (default 0)))
(assert (=== sum-pair 10) "array pair")
(print "[3, 7] sum:" sum-pair)  ; => 10

;; Rest pattern - get tail
(let tail (match [1, 2, 3, 4]
            (case [] [])
            (case [h, & t] t)))
(assertEqual tail [2, 3, 4] "array rest tail")
(print "[1,2,3,4] tail:" tail)  ; => [2, 3, 4]

;; Rest pattern - get head
(let head (match [10, 20, 30]
            (case [h, & t] h)))
(assert (=== head 10) "array rest head")
(print "[10,20,30] head:" head)  ; => 10

;; --------------------------------------------
;; 5. Object Patterns
;; --------------------------------------------

(print "\n=== Object Patterns ===")

;; Object destructuring
(let person {"name": "Alice", "age": 30})
(let info (match person
            (case {name: n, age: a} (+ n " is " a))
            (default "unknown")))
(assert (=== info "Alice is 30") "object destructuring")
(print "person info:" info)  ; => "Alice is 30"

;; Single key extraction
(let config {"port": 8080})
(let port (match config
            (case {port: p} p)
            (default 3000)))
(assert (=== port 8080) "object key extraction")
(print "port:" port)  ; => 8080

;; --------------------------------------------
;; 6. Guards
;; --------------------------------------------

(print "\n=== Guards ===")

;; Simple guard
(let sign (match 10
            (case x (if (> x 0)) "positive")
            (case x (if (< x 0)) "negative")
            (default "zero")))
(assert (=== sign "positive") "guard positive")
(print "10 is:" sign)  ; => "positive"

;; Guard with array binding
(let comparison (match [5, 3]
                  (case [a, b] (if (> a b)) "a > b")
                  (case [a, b] (if (< a b)) "a < b")
                  (default "a = b")))
(assert (=== comparison "a > b") "guard array")
(print "[5, 3]:" comparison)  ; => "a > b"

;; Multiple guards
(let classify (match 0
                (case x (if (> x 0)) "positive")
                (case x (if (< x 0)) "negative")
                (default "zero")))
(assert (=== classify "zero") "guard zero")
(print "0 is:" classify)  ; => "zero"

;; --------------------------------------------
;; 7. Nested Patterns
;; --------------------------------------------

(print "\n=== Nested Patterns ===")

;; Nested arrays
(let matrix [[1, 2], [3, 4]])
(let total (match matrix
             (case [[a, b], [c, d]] (+ a b c d))
             (default 0)))
(assert (=== total 10) "nested arrays")
(print "matrix sum:" total)  ; => 10

;; Object with array
(let point {"coords": [10, 20]})
(let coord-sum (match point
                 (case {coords: [x, y]} (+ x y))
                 (default 0)))
(assert (=== coord-sum 30) "nested object array")
(print "coords sum:" coord-sum)  ; => 30

;; --------------------------------------------
;; 8. Recursive Pattern Matching
;; --------------------------------------------

(print "\n=== Recursive Patterns ===")

;; Sum of list
(fn sum [lst]
  (match lst
    (case [] 0)
    (case [h, & t] (+ h (sum t)))))

(print "sum [1,2,3,4,5]:" (sum [1, 2, 3, 4, 5]))  ; => 15
(assert (=== (sum [1, 2, 3, 4, 5]) 15) "recursive sum")

;; Length of list
(fn my-length [lst]
  (match lst
    (case [] 0)
    (case [_, & t] (+ 1 (my-length t)))))

(print "length [1,2,3,4]:" (my-length [1, 2, 3, 4]))  ; => 4
(assert (=== (my-length [1, 2, 3, 4]) 4) "recursive length")

;; Map function using pattern matching
(fn my-map [f lst]
  (match lst
    (case [] [])
    (case [h, & t] (cons (f h) (my-map f t)))))

(let mapped (doall (my-map (fn [x] (* x 2)) [1, 2, 3])))
(print "map double [1,2,3]:" mapped)  ; => [2, 4, 6]
(assertEqual mapped [2, 4, 6] "recursive map")

;; Filter function using pattern matching
(fn my-filter [pred lst]
  (match lst
    (case [] [])
    (case [h, & t]
      (if (pred h)
          (cons h (my-filter pred t))
          (my-filter pred t)))))

(let evens (doall (my-filter (fn [x] (=== (% x 2) 0)) [1, 2, 3, 4])))
(print "filter even [1,2,3,4]:" evens)  ; => [2, 4]
(assertEqual evens [2, 4] "recursive filter")

;; --------------------------------------------
;; 9. Real-World Examples
;; --------------------------------------------

(print "\n=== Real-World Examples ===")

;; HTTP response handler
(fn handle-response [res]
  (match res
    (case {status: s}
      (cond
        ((=== s 200) "OK")
        ((=== s 404) "Not Found")
        ((=== s 500) "Server Error")
        (else "Unknown Status")))
    (default "Invalid Response")))

(print "status 200:" (handle-response {"status": 200}))  ; => "OK"
(print "status 404:" (handle-response {"status": 404}))  ; => "Not Found"
(assert (=== (handle-response {"status": 200}) "OK") "handle-response 200")
(assert (=== (handle-response {"status": 404}) "Not Found") "handle-response 404")

;; Event handler
(fn handle-event [event]
  (match event
    (case {type: t, x: x, y: y}
      (cond
        ((=== t "click") (+ "Click at " x "," y))
        ((=== t "hover") (+ "Hover at " x "," y))
        (else "Unknown event type")))
    (default "Invalid event")))

(print "click event:" (handle-event {"type": "click", "x": 100, "y": 200}))
(assert (=== (handle-event {"type": "click", "x": 100, "y": 200}) "Click at 100,200") "handle-event click")

;; Option/Maybe pattern
(fn safe-divide [a b]
  (if (=== b 0)
      null
      (/ a b)))

(fn with-default [maybe default-val]
  (match maybe
    (case null default-val)
    (case v v)))

(print "10/2 or 0:" (with-default (safe-divide 10 2) 0))  ; => 5
(print "10/0 or 0:" (with-default (safe-divide 10 0) 0))  ; => 0
(assert (=== (with-default (safe-divide 10 2) 0) 5) "safe-divide ok")
(assert (=== (with-default (safe-divide 10 0) 0) 0) "safe-divide divide by zero")

;; Expression evaluator (simple AST)
(fn eval-expr [expr]
  (match expr
    (case {op: o, left: l, right: r}
      (cond
        ((=== o "+") (+ (eval-expr l) (eval-expr r)))
        ((=== o "-") (- (eval-expr l) (eval-expr r)))
        ((=== o "*") (* (eval-expr l) (eval-expr r)))
        ((=== o "/") (/ (eval-expr l) (eval-expr r)))
        (else 0)))
    (case {value: v} v)
    (case n n)))  ; literal number

;; (2 + 3) * 4
(let ast {"op": "*",
          "left": {"op": "+",
                   "left": {"value": 2},
                   "right": {"value": 3}},
          "right": {"value": 4}})
(print "(2 + 3) * 4 =" (eval-expr ast))  ; => 20
(assert (=== (eval-expr ast) 20) "eval-expr")

(print "\n=== Examples Complete ===")
