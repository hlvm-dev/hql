;; Data Structure and Access Patterns in HQL
;; This demonstrates the disambiguation between property/array access and function calls

(import [assert, assertEqual] from "@hlvm/assert")

;; ========== SECTION 1: STRING KEY PROPERTY ACCESS vs FUNCTION CALLS ==========

;; Define an object with properties
(var person { 
  "name": "John", 
  "age": 30, 
  "hobbies": ["coding", "reading", "hiking"],
  "0": "zero-index-property"
})

;; Define a function that returns values based on keys
(fn get-hobby [key]
  (str "Finding hobby: " key))

;; Add properties to the function itself
(= get-hobby.version "1.0")
(= get-hobby.author "HQL Team")

;; === CASE 1: String property access ===
(print "\n=== CASE 1: String property access ===")
(let personNameKey (person "name"))
(let personNameDot person.name)
(let personNameGet (get person "name"))
(assert (=== personNameKey "John") "string key access")
(assert (=== personNameDot "John") "dot access")
(assert (=== personNameGet "John") "get access")
(print "(person \"name\") -> " personNameKey)
(print "(person.name) -> " personNameDot)
(print "(get person \"name\") -> " personNameGet)

;; === CASE 2: String property that doesn't exist (undefined) ===
(print "\n=== CASE 2: Non-existent string property ===")
(let personAddress (person "address"))
(assert (=== personAddress undefined) "missing string property returns undefined")
(print "(person \"address\") -> " personAddress)

;; === CASE 3: String-keyed property access on a function ===
(print "\n=== CASE 3: String property access on a function ===")
(let hobbyVersionDot get-hobby.version)
(let hobbyVersionGet (get get-hobby "version"))
(assert (=== hobbyVersionDot "1.0") "function property access (dot)")
(assert (=== hobbyVersionGet "1.0") "function property access (get)")
(print "get-hobby.version -> " hobbyVersionDot)
(print "(get get-hobby \"version\") -> " hobbyVersionGet)

;; === CASE 4: Actual function call with string argument ===
(print "\n=== CASE 4: Function call with string argument ===")
(let hobbyCall (get-hobby "hiking"))
(assert (=== hobbyCall "Finding hobby: hiking") "function call fallback")
(print "(get-hobby \"hiking\") -> " hobbyCall) 
(let hobbyVersionCall (get-hobby "version"))
(assert (=== hobbyVersionCall "Finding hobby: version") "function call even with matching property")
(print "(get-hobby \"version\") -> " hobbyVersionCall)

;; This is a fallback case - there's no 'hiking' property on get-hobby, so it calls the function

;; ========== SECTION 2: NUMERIC INDEX ACCESS vs FUNCTION CALLS ==========

;; Define an array
(var fruits ["apple", "banana", "cherry", "date", "elderberry"])

;; Define a function that multiplies a number
(fn multiply-by-two [n]
  (* n 2))

;; Define a function that has a numeric property
(= multiply-by-two.0 "zero-property")

;; === CASE 5: Numeric array indexing ===
(print "\n=== CASE 5: Numeric array indexing ===")
(let fruitAt2 (fruits 2))
(let fruitAt2Get (get fruits 2))
(assert (=== fruitAt2 "cherry") "array index access")
(assert (=== fruitAt2Get "cherry") "array get access")
(print "(fruits 2) -> " fruitAt2) ;; Should return "cherry"
(print "(get fruits 2) -> " fruitAt2Get) ;; Should return "cherry"

;; === CASE 6: Numeric property that doesn't exist on array ===
(print "\n=== CASE 6: Non-existent numeric property on array ===")
(print "(fruits 10) [expected:, undefined, or, error] -> ")
;; Just check if the array has this index first
(if (< 10 (fruits.length))
  (print (fruits 10))
  (do
    (assert (=== (fruits 10) undefined) "out-of-bounds returns undefined")
    (print "(Index out of bounds as expected)")))

;; === CASE 7: Numeric property access on object ===
(print "\n=== CASE 7: Numeric property access on object ===")
(let personZero (person 0))
(assert (=== personZero "zero-index-property") "numeric object property access")
(print "(person 0) -> " personZero) ;; Should access the "0" property

;; === CASE 8: Numeric property access on a function ===
(print "\n=== CASE 8: Numeric property access on a function ===")
(let multZero (get multiply-by-two 0))
(assert (=== multZero "zero-property") "function numeric property access (get)")
(print "(get multiply-by-two 0) -> " multZero) ;; Use get for numeric property access on functions

;; === CASE 9: Actual function call with numeric argument ===
(print "\n=== CASE 9: Function call with numeric argument ===")
(let multFive (multiply-by-two 5))
(assert (=== multFive 10) "function numeric call")
(print "(multiply-by-two 5) -> " multFive) ;; Should call the function since no '5' property exists

;; ========== SECTION 3: LAMBDA AND METHOD CHAIN CONTEXTS ==========

;; === CASE 10: Lambda with array indexing pattern ===
(print "\n=== CASE 10: Lambda with array indexing pattern ===")
(var entries (Object.entries person))
(print "Original entries: " entries)

(var filtered (entries.filter (fn [entry] (!= (entry 0) "age"))))
(assert (=== entries.length 4) "entries length")
(assert (=== filtered.length 3) "filtered length")
(assert (=== (filtered.some (fn [entry] (=== (entry 0) "age"))) false) "filtered removes age")
(print "Filtered entries (excluding 'age'): " filtered)

;; === CASE 11: Lambda with function call pattern ===
(print "\n=== CASE 11: Lambda with function call pattern ===")
(var numbers [1, 2, 3, 4, 5])
(var doubled (numbers.map (fn [n] (multiply-by-two n))))
(assertEqual doubled [2, 4, 6, 8, 10] "map with function call")
(print "Doubled numbers: " doubled)

;; ========== CONCLUSION ==========
(print "\nAll tests completed successfully!")
